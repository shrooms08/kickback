import { minLabel } from './lib/minReady'
// Real money actions through Nimiq Pay (or dry run). Mock mode (?mock=1) keeps
// the prototype's simulated flows in flows.ts; everything here is live.
//
// Rules: amounts are integer Luna; re-read the balance before every action;
// user rejection = "You cancelled. Nothing was sent."; network/unknown errors
// are checked on chain before we say anything; after a send we show
// "confirming" and poll until it is in a block.
import { watch } from 'vue'
import { back, go } from './router'
import { useNav } from './stores/nav'
import type { ScreenName } from './stores/nav'
import { useAccount } from './stores/account'
import { usePlan } from './stores/plan'
import { useUi } from './stores/ui'
import { useWallet } from './stores/wallet'
import { useFlow } from './stores/flow'
import type { RunStep, StepState } from './stores/flow'
import { useData } from './stores/data'
import { useOps, TERMINAL } from './stores/ops'
import type { Op, OpFlow } from './stores/ops'
import { currentStaker, useLive } from './stores/live'
import { useDry } from './stores/dry'
import { electionAfter, epochClock, releaseIfStoppedNow, sameAddr } from './services/chain'
import type { SendRequest } from './services/sendTypes'
import { checkStake, maxStake, parseNimInput, runAmount, splitLuna, spendable } from './lib/money'
import { nim2 } from './lib/format'
import { span } from './lib/time'
import { fxStep } from './lib/fx'
import { prefGet, prefSet } from './lib/cache'
import { isValidAddress } from './lib/address'
import { isTestnet } from './lib/net'

const NIM = (luna: number) => nim2(luna / 1e5)
const me = () => useWallet().effectiveAddress

/** Preview is read only: money actions explain and stop. */
export function previewBlocked(): boolean {
  if (!useWallet().isPreview) return false
  useUi().showToast('Preview is read only')
  return true
}

/** Resolve when the op leaves the given phases (or ends). */
function untilNot(id: string, phases: Op['phase'][]): Promise<Op> {
  const ops = useOps()
  return new Promise((resolve) => {
    const check = () => {
      const op = ops.byId(id)
      if (!op || !phases.includes(op.phase)) { stop(); resolve(op!); return true }
      return false
    }
    const stop = watch(() => ops.byId(id)?.phase, () => { check() })
    check()
  })
}

/** Start an op and return its id right away (the op itself keeps running). */
function startOp(flow: OpFlow, req: SendRequest, meta?: Op['meta']): { id: string, done: Promise<Op> } {
  const ops = useOps()
  const done = ops.execute(flow, req, me(), meta)
  const id = ops.latest(flow)!.id
  return { id, done }
}

async function freshBalanceOrToast(): Promise<number | null> {
  try { return await useWallet().freshBalance() }
  catch {
    useUi().showToast('Couldn\'t read your balance. Nothing was sent. Try again in a moment.')
    return null
  }
}

function fail(kind: 'notSent' | 'chainFailed', backTo: ScreenName) {
  const flow = useFlow()
  flow.$patch({ errorFrom: kind, errorConnect: false, errorLive: false, errorBack: backTo })
  go('error')
}

// ---------- stake / add to stake ----------

