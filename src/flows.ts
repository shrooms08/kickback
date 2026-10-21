// What buttons do. Ported from the prototype's behaviour, wired to the
// stores, the router and toasts. Anything that would send a transaction only
// shows "Coming in phase 3" for now; the simulated approval and run flows
// below are reachable from the dev panel (?mock=1 in dev) so every screen and
// transition can still be checked.
import { watch } from 'vue'
import { back, go } from './router'
import { isTab, useNav } from './stores/nav'
import type { ScreenName } from './stores/nav'
import { useAccount } from './stores/account'
import { usePlan } from './stores/plan'
import { useUi } from './stores/ui'
import { useWallet } from './stores/wallet'
import { useFlow } from './stores/flow'
import { useLive } from './stores/live'
import { useData } from './stores/data'
import { sameAddr } from './services/chain'
import type { ApproveKind, RunStep } from './stores/flow'
import { APPROVE_DELAY_MS, DEFAULT_PLAN, NO_CONTACT_PLAN } from './services/mock'
import { nim2 } from './lib/format'
import { splitCents } from './lib/plan'
import type { Split } from './lib/plan'
import { fxArrival, fxStep } from './lib/fx'

let timers: number[] = []
function after(ms: number, fn: () => void) { timers.push(window.setTimeout(fn, ms)) }
export function clearTimers() { timers.forEach(clearTimeout); timers = [] }

/** Navigate, then run `cb` once the transition has settled. */
export function goThen(to: ScreenName, cb: () => void) {
  const nav = useNav()
  if (nav.screen === to && !nav.busy) { cb(); return }
  go(to)
  const stop = watch(() => [nav.screen, nav.busy] as const, ([s, b]) => {
    if (s === to && !b) { stop(); cb() }
  })
}

// ---------- connect ----------

export async function connectWallet() {
  const wallet = useWallet(), ui = useUi(), flow = useFlow(), account = useAccount()
  clearTimers()
  go('connecting')
  const res = await wallet.connect()
  if (res.ok) {
    if (wallet.isMock) {
      account.staked = false
      go('homeEmpty')
      return
    }
    return openLive()
  }
  if (res.rejected) {
    go('welcome')
    ui.showToast('You cancelled. Nothing changed.', { action: 'Try again', fn: connectWallet })
    return
  }
  console.warn('[kickback] connect failed:', res.message)
  flow.errorFrom = 'network'
  flow.errorConnect = true
  go('error')
}

/** Load live data for the effective address (cache first), then show the right Home. */
export async function openLive() {
  const flow = useFlow(), account = useAccount()
  const nav = useNav()
  if (nav.screen !== 'connecting') go('connecting')
  const r = await useLive().start()
  if (r === 'failed') {
    flow.errorFrom = 'network'
    flow.errorConnect = false
    flow.errorLive = true
    return go('error')
  }
  go(account.staked ? 'home' : 'homeEmpty')
}

/** Preview is read only: money actions explain and stop. Returns true when blocked. */
export function previewBlocked(): boolean {
  if (!useWallet().isPreview) return false
  useUi().showToast(PREVIEW_READ_ONLY)
  return true
}
export const PREVIEW_READ_ONLY = 'Preview is read only'

// ---------- tabs ----------

export function tabHome() {
  go(useAccount().staked ? 'home' : 'homeEmpty')
}

export function goPlan() {
  const nav = useNav()
  if (nav.screen !== 'plan') usePlan().beginEdit()
  go('plan')
}

export function goAddContact() {
  const nav = useNav(), ui = useUi(), plan = usePlan()
  if (nav.screen === 'plan') return ui.openSheet('add')
  plan.beginEdit()
  goThen('plan', () => ui.openSheet('add'))
}

export function goPools() {
  const nav = useNav(), account = useAccount(), flow = useFlow()
  const pools = useData().pools
  if (account.staked && isTab(nav.screen) && nav.screen !== 'homeEmpty') {
    // Switching: preselect a pool other than the current one.
    flow.poolPick = pools.find(p => !sameAddr(p.id, account.pool) && p.id !== account.pool)?.id ?? flow.poolPick
  }
  else if (!pools.some(p => p.id === flow.poolPick) && pools[0]) flow.poolPick = pools[0].id
  go('pools')
}

