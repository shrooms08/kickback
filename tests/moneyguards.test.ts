import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { memoryStorage } from './helpers/storage'

// Guards around real money actions (audit 2, 3, 5): a dry-run run is never retried for real,
// a hold that fires twice starts one action, and nothing switches mode or wallet mid-flight.
const ME = 'NQ51 KVXF RMYV 9HPD CA8N 5X10 7SUY 2C29 MU2T', TO = 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8'
const POOL = 'NQ16 373T EQ2V JX5B ME74 G056 3TA9 75L3 P717'
const tx = vi.hoisted(() => ({ send: vi.fn(), findOnChain: vi.fn(), waitIncluded: vi.fn() }))
const staker = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }))
vi.mock('../src/services/tx', async orig => ({ ...(await orig<object>()), ...tx }))
vi.mock('../src/router', () => ({ go: vi.fn(), back: vi.fn() }))
vi.mock('../src/lib/fx', () => ({ fxStep: vi.fn() }))
vi.mock('../src/stores/live', () => ({ currentStaker: () => staker.value, useLive: () => ({ clock: null, derive() {}, refresh() {} }) }))

const flush = () => new Promise(r => setTimeout(r, 0))

async function setup(opts: { dry?: boolean } = {}) {
  vi.resetModules()
  setActivePinia(createPinia())
  const money = await import('../src/money')
  const { useWallet } = await import('../src/stores/wallet')
  const { useDry } = await import('../src/stores/dry')
  const { useFlow } = await import('../src/stores/flow')
  const { useOps } = await import('../src/stores/ops')
  const { usePlan } = await import('../src/stores/plan')
  const { useAccount } = await import('../src/stores/account')
  const { useUi } = await import('../src/stores/ui')
  const { useData } = await import('../src/stores/data')
  const wallet = useWallet(), dry = useDry(), flow = useFlow(), ops = useOps(), plan = usePlan(), account = useAccount(), ui = useUi()
  wallet.$patch({ env: 'nimiqpay', address: ME, connected: true, previewAddress: '', balanceLuna: 100_000_000, balanceSource: 'sdk' })
  dry.$patch({ on: !!opts.dry })
  plan.loadFor(ME)
  ops.load(ME)
  const toasts: string[] = []
  vi.spyOn(ui, 'showToast').mockImplementation((m: string) => { toasts.push(m) })
  vi.spyOn(ui, 'openSheet').mockImplementation(() => {})
  vi.spyOn(wallet, 'freshBalance').mockResolvedValue(100_000_000)
  return { money, wallet, dry, flow, ops, plan, account, ui, data: useData(), toasts }
}

beforeEach(() => {
  memoryStorage()
  staker.value = null
  tx.send.mockReset(); tx.findOnChain.mockReset(); tx.waitIncluded.mockReset()
  tx.send.mockResolvedValue({ status: 'rejected' })
})

/** The plan still sends to TO and the failed amount is still ready to share. */
const readyFor = (s: Awaited<ReturnType<typeof setup>>) => {
  s.plan.$patch({ planStartedAt: Date.now() - 1000, contacts: [{ id: 'c1', name: 'Ada', ini: 'A', address: TO }], saved: [100, 0, 0], savedRecipient: 'c1' })
  s.account.$patch({ readyLuna: 100_000 })
}
const failedRun = (runDry?: boolean) => ({
  runPhase: 'done' as const, doneMode: 'partial' as const, runAmountLuna: 100_000,
  steps: [{ type: 'send' as const, luna: 100_000, amt: 1, recipient: TO, label: 'Send 1.00 NIM to Ada', st: 'failed' as const, runId: 'r1' }],
  ...(runDry === undefined ? {} : { runDry }),
})

describe('audit 2: a dry-run run is never retried for real', () => {
  it('refuses to retry a dry-run run once dry run is off', async () => {
    const s = await setup({ dry: false })
    s.flow.$patch(failedRun(true))
    await s.money.retryRunLive()
    expect(tx.send).not.toHaveBeenCalled()
    expect(s.ops.ops).toHaveLength(0)
    expect(s.toasts.join(' ')).toMatch(/dry run/i)
  })
  it('refuses to retry a real run in dry run', async () => {
    const s = await setup({ dry: true })
    s.flow.$patch(failedRun(false))
    await s.money.retryRunLive()
    expect(s.ops.ops).toHaveLength(0)
  })
  it('a run from before this fix (mode unknown) is not retried', async () => {
    const s = await setup({ dry: false })
    s.flow.$patch(failedRun(undefined))
    await s.money.retryRunLive()
    expect(s.ops.ops).toHaveLength(0)
  })
  it('retries a real run in real mode', async () => {
    const s = await setup({ dry: false })
    readyFor(s)
    s.flow.$patch(failedRun(false))
    await s.money.retryRunLive()
    expect(tx.send).toHaveBeenCalledTimes(1)
  })
  it('a new run remembers its mode, and runs of the two modes are stored apart', async () => {
    const s = await setup({ dry: true })
    s.flow.$patch(failedRun(true))
    s.money.persistRun()
    s.dry.$patch({ on: false })
    s.money.restoreRun()
    expect(s.flow.steps).toHaveLength(0)
    s.dry.$patch({ on: true })
    s.money.restoreRun()
    expect(s.flow.steps).toHaveLength(1)
    expect(s.flow.runDry).toBe(true)
  })
  it('dry run and preview cannot change while a run is running or an op is active', async () => {
    const s = await setup({ dry: true })
    expect(s.money.moneyBusy()).toBe(false)
    s.flow.$patch({ runPhase: 'running' })
    expect(s.money.moneyBusy()).toBe(true)
    expect(s.money.setDryMode(false)).toBe(false)
    expect(s.dry.on).toBe(true)
    s.flow.$patch({ runPhase: 'review' })
    s.ops.ops.push({ id: 'x', flow: 'stake', req: { kind: 'addStake', value: 1 }, phase: 'confirming', address: ME, dry: true, startedAt: Date.now() })
    expect(s.money.moneyBusy()).toBe(true)
    expect(s.money.setDryMode(false)).toBe(false)
    s.ops.ops = []
    expect(s.money.setDryMode(false)).toBe(true)
    expect(s.dry.on).toBe(false)
  })
  it('leaving a cancelled (stuck) run ends it, so it does not stay running', async () => {
    const s = await setup({ dry: true })
    s.flow.$patch({ runPhase: 'running', steps: [{ type: 'send', luna: 1, amt: 0, recipient: TO, label: 'x', st: 'cancelled' }] })
    s.money.clearFinished()
    expect(s.flow.runPhase).toBe('review')
    expect(s.flow.steps).toHaveLength(0)
  })
})