export async function stakeLive() {
  const flow = useFlow(), account = useAccount(), data = useData(), ui = useUi()
  if (previewBlocked()) return
  if (useOps().active.some(o => o.flow === 'stake')) return ui.showToast('Your stake is still confirming. Nothing else to do.')
  // Degraded mode: the stake couldn't be read, so we can't tell a first stake from adding more.
  if (account.chainUnknown) return ui.showToast('Can\'t check your stake right now. Try again in a minute.')
  const pool = data.pool(flow.poolPick)
  // Never send with a placeholder: the delegation must be a real validator address.
  // Testnet lists every active validator (no direct-payout pools there), so any of them can be picked.
  if (!isValidAddress(pool.validator) || (pool.payoutType !== 'direct' && !isTestnet)) { ui.showToast('Pick a pool first.'); return go('pools') }
  const st = currentStaker()
  const isNew = !st || st.balance + st.inactiveBalance + st.retiredBalance === 0
  if (!isNew && !sameAddr(st!.delegation, pool.validator)) return ui.openSheet('switch')
  const amount = parseNimInput(flow.amount)
  const bal = await freshBalanceOrToast()
  if (bal == null) return
  const check = checkStake(amount, bal, isNew)
  if (check !== 'ok') {
    const msg = check === 'balance-below-min' || check === 'over-balance'
      ? `You have ${NIM(bal)} NIM. You can stake up to ${NIM(maxStake(bal))} NIM.`
      : check === 'below-min' ? 'The minimum is 100 NIM.' : 'Enter how much NIM to stake.'
    return ui.showToast(msg)
  }
  const req: SendRequest = isNew ? { kind: 'newStaker', value: amount, delegation: pool.validator } : { kind: 'addStake', value: amount }
  flow.$patch({ approveKind: 'stake', approveFrom: 'stake', lastStakeLuna: amount, lastStakeAdd: !isNew })
  const { id, done } = startOp('stake', req)
  flow.approveOpId = id
  go('approve')
  // Success as soon as it is sent: Home shows "Confirming your stake" until it is in a block.
  const op = await untilNot(id, ['approving', 'checking'])
  if (op.phase === 'confirming' || op.phase === 'confirmed') {
    if (useNav().screen === 'approve') go('success')
    account.staked = true
    done.then((final) => {
      if (final.phase === 'confirmed') ui.showToast(isNew ? 'Stake confirmed. You\'re earning.' : 'Stake added.')
      else if (final.phase === 'failed') ui.showToast('The network didn\'t accept the stake. Nothing moved.')
    })
    return
  }
  if (op.phase === 'rejected') { back('stake'); ui.showToast('You cancelled. Nothing was staked.', { action: 'Try again', fn: stakeLive }) }
  else fail(op.phase === 'failed' ? 'chainFailed' : 'notSent', 'stake')
}

// ---------- approvals that wait for the block (stop, undo, switch) ----------

async function approveAndConfirm(kind: 'unstake' | 'keep' | 'switch', opFlow: OpFlow, req: SendRequest, meta: Op['meta'], onDone: () => void, cancelText: string) {
  const flow = useFlow(), ui = useUi(), nav = useNav()
  const from = nav.screen === 'approve' ? 'pool' : (nav.screen ?? 'pool')
  flow.$patch({ approveKind: kind, approveFrom: from })
  const { id, done } = startOp(opFlow, req, meta)
  flow.approveOpId = id
  go('approve')
  const op = await done
  const stillHere = useNav().screen === 'approve'
  if (op.phase === 'confirmed') { if (stillHere) onDone(); else ui.showToast('Done. It\'s on the network.') }
  else if (op.phase === 'rejected') { if (stillHere) back(from); ui.showToast(cancelText) }
  else if (stillHere) fail(op.phase === 'failed' ? 'chainFailed' : 'notSent', 'pool')
  else ui.showToast('That didn\'t go through. Nothing was sent.')
}

export async function stopLive() {
  const ui = useUi()
  if (previewBlocked()) return
  const st = currentStaker()
  if (!st || st.balance === 0) return ui.showToast('Nothing is earning right now.')
  await approveAndConfirm('unstake', 'unstake', { kind: 'setActive', value: 0 }, undefined, () => {
    go('pool')
    ui.showToast('Unstaking started. Nothing else to do.')
  }, 'You cancelled. You\'re still earning.')
}

export async function undoLive() {
  const ui = useUi()
  if (previewBlocked()) return
  const st = currentStaker()
  if (!st || st.inactiveBalance === 0) return ui.showToast('There\'s nothing to reactivate.')
  const all = st.balance + st.inactiveBalance
  await approveAndConfirm('keep', 'keep', { kind: 'setActive', value: all }, undefined, () => {
    go(useNav().screen === 'home' ? 'home' : 'pool')
    ui.showToast('You\'re earning again. Nothing was unstaked.')
  }, 'You cancelled. Unstaking continues.')
}