export function poolsBack() {
  back(useNav().poolsFrom || 'homeEmpty')
}

export function goPoolTab() { go('pool') }

export function goStopSheet() {
  const nav = useNav(), ui = useUi()
  if (nav.screen === 'pool') ui.openSheet('stop')
  else goThen('pool', () => ui.openSheet('stop'))
}

// ---------- Run my plan ----------

export function buildSteps(): RunStep[] {
  const plan = usePlan(), account = useAccount()
  const [a, b, c] = splitCents(account.readyCents, plan.saved)
  const sr = plan.contact(plan.savedRecipient)
  const out: RunStep[] = []
  if (a > 0 && sr.id) out.push({ type: 'send', amt: a, label: `Send ${nim2(a)} NIM to ${sr.name}`, st: 'pending' })
  if (b > 0) out.push({ type: 'restake', amt: b, label: `Restake ${nim2(b)} NIM`, st: 'pending' })
  if (c > 0) out.push({ type: 'keep', amt: c, label: `Keep ${nim2(c)} NIM in your wallet`, st: 'pending', auto: true })
  return out
}

export function goRun() {
  const flow = useFlow()
  clearTimers()
  flow.$patch({ doneMode: 'full', runPhase: 'review', steps: buildSteps() })
  go('run')
}

export function changePlanFromRun() {
  clearTimers()
  goPlan()
}

export function closeRun() {
  clearTimers()
  back(useAccount().staked ? 'home' : 'homeEmpty')
}

/** Hold to run my plan. Real transactions arrive in phase 3. */
export function holdRunDone() {
  const account = useAccount(), ui = useUi()
  if (previewBlocked()) return
  if (account.lowFees) return ui.openSheet('fees')
  ui.comingSoon()
}

/** Dev: walk through each step with simulated Nimiq Pay answers. */
export function simulateRun() {
  const flow = useFlow()
  clearTimers()
  const steps = buildSteps()
  const start = () => {
    if (!steps.length) return finishRun()
    flow.$patch({ runPhase: 'running', doneMode: 'full', steps })
    process(0)
  }
  if (useNav().screen === 'run') start()
  else { flow.$patch({ doneMode: 'full', runPhase: 'review', steps: buildSteps() }); goThen('run', () => after(250, start)) }
}

function setStep(i: number, st: RunStep['st'], rest?: RunStep['st']) {
  const flow = useFlow()
  flow.steps = flow.steps.map((x, j) => j === i ? { ...x, st } : (rest && j > i ? { ...x, st: rest } : x))
}

export function process(i: number) {
  const flow = useFlow(), ui = useUi(), account = useAccount()
  const st = flow.steps[i]
  if (!st) return finishRun()
  const next = () => {
    const j = flow.steps.findIndex((x, k) => k > i && x.st === 'pending')
    if (j >= 0) after(st.auto ? 300 : 750, () => process(j))
    else after(700, finishRun)
  }
  setStep(i, 'waiting')
  after(st.auto ? 500 : 1800, () => {
    let r = st.auto ? 'approve' : flow.walletResp
    if (!st.auto) flow.walletResp = 'approve'
    if (!st.auto && account.offline) r = 'fail'
    if (r === 'approve') {
      setStep(i, 'approved')
      if (!st.auto && st.type !== 'keep') fxStep(st.type)
      next()
    }
    else if (r === 'reject') {
      setStep(i, 'cancelled', 'skipped')
      ui.showToast(i === 0 ? 'You cancelled. Nothing was sent.' : 'You cancelled the rest. Earlier steps went through.')
    }
    else { setStep(i, 'failed'); next() }
  })
}

function finishRun() {
  const flow = useFlow()
  const partial = flow.steps.some(x => x.st === 'failed')
  flow.$patch({ runPhase: 'done', doneMode: partial ? 'partial' : 'full', doneKey: flow.doneKey + 1 })
}

export function retryFailed() {
  const flow = useFlow()
  const i = flow.steps.findIndex(x => x.st === 'failed')
  if (i < 0) return
  flow.$patch({ runPhase: 'running', doneMode: 'full' })
  process(i)
}

