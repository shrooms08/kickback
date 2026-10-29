import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { memoryStorage } from './helpers/storage'

// Audit 9: small money guards.
const ME = 'NQ51 KVXF RMYV 9HPD CA8N 5X10 7SUY 2C29 MU2T', TO = 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8'
const POOL = 'NQ16 373T EQ2V JX5B ME74 G056 3TA9 75L3 P717'
const tx = vi.hoisted(() => ({ send: vi.fn(), findOnChain: vi.fn(), waitIncluded: vi.fn(), searchWide: vi.fn(), validUntilOf: vi.fn(async () => null) }))
const chainMock = vi.hoisted(() => ({ getStaker: vi.fn() }))
const cached = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }))
vi.mock('../src/services/tx', async orig => ({ ...(await orig<object>()), ...tx }))
vi.mock('../src/services/chain', async orig => ({ ...(await orig<object>()), ...chainMock }))
vi.mock('../src/router', () => ({ go: vi.fn(), back: vi.fn() }))
vi.mock('../src/lib/fx', () => ({ fxStep: vi.fn(), fxArrival: vi.fn() }))
vi.mock('../src/stores/live', () => ({ currentStaker: () => cached.value, useLive: () => ({ clock: null, derive() {}, refresh: async () => {} }) }))

async function setup() {
  vi.resetModules()
  setActivePinia(createPinia())
  const money = await import('../src/money')
  const flows = await import('../src/flows')
  const { useWallet } = await import('../src/stores/wallet'), { useFlow } = await import('../src/stores/flow')
  const { useOps } = await import('../src/stores/ops'), { usePlan } = await import('../src/stores/plan')
  const { useAccount } = await import('../src/stores/account'), { useUi } = await import('../src/stores/ui')
  const wallet = useWallet(), ui = useUi(), plan = usePlan(), ops = useOps()
  wallet.$patch({ env: 'nimiqpay', address: ME, connected: true, previewAddress: '' })
  vi.spyOn(wallet, 'freshBalance').mockResolvedValue(100_000_000)
  plan.loadFor(ME); ops.load(ME)
  const toasts: string[] = []
  vi.spyOn(ui, 'showToast').mockImplementation((m: string) => { toasts.push(m) })
  vi.spyOn(ui, 'closeSheet').mockImplementation((fn?: () => void) => { fn?.() })
  return { money, flows, wallet, flow: useFlow(), ops, plan, account: useAccount(), toasts }
}

beforeEach(() => {
  memoryStorage()
  cached.value = null
  for (const f of [tx.send, tx.findOnChain, tx.waitIncluded, tx.searchWide, chainMock.getStaker]) f.mockReset()
  tx.send.mockResolvedValue({ status: 'sent', hash: 'h' })
  tx.waitIncluded.mockResolvedValue('ok')
})

describe('a step whose op was pruned', () => {
  it('is "not sure", not "not sent", after a restart', async () => {
    const s = await setup()
    localStorage.setItem('kb:run:' + ME.replace(/\s/g, ''), JSON.stringify({ runPhase: 'running', doneMode: 'full', runAmountLuna: 1, runDry: false, steps: [{ type: 'send', luna: 1, amt: 0, recipient: TO, label: 'x', st: 'waiting', opId: 'pruned' }], wSteps: [], wPhase: 'review' }))
    s.money.restoreRun()
    expect(s.flow.steps[0].st).toBe('unknown')
    expect(s.flow.runPhase).toBe('done')
    expect(s.flow.doneMode).toBe('partial')
  })
})

describe('cancel codes', () => {
  it('every way the SDK says the user declined is "You cancelled"', async () => {
    const { classify } = await import('../src/services/nimiq')
    for (const type of ['PERMISSION_DENIED', 'USER_REJECTED', 'USER_CANCELLED', 'USER_CANCELED', 'CANCELLED', 'CANCELED', 'REJECTED', 'ACTION_REJECTED'])
      expect(classify({ name: 'NimiqProviderError', type, message: 'x' })).toMatchObject({ status: 'rejected' })
    expect(classify({ name: 'NimiqProviderError', type: 'UNKNOWN_ERROR', code: 4001, message: 'x' })).toEqual({ status: 'rejected' })
    expect(classify({ name: 'NimiqProviderError', type: 'NETWORK_ERROR', message: 'x' }).status).toBe('unknown')
    expect(classify({ name: 'NimiqProviderError', type: 'TRANSACTION_OUTCOME_UNKNOWN', message: 'x' }).status).toBe('unknown')
  })
})

describe('keep instead', () => {
  it('is blocked in preview (read only)', async () => {
    const s = await setup()
    s.wallet.$patch({ previewAddress: TO })
    s.account.$patch({ readyLuna: 500 })
    s.plan.$patch({ planStartedAt: 1 })
    s.flows.keepInstead()
    expect(s.plan.ledger).toHaveLength(0)
    expect(s.toasts).toContain('Preview is read only')
  })
})

describe('withdraw', () => {
  it('rebuilds its steps from a fresh staker read before sending', async () => {
    const s = await setup()
    // Cached: 100 NIM inactive. Fresh: already retired (the retire went through elsewhere).
    cached.value = { address: ME, balance: 0, delegation: POOL, inactiveBalance: 100_00000, inactiveFrom: 1, retiredBalance: 0 }
    chainMock.getStaker.mockResolvedValue({ value: { address: ME, balance: 0, delegation: POOL, inactiveBalance: 0, inactiveFrom: null, retiredBalance: 100_00000 }, at: Date.now(), stale: false })
    s.flow.$patch({ wSteps: s.money.withdrawSteps(), wPhase: 'review' })
    expect(s.flow.wSteps.map(x => x.type)).toEqual(['retire', 'remove'])
    await s.money.runWithdraw()
    expect(tx.send).toHaveBeenCalledTimes(1)
    expect(tx.send).toHaveBeenCalledWith({ kind: 'remove', value: 100_00000 })
  })
  it('sends nothing when the fresh read fails', async () => {
    const s = await setup()
    cached.value = { address: ME, balance: 0, delegation: POOL, inactiveBalance: 100_00000, inactiveFrom: 1, retiredBalance: 0 }
    chainMock.getStaker.mockRejectedValue(new Error('down'))
    s.flow.$patch({ wSteps: s.money.withdrawSteps(), wPhase: 'review' })
    await s.money.runWithdraw()
    expect(tx.send).not.toHaveBeenCalled()
    expect(s.flow.wPhase).toBe('review')
  })
})