/**
 * Switch pool. Albatross only lets a staker change delegation when no stake
 * is active and the inactive stake is released (staker.rs update_staker).
 * Then one update transaction moves it and reactivates everything.
 */
export async function switchLive() {
  const flow = useFlow(), account = useAccount(), data = useData(), ui = useUi()
  if (previewBlocked()) return
  const st = currentStaker()
  const target = data.pool(flow.poolPick)
  if (!st) return go('stake')
  if (sameAddr(st.delegation, target.validator)) return ui.showToast(`You're already with ${account.poolName}.`)
  if (st.balance > 0) return ui.openSheet('switch')
  if (st.inactiveBalance === 0) return ui.showToast('Your NIM is ready to withdraw. Withdraw it, then stake with the new pool.')
  if (!account.unstakeReadyAt || account.unstakeReadyAt > Date.now()) {
    const left = account.unstakeReadyAt ? span(account.unstakeReadyAt - Date.now()) : 'a while'
    return ui.showToast(`Your NIM is released in about ${left}. Then you can pick the new pool.`)
  }
  const clock = await epochClock().catch(() => null)
  const effectiveAt = clock ? electionAfter(clock, Date.now()) : Date.now() + 12 * 3600e3
  await approveAndConfirm('switch', 'switch', { kind: 'updateStaker', value: 0, newDelegation: target.validator }, { from: st.delegation, effectiveAt }, () => {
    go('pool')
    ui.showToast(`Switch to ${target.name} started. Nothing else to do.`)
  }, 'You cancelled. Nothing changed.')
}

/** Hours until stake stopped now would be released (for the switch sheet). */
export async function hoursToReleaseIfStopped(): Promise<number> {
  const dry = useDry(), wallet = useWallet()
  if (dry.on && !wallet.isPreview) return Math.max(1, Math.round((dry.releaseMs + 3000) / 3600e3))
  const clock = useLive().clock ?? await epochClock().catch(() => null)
  if (!clock) return 24
  return Math.max(1, Math.ceil((releaseIfStoppedNow(clock) - Date.now()) / 3600e3))
}

// ---------- Run my plan ----------

/** The steps a run of `amount` Luna makes from the saved plan (exact Luna, remainder to the last slice). */
export function planSteps(amount: number): { steps: RunStep[], note: string } {
  const plan = usePlan(), account = useAccount()
  const slices = plan.slices
  const parts = splitLuna(amount, slices.map(s => s.pct))
  const steps: RunStep[] = []
  let keepExtra = 0, note = ''
  slices.forEach((s, i) => {
    const luna = parts[i]
    if (s.kind === 'send') {
      if (luna > 0 && s.contact.address) steps.push({ type: 'send', luna, amt: luna / 1e5, recipient: s.contact.address, label: `Send ${NIM(luna)} NIM to ${s.contact.name}`, st: 'pending' })
      else keepExtra += luna
    }
    else if (s.kind === 'restake') {
      if (!account.staked || account.stakedNim === 0) { keepExtra += luna; if (luna > 0) note = 'You\'re not earning right now, so the restake share stays in your wallet.' }
      else if (luna > 0) steps.push({ type: 'restake', luna, amt: luna / 1e5, label: `Restake ${NIM(luna)} NIM`, st: 'pending' })
    }
    else {
      const total = luna + keepExtra
      if (total > 0) steps.push({ type: 'keep', luna: total, amt: total / 1e5, label: `Keep ${NIM(total)} NIM in your wallet`, st: 'pending', auto: true })
    }
  })
  return { steps, note }
}

/** Review screen: what a run would do now (balance as last read). */
export function reviewRun() {
  const flow = useFlow(), account = useAccount(), wallet = useWallet()
  const { amount, capped } = runAmount(account.readyLuna, wallet.effectiveBalanceLuna)
  const { steps, note } = planSteps(amount)
  flow.$patch({
    doneMode: 'full', runPhase: 'review', steps, runAmountLuna: amount, runNote: note,
    runCapped: capped && account.readyLuna > 0 ? `Your wallet can spend ${NIM(spendable(wallet.effectiveBalanceLuna))} NIM after a small fee reserve, so this run shares ${NIM(amount)} NIM.` : '',
  })
}