/** Dev: jump to the finished run. */
export function showRunDone(partial: boolean) {
  const flow = useFlow()
  const steps = buildSteps()
  if (!steps.length) return
  clearTimers()
  let fi = steps.findIndex(x => x.type === 'restake')
  if (fi < 0) fi = 0
  const patch = () => flow.$patch({
    runPhase: 'done', doneMode: partial ? 'partial' : 'full', doneKey: flow.doneKey + 1,
    steps: steps.map((x, i) => ({ ...x, st: partial && i === fi ? 'failed' : 'approved' })),
  })
  if (useNav().screen === 'run') patch()
  else goThen('run', patch)
}

// ---------- approvals (dev simulation; real ones in phase 3) ----------

export function startApprove(kind: ApproveKind) {
  const flow = useFlow(), nav = useNav()
  clearTimers()
  flow.$patch({ approveKind: kind, approveFrom: nav.screen })
  go('approve')
  after(APPROVE_DELAY_MS, resolveApprove)
}

export function cancelApprove() {
  clearTimers()
  useFlow().walletResp = 'reject'
  resolveApprove()
}

export function resolveApprove() {
  clearTimers()
  const flow = useFlow(), account = useAccount(), ui = useUi()
  const r = flow.walletResp, k = flow.approveKind
  const backTo: ScreenName = flow.approveFrom && flow.approveFrom !== 'approve' ? flow.approveFrom : 'pool'
  flow.walletResp = 'approve'
  const pick = useData().pool(flow.poolPick).name
  const fail = (from: 'stake' | 'switch' | 'unstake') => { flow.errorFrom = from; flow.errorConnect = false; go('error') }
  if (k === 'stake') {
    if (r === 'approve') { account.$patch({ staked: true, pool: flow.poolPick, poolState: 'active' }); go('success') }
    else if (r === 'reject') { back('stake'); ui.showToast('You cancelled. Nothing was staked.', { action: 'Try again', fn: () => goThen('stake', () => startApprove('stake')) }) }
    else fail('stake')
  }
  else if (k === 'switch') {
    if (r === 'approve') { account.$patch({ poolState: 'switching', switchTo: flow.poolPick }); go('pool'); ui.showToast(`Switch to ${pick} started. Nothing else to do.`) }
    else if (r === 'reject') { back(backTo); ui.showToast('You cancelled. Nothing changed.') }
    else fail('switch')
  }
  else if (k === 'unstake') {
    if (r === 'approve') { account.$patch({ poolState: 'unstaking', switchTo: null }); go('pool'); ui.showToast('Unstaking started. Nothing else to do.') }
    else if (r === 'reject') { back(backTo); ui.showToast('You cancelled. You\'re still earning.') }
    else fail('unstake')
  }
  else {
    if (r === 'approve') { account.poolState = 'active'; go(backTo === 'home' ? 'home' : 'pool'); ui.showToast('You\'re earning again. Nothing was unstaked.') }
    else if (r === 'reject') { back(backTo); ui.showToast('You cancelled. Unstaking continues.') }
    else fail('unstake')
  }
}

/** "Set up my plan" on Success. */
export function successHome() {
  const account = useAccount(), ui = useUi()
  go('home')
  account.stakePending = true
  setTimeout(() => {
    account.stakePending = false
    ui.showToast('Stake confirmed. First kickback in about 12h.')
  }, 3600)
}

// ---------- error ----------

export function retryError() {
  const flow = useFlow()
  if (flow.errorConnect) { flow.errorConnect = false; flow.errorFrom = null; return connectWallet() }
  if (flow.errorLive) { flow.errorLive = false; flow.errorFrom = null; return openLive() }
  const k = flow.errorFrom
  flow.errorFrom = null
  if (k === 'stake') return go('stake')
  if (k === 'switch' || k === 'unstake') return go('pool')
  go('connecting')
  after(1500, () => go(useAccount().staked ? 'home' : 'homeEmpty'))
}

// ---------- plan ----------

export function savePlan() {
  const plan = usePlan(), ui = useUi()
  const prev = { saved: plan.saved.slice() as Split, savedRecipient: plan.savedRecipient }
  plan.save()
  ui.showToast('Plan saved. Your next kickback will use it.', {
    undo: true,
    fn: () => plan.$patch({ saved: prev.saved, savedRecipient: prev.savedRecipient, recipient: prev.savedRecipient, pct: prev.saved.slice() as Split }),
  })
}