describe('audit 3: a second hold while the first is still starting does nothing', () => {
  function slowBalance(s: Awaited<ReturnType<typeof setup>>) {
    let release!: (v: number) => void
    vi.spyOn(s.wallet, 'freshBalance').mockImplementation(() => new Promise<number>((r) => { release = r }))
    return async () => { while (!release) await flush(); release(100_000_000) }
  }
  it('run my plan', async () => {
    const s = await setup()
    s.plan.$patch({ planStartedAt: Date.now() - 1000, contacts: [{ id: 'c1', name: 'Ada', ini: 'A', address: TO }], saved: [100, 0, 0], savedRecipient: 'c1' })
    s.account.$patch({ readyLuna: 100_000, staked: true, stakedNim: 100 })
    const go = slowBalance(s)
    const a = s.money.runPlanLive(), b = s.money.runPlanLive()
    expect(s.money.moneyLocked()).toBe(true)
    await go(); await Promise.all([a, b]); await flush()
    expect(s.wallet.freshBalance).toHaveBeenCalledTimes(1)
    expect(tx.send).toHaveBeenCalledTimes(1)
    expect(s.money.moneyLocked()).toBe(false)
  })
  it('stake', async () => {
    const s = await setup()
    s.data.known = { p1: { id: 'p1', name: 'Pool', validator: POOL, payoutType: 'direct' } } as never
    s.flow.$patch({ poolPick: 'p1' as never, amount: '200' })
    const go = slowBalance(s)
    const a = s.money.stakeLive(), b = s.money.stakeLive()
    await go(); await Promise.all([a, b]); await flush()
    expect(s.wallet.freshBalance).toHaveBeenCalledTimes(1)
    expect(tx.send).toHaveBeenCalledTimes(1)
  })
  it('retry', async () => {
    const s = await setup()
    readyFor(s)
    s.flow.$patch(failedRun(false))
    const go = slowBalance(s)
    const a = s.money.retryRunLive(), b = s.money.retryRunLive()
    await go(); await Promise.all([a, b]); await flush()
    expect(tx.send).toHaveBeenCalledTimes(1)
  })
  it('stop earning twice: one transaction', async () => {
    const s = await setup()
    staker.value = { address: ME, balance: 200_00000, delegation: POOL, inactiveBalance: 0, inactiveFrom: null, retiredBalance: 0 }
    tx.send.mockReturnValue(new Promise(() => {}))
    void s.money.stopLive(); void s.money.stopLive()
    await flush()
    expect(tx.send).toHaveBeenCalledTimes(1)
  })
})

describe('audit 6: adding to an existing stake works with any pool', () => {
  const st = { address: ME, balance: 200_00000, delegation: POOL, inactiveBalance: 0, inactiveFrom: null, retiredBalance: 0 }
  it('a staker in a restaking pool can add stake', async () => {
    const s = await setup()
    staker.value = st
    s.data.known = { p1: { id: 'p1', name: 'Restaker', validator: POOL, payoutType: 'restake' } } as never
    s.flow.$patch({ poolPick: 'p1' as never, amount: '50' })
    await s.money.stakeLive()
    expect(tx.send).toHaveBeenCalledWith({ kind: 'addStake', value: 50_00000 })
  })
  it('a staker whose pool is only a placeholder (unknown payout type) can add stake', async () => {
    const s = await setup()
    staker.value = st
    s.flow.$patch({ poolPick: POOL as never, amount: '50' })
    await s.money.stakeLive()
    expect(tx.send).toHaveBeenCalledWith({ kind: 'addStake', value: 50_00000 })
  })
  it('a new staker still needs a direct-payout pool', async () => {
    const s = await setup()
    s.flow.$patch({ poolPick: POOL as never, amount: '200' })
    await s.money.stakeLive()
    expect(tx.send).not.toHaveBeenCalled()
    expect(s.toasts).toContain('Pick a pool first.')
  })
})