/** True while this session is walking the steps (not after a restart). */
let processing = false
let withdrawing = false

const PHASE_TO_STEP: Record<Op['phase'], StepState> = {
  approving: 'waiting', checking: 'checking', confirming: 'confirming', confirmed: 'approved', failed: 'failed', rejected: 'cancelled', 'not-sent': 'failed',
}

/** Keep step states in line with their ops (also after a restart). */
export function syncRunSteps() {
  const flow = useFlow(), ops = useOps()
  let changed = false
  const map = (list: RunStep[]) => list.map((s) => {
    if (!s.opId) return s
    const op = ops.byId(s.opId)
    if (!op) return s
    const st = PHASE_TO_STEP[op.phase]
    if (st !== s.st || !!op.slow !== !!s.slow) { changed = true; return { ...s, st, slow: !!op.slow } }
    return s
  })
  const steps = map(flow.steps), wSteps = map(flow.wSteps)
  if (changed) { flow.$patch({ steps, wSteps }); persistRun() }
  // A run resumed after a restart has nobody walking it: once its checks
  // settle, unsent steps become "not sent" and it ends as partial (Retry).
  const busy = (l: RunStep[]) => l.some(x => x.st === 'waiting' || x.st === 'checking' || x.st === 'confirming')
  if (!processing && flow.runPhase === 'running' && !busy(flow.steps) && !flow.steps.some(x => x.st === 'cancelled')) {
    flow.$patch({ steps: flow.steps.map(x => x.st === 'pending' ? { ...x, st: 'skipped' as StepState } : x) })
    finishRunLive()
  }
  if (!withdrawing && flow.wPhase === 'running' && !busy(flow.wSteps)) { flow.wPhase = 'review'; persistRun() }
}

function persistRun() {
  const flow = useFlow(), addr = me()
  if (!addr) return
  prefSet('run:' + addr.replace(/\s/g, ''), JSON.stringify({ runPhase: flow.runPhase, doneMode: flow.doneMode, steps: flow.steps, runAmountLuna: flow.runAmountLuna, wSteps: flow.wSteps, wPhase: flow.wPhase }))
}

/** After a restart: bring back an unfinished run so it resumes checking (never re-sends). */
export function restoreRun() {
  const flow = useFlow(), ops = useOps()
  try {
    const r = JSON.parse(prefGet('run:' + me().replace(/\s/g, '')) || 'null')
    if (!r) return
    flow.$patch({ runPhase: r.runPhase, doneMode: r.doneMode, steps: r.steps, runAmountLuna: r.runAmountLuna, wSteps: r.wSteps || [], wPhase: r.wPhase || 'review' })
    syncRunSteps()
    // Steps that never started stay unsent: the run ends as partial with Retry.
    const finish = (list: RunStep[]) => list.map(s => (s.st === 'pending' || s.st === 'waiting') && !(s.opId && ops.byId(s.opId) && !TERMINAL.includes(ops.byId(s.opId)!.phase)) ? { ...s, st: 'skipped' as StepState } : s)
    if (flow.runPhase === 'running' && !flow.steps.some(s => s.opId && !TERMINAL.includes(ops.byId(s.opId)?.phase ?? 'confirmed'))) {
      flow.$patch({ steps: finish(flow.steps) })
      finishRunLive()
    }
    if (flow.wPhase === 'running' && !flow.wSteps.some(s => s.opId && !TERMINAL.includes(ops.byId(s.opId)?.phase ?? 'confirmed'))) {
      flow.$patch({ wSteps: finish(flow.wSteps), wPhase: 'done' })
    }
  }
  catch { /* nothing to restore */ }
}

function setStep(i: number, patch: Partial<RunStep>, key: 'steps' | 'wSteps' = 'steps') {
  const flow = useFlow()
  flow[key] = flow[key].map((s, j) => j === i ? { ...s, ...patch } : s)
  persistRun()
}