export function resetPlan() {
  const plan = usePlan()
  plan.pct = (plan.hasContacts ? DEFAULT_PLAN : NO_CONTACT_PLAN).slice() as Split
}

export function removeRecipient() {
  const plan = usePlan(), ui = useUi()
  const rec = plan.contact(plan.recipient)
  const prev = { contacts: plan.contacts.slice(), recipient: plan.recipient, savedRecipient: plan.savedRecipient, pct: plan.pct.slice() as Split, saved: plan.saved.slice() as Split }
  const left = plan.contacts.filter(x => x.id !== rec.id)
  const nx = left[0] ? left[0].id : null
  plan.$patch({ contacts: left, recipient: nx, savedRecipient: plan.savedRecipient === rec.id ? nx : plan.savedRecipient })
  if (!left.length) plan.$patch({ saved: NO_CONTACT_PLAN.slice() as Split, pct: NO_CONTACT_PLAN.slice() as Split })
  ui.showToast(`Removed ${rec.name} from your plan`, { undo: true, fn: () => plan.$patch(prev) })
}

export function addContact(name: string) {
  const plan = usePlan(), ui = useUi(), nav = useNav()
  const first = !plan.contacts.length
  ui.closeSheet(() => {
    const id = plan.addContact(name)
    if (first) plan.pct = [40, 30, 30]
    ui.showToast(`${name} added`, { action: 'View', fn: () => { plan.recipient = id; if (nav.screen !== 'plan') goPlan() } })
  })
}

// ---------- money actions (phase 3) ----------

export function holdStakeDone() { if (!previewBlocked()) useUi().comingSoon() }

export function poolsContinue() {
  const nav = useNav(), account = useAccount(), flow = useFlow(), ui = useUi()
  const switchMode = account.staked && isTab(nav.poolsFrom) && nav.poolsFrom !== 'homeEmpty'
  if (!switchMode) return go('stake')
  if (flow.poolPick === account.pool) return ui.showToast(`You're already staked with ${account.poolName}. Pick the other pool to switch.`)
  if (previewBlocked()) return
  ui.comingSoon()
}

export function switchPool() {
  const account = useAccount(), ui = useUi()
  if (account.switching) return ui.showToast(`Already moving to ${account.switchToName}. Nothing else to do.`)
  goPools()
}

export function confirmStop() {
  const ui = useUi()
  ui.closeSheet(() => { if (!previewBlocked()) ui.comingSoon() })
}

export function undoUnstake() { if (!previewBlocked()) useUi().comingSoon() }

export function keepInstead() {
  const account = useAccount(), ui = useUi()
  const prev = account.readyCents, pw = account.waiting
  ui.closeSheet(() => {
    account.$patch({ readyCents: 0, readyFrom: 0, waiting: 0, lowFees: false })
    go('home')
    ui.showToast(`${nim2(prev / 100)} NIM kept in your wallet.`, { undo: true, fn: () => account.$patch({ readyCents: prev, readyFrom: prev, waiting: pw }) })
  })
}

export function shareNow() {
  const account = useAccount(), ui = useUi()
  if (account.readyCents) goRun()
  else ui.showToast('Nothing to share yet. Your first kickback lands in about 9h.')
}

// ---------- banners ----------

export function retryOnline() {
  const account = useAccount(), ui = useUi()
  if (typeof navigator !== 'undefined' && !navigator.onLine && !useWallet().isMock) return ui.showToast('Still offline. Nothing was sent.')
  account.offline = false
  ui.showToast('You\'re back online. Everything is up to date.')
}

export function refreshStale() {
  const account = useAccount(), ui = useUi()
  if (!useWallet().isMock) {
    useLive().refresh().then(() => { if (!account.stale) ui.showToast('Up to date.') })
    return
  }
  if (account.refreshing) return
  account.refreshing = true
  setTimeout(() => { account.$patch({ stale: false, refreshing: false }); ui.showToast('Up to date.') }, 900)
}

// ---------- dev ----------

export function simulateArrival() {
  const account = useAccount(), ui = useUi(), nav = useNav()
  const land = () => fxArrival(() => { account.arrive(); ui.showToast('Kickback landed: +3.12 NIM') })
  if (nav.screen !== 'home' || ui.sheet) { clearTimers(); account.staked = true; goThen('home', () => setTimeout(land, 80)) }
  else land()
}