/** Hold to run my plan. */
export async function runPlanLive() {
  const flow = useFlow(), account = useAccount(), ui = useUi(), ops = useOps(), plan = usePlan()
  if (previewBlocked()) return
  if (flow.runPhase === 'running' || ops.active.some(o => o.flow === 'run')) return ui.showToast('Your plan is already running.')
  if (plan.planStartedAt == null) return ui.showToast('Save your plan first.')
  if (account.readyLuna > 0 && account.readyLuna < plan.minReadyLuna) return ui.showToast(`Your plan runs once ${minLabel(plan.minReadyLuna)} NIM is ready.`)
  const bal = await freshBalanceOrToast()
  if (bal == null) return
  const { amount, capped } = runAmount(account.readyLuna, bal)
  if (amount <= 0) {
    if (account.readyLuna > 0) return ui.openSheet('fees')
    return ui.showToast('Nothing to share yet.')
  }
  const { steps: planned, note } = planSteps(amount)
  const runId = crypto.randomUUID()
  const steps = planned.map(s => ({ ...s, runId }))
  flow.$patch({
    runPhase: 'running', doneMode: 'full', steps, runAmountLuna: amount, runNote: note,
    runCapped: capped ? `Your wallet can spend ${NIM(spendable(bal))} NIM after a small fee reserve, so this run shares ${NIM(amount)} NIM.` : '',
  })
  persistRun()
  await processSteps(0)
}

async function processSteps(from: number) {
  processing = true
  try { await walkSteps(from) }
  finally { processing = false }
  maybeFinish()
}

async function walkSteps(from: number) {
  const flow = useFlow(), plan = usePlan(), ui = useUi()
  for (let i = from; i < flow.steps.length; i++) {
    const s = flow.steps[i]
    if (s.st !== 'pending') continue
    if (s.type === 'keep') {
      setStep(i, { st: 'approved' })
      plan.recordShared(s.luna ?? 0, undefined, useWallet().isDry, 'keep', s.runId)
      continue
    }
    const req: SendRequest = s.type === 'send'
      ? { kind: 'payment', value: s.luna!, recipient: s.recipient!, data: 'Kickback' }
      : { kind: 'addStake', value: s.luna! }
    const { id, done } = startOp('run', req, { step: i })
    setStep(i, { opId: id, st: 'waiting' })
    const op = await untilNot(id, ['approving', 'checking'])
    if (op.phase === 'rejected') {
      setStep(i, { st: 'cancelled' })
      flow.steps = flow.steps.map((x, j) => j > i && x.st === 'pending' ? { ...x, st: 'skipped' } : x)
      persistRun()
      ui.showToast(i === 0 ? 'You cancelled. Nothing was sent.' : 'You cancelled the rest. Earlier steps went through.')
      return
    }
    if (op.phase === 'confirming' || op.phase === 'confirmed') {
      if (s.type === 'send' || s.type === 'restake') fxStep(s.type)
      // Recorded as shared once it is in a block; failures stay ready to share.
      done.then((final) => { if (final.phase === 'confirmed') plan.recordShared(s.luna ?? 0, final.hash, final.dry, s.type === 'send' ? 'send' : 'restake', s.runId); syncRunSteps(); maybeFinish() })
    }
    syncRunSteps()
  }
}

function maybeFinish() {
  const flow = useFlow()
  if (flow.runPhase !== 'running') return
  if (flow.steps.some(s => s.st === 'pending' || s.st === 'waiting' || s.st === 'checking' || s.st === 'confirming')) return
  if (flow.steps.some(s => s.st === 'cancelled')) return // stays on the steps with Try again / Back to home
  finishRunLive()
}

function finishRunLive() {
  const flow = useFlow()
  const partial = flow.steps.some(s => s.st === 'failed' || s.st === 'skipped')
  flow.$patch({ runPhase: 'done', doneMode: partial ? 'partial' : 'full', doneKey: flow.doneKey + 1 })
  persistRun()
}

/** Retry only what didn't go out (failed, skipped, cancelled). Amounts stay as planned. */
export async function retryRunLive() {
  const flow = useFlow(), ui = useUi()
  if (previewBlocked()) return
  const todo = flow.steps.map((s, i) => ({ s, i })).filter(({ s }) => s.st === 'failed' || s.st === 'skipped' || s.st === 'cancelled')
  if (!todo.length) return
  const need = todo.reduce((a, { s }) => a + (s.type === 'keep' ? 0 : s.luna ?? 0), 0)
  const bal = await freshBalanceOrToast()
  if (bal == null) return
  if (need > spendable(bal)) return ui.openSheet('fees')
  flow.$patch({ runPhase: 'running', doneMode: 'full', steps: flow.steps.map(s => (s.st === 'failed' || s.st === 'skipped' || s.st === 'cancelled') ? { ...s, st: 'pending', opId: undefined, slow: false } : s) })
  persistRun()
  await processSteps(todo[0].i)
}

// ---------- withdraw (retire, then remove) ----------

/**
 * Withdraw released stake. Inactive stake must be retired first, and only the
 * whole retired balance can be removed (staker.rs retire_stake/remove_stake).
 */
export function withdrawSteps(): RunStep[] {
  const st = currentStaker()
  if (!st) return []
  const steps: RunStep[] = []
  if (st.inactiveBalance > 0) steps.push({ type: 'retire', luna: st.inactiveBalance, amt: st.inactiveBalance / 1e5, label: `Unlock ${NIM(st.inactiveBalance)} NIM`, st: 'pending' })
  const removable = st.retiredBalance + st.inactiveBalance
  if (removable > 0) steps.push({ type: 'remove', luna: removable, amt: removable / 1e5, label: `Move ${NIM(removable)} NIM to your wallet`, st: 'pending' })
  return steps
}

export function openWithdraw() {
  const flow = useFlow(), account = useAccount(), ui = useUi()
  if (previewBlocked()) return
  if (!account.unstakeReady) return ui.showToast('Not released yet. Nothing to withdraw.')
  const st = currentStaker()
  if (st && st.balance > 0 && st.balance < 100 * 1e5) return ui.showToast('Keep at least 100 NIM staked, or stop earning on all of it first.')
  flow.$patch({ wSteps: withdrawSteps(), wPhase: 'review' })
  go('withdraw')
}

export async function runWithdraw() {
  const flow = useFlow()
  if (previewBlocked()) return
  if (flow.wPhase === 'running') return
  flow.wPhase = 'running'
  withdrawing = true
  persistRun()
  try { await walkWithdraw() }
  finally { withdrawing = false }
}

async function walkWithdraw() {
  const flow = useFlow(), ui = useUi()
  for (let i = 0; i < flow.wSteps.length; i++) {
    const s = flow.wSteps[i]
    if (s.st === 'approved') continue
    const req: SendRequest = s.type === 'retire' ? { kind: 'retire', value: s.luna! } : { kind: 'remove', value: s.luna! }
    const { id, done } = startOp('withdraw', req, { step: i })
    setStep(i, { opId: id, st: 'waiting' }, 'wSteps')
    // Remove needs the retire to be in a block first.
    const op = await done
    syncRunSteps()
    if (op.phase === 'rejected') { ui.showToast(i === 0 ? 'You cancelled. Nothing was sent.' : 'You cancelled. Your NIM is unlocked and stays in the staking contract.'); flow.wPhase = 'review'; persistRun(); return }
    if (op.phase !== 'confirmed') { flow.wPhase = 'review'; persistRun(); ui.showToast('That step didn\'t go through. Nothing was sent. Try again.'); return }
  }
  flow.wPhase = 'done'
  persistRun()
}

/** Clear finished run/withdraw state when leaving them. */
export function clearFinished() {
  const flow = useFlow()
  if (flow.runPhase === 'done') flow.$patch({ runPhase: 'review', steps: [] })
  if (flow.wPhase === 'done') flow.$patch({ wPhase: 'review', wSteps: [] })
  persistRun()
}
