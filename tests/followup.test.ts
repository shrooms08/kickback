import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { memoryStorage } from './helpers/storage'

// Fixes from the security review of the audit fixes (M1-M5, L1-L3, L6, L7, L9).
const ME = 'NQ51 KVXF RMYV 9HPD CA8N 5X10 7SUY 2C29 MU2T', TO = 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8', OTHER = 'NQ16 373T EQ2V JX5B ME74 G056 3TA9 75L3 P717'
const KB = Buffer.from('Kickback').toString('hex')
const H = 3600e3
const chain = vi.hoisted(() => ({ byAddr: {} as Record<string, unknown[]>, mempool: [] as unknown[], fail: false }))
vi.mock('../src/services/rpc', () => ({
  rpc: vi.fn(async (method: string, params: unknown[]) => {
    if (chain.fail) throw new Error('down')
    let value: unknown = null
    if (method === 'mempoolContent') value = chain.mempool
    else if (method === 'getTransactionsByAddress') {
      const list = (chain.byAddr[(params[0] as string).replace(/\s/g, '')] ?? []) as Array<{ hash: string }>
      const from = params[2] ? list.findIndex(t => t.hash === params[2]) + 1 : 0
      value = list.slice(from, from + (params[1] as number))
    }
    else if (method === 'getTransactionByHash') value = Object.values(chain.byAddr).flat().find(t => (t as { hash: string }).hash === params[0]) ?? null
    return { value, at: Date.now(), stale: false }
  }),
  rpcSource: () => 'direct',
  RpcError: class extends Error {},
}))
const submit = vi.hoisted(() => vi.fn())
vi.mock('../src/services/nimiq', async orig => ({ ...(await orig<object>()), submit }))
vi.mock('../src/router', () => ({ go: vi.fn(), back: vi.fn() }))
vi.mock('../src/lib/fx', () => ({ fxStep: vi.fn(), fxArrival: vi.fn() }))
vi.mock('../src/stores/live', () => ({ currentStaker: () => null, useLive: () => ({ clock: null, derive() {}, refresh: async () => {} }) }))

const flush = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)) }
const k = (s: string) => s.replace(/\s/g, '')
const pay = (hash: string, at: number, extra = {}) => ({ hash, from: ME, to: TO, value: 250_000, timestamp: at, blockNumber: 9, executionResult: true, recipientData: KB, ...extra })

async function setup() {
  vi.resetModules()
  setActivePinia(createPinia())
  const money = await import('../src/money')
  const tx = await import('../src/services/tx')
  const { useWallet } = await import('../src/stores/wallet'), { useFlow } = await import('../src/stores/flow')
  const opsMod = await import('../src/stores/ops'), { usePlan } = await import('../src/stores/plan')
  const { useAccount } = await import('../src/stores/account'), { useUi } = await import('../src/stores/ui'), { useDry } = await import('../src/stores/dry')
  const wallet = useWallet(), ui = useUi(), plan = usePlan(), ops = opsMod.useOps()
  wallet.$patch({ env: 'nimiqpay', address: ME, connected: true, previewAddress: '' })
  vi.spyOn(wallet, 'freshBalance').mockResolvedValue(100_000_000)
  plan.loadFor(ME); ops.load(ME)
  plan.$patch({ planStartedAt: Date.now() - 10 * H, contacts: [{ id: 'c1', name: 'Ada', ini: 'A', address: TO }], saved: [100, 0, 0], savedRecipient: 'c1' })
  const toasts: string[] = []
  vi.spyOn(ui, 'showToast').mockImplementation((m: string) => { toasts.push(m) })
  return { money, tx, opsMod, wallet, flow: useFlow(), ops, plan, account: useAccount(), dry: useDry(), toasts }
}
const failedStep = (extra = {}) => ({ runPhase: 'done' as const, doneMode: 'partial' as const, runDry: false, runAmountLuna: 250_000, steps: [{ type: 'send' as const, luna: 250_000, amt: 2.5, recipient: TO, label: 'Send', st: 'failed' as const, runId: 'r1', ...extra }] })

beforeEach(() => {
  memoryStorage()
  Object.assign(chain, { byAddr: {}, mempool: [], fail: false })
  submit.mockReset(); submit.mockResolvedValue({ status: 'rejected' })
})

describe('M1: retry pays only contacts still in the plan', () => {
  it('refuses when the step\'s recipient was removed from the plan', async () => {
    const s = await setup()
    s.account.$patch({ readyLuna: 250_000 })
    s.plan.$patch({ contacts: [{ id: 'c2', name: 'Bo', ini: 'B', address: OTHER }], savedRecipient: 'c2' })
    s.flow.$patch(failedStep())
    await s.money.retryRunLive()
    expect(submit).not.toHaveBeenCalled()
    expect(s.toasts.join(' ')).toMatch(/plan changed/i)
  })
})

describe('M2 + L2: matching does not trust the phone clock, and skips known hashes', () => {
  it('finds a send whose block time is 3 minutes before the (fast) phone clock', async () => {
    const s = await setup()
    const startedAt = Date.now()
    chain.byAddr[k(ME)] = [pay('h', startedAt - 3 * 60e3)]
    expect(await s.tx.findOnChain(ME, { kind: 'payment', value: 250_000, recipient: TO, data: 'Kickback' }, startedAt, undefined, { windowMs: 1 })).toBe('h')
  })
  it('skips hashes already shared or owned by another op', async () => {
    const s = await setup()
    chain.byAddr[k(ME)] = [pay('h', Date.now())]
    expect(await s.tx.findOnChain(ME, { kind: 'payment', value: 250_000, recipient: TO, data: 'Kickback' }, Date.now(), undefined, { windowMs: 1, skip: new Set(['h']) })).toBeNull()
  })
})

describe('M3: an uncertain "not sent" stays held for the validity window', () => {
  it('counts as in flight for about 2 hours, not after it is released or superseded', async () => {
    const s = await setup()
    const base = { flow: 'run' as const, req: { kind: 'payment' as const, value: 250_000, recipient: TO }, address: ME, dry: false, meta: { luna: 250_000, type: 'send' } }
    s.ops.ops.push({ ...base, id: 'a', phase: 'not-sent', startedAt: Date.now() - H, uncertainAt: Date.now() - H })
    s.ops.ops.push({ ...base, id: 'b', phase: 'not-sent', startedAt: Date.now() - 3 * H, uncertainAt: Date.now() - 3 * H })
    s.ops.ops.push({ ...base, id: 'c', phase: 'not-sent', startedAt: Date.now() - 1000 }) // host refused: sure
    s.ops.ops.push({ ...base, id: 'd', phase: 'not-sent', startedAt: Date.now() - H, uncertainAt: Date.now() - H, meta: { ...base.meta, superseded: 'x' } })
    // a (1 h) and b (3 h, past the window but not yet searched) are held; c, d are not.
    expect(s.opsMod.heldLuna(s.ops.ops, false)).toBe(500_000)
    await s.ops.sweepUncertain() // b: nothing on chain, released
    expect(s.opsMod.heldLuna(s.ops.ops, false)).toBe(250_000)
  })
  it('at the end of the window a final search adopts a late transaction', async () => {
    const s = await setup()
    const id = '22222222-2222-4222-8222-222222222222'
    s.ops.ops.push({ id, flow: 'run', req: { kind: 'payment', value: 250_000, recipient: TO, data: 'Kickback' }, address: ME, dry: false, phase: 'not-sent', startedAt: Date.now() - 3 * H, uncertainAt: Date.now() - 3 * H, meta: { luna: 250_000, type: 'send', runId: 'r' } })
    chain.byAddr[k(ME)] = [pay('late', Date.now() - 2.5 * H)]
    await s.ops.sweepUncertain()
    await flush()
    expect(s.ops.byId(id)?.phase).toBe('confirmed')
    expect(s.plan.ledger).toMatchObject([{ id, hash: 'late' }])
  })
  it('without a late transaction the amount is released', async () => {
    const s = await setup()
    s.ops.ops.push({ id: 'e', flow: 'run', req: { kind: 'payment', value: 250_000, recipient: TO, data: 'Kickback' }, address: ME, dry: false, phase: 'not-sent', startedAt: Date.now() - 3 * H, uncertainAt: Date.now() - 3 * H, meta: { luna: 250_000, type: 'send' } })
    await s.ops.sweepUncertain()
    expect(s.ops.byId('e')?.meta?.released).toBeTruthy()
  })
})

describe('M4: the signing account', () => {
  it('the second step waits until the first proves who signed, and stops on a mismatch', async () => {
    const s = await setup()
    s.plan.$patch({ saved: [50, 50, 0] })
    s.account.$patch({ readyLuna: 500_000, staked: true, stakedNim: 100 })
    submit.mockResolvedValue({ status: 'sent', hash: 'f1' })
    chain.byAddr[k(OTHER)] = [{ ...pay('f1', Date.now()), from: OTHER, value: 250_000 }]
    await s.money.runPlanLive()
    await flush(60)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(s.ops.signerMismatch).toBeTruthy()
    expect(s.plan.ledger).toHaveLength(0) // B's payment is not A's share
  })
  it('an uncertain send from another account is found from the recipient side', async () => {
    const s = await setup()
    chain.byAddr[k(TO)] = [{ ...pay('fromB', Date.now()), from: OTHER }]
    expect(await s.tx.searchWide(ME, { kind: 'payment', value: 250_000, recipient: TO, data: 'Kickback' }, Date.now() - 60e3)).toBe('fromB')
  })
})

describe('M5: storage that is full', () => {
  it('a failed write is retried after pruning the cache, and blocks money actions if it still fails', async () => {
    const s = await setup()
    const cache = await import('../src/lib/cache')
    const ls = localStorage as unknown as { setItem: (k: string, v: string) => void }
    const real = ls.setItem.bind(ls)
    let full = true
    ls.setItem = (key: string, v: string) => { if (full && !key.includes(':c:')) throw new Error('QuotaExceededError'); real(key, v) }
    expect(cache.prefSet('plan:x', '1')).toBe(false)
    expect(cache.storageOk()).toBe(false)
    s.flow.$patch(failedStep())
    await s.money.retryRunLive()
    expect(submit).not.toHaveBeenCalled()
    expect(s.toasts.join(' ')).toMatch(/storage/i)
    full = false
    expect(cache.prefSet('plan:x', '1')).toBe(true)
    expect(cache.storageOk()).toBe(true)
  })
  it('the plan is written again after a failed write', async () => {
    const s = await setup()
    const ls = localStorage as unknown as { setItem: (k: string, v: string) => void }
    const real = ls.setItem.bind(ls)
    ls.setItem = () => { throw new Error('QuotaExceededError') }
    s.plan.recordShared(100, 'hx', false, 'send')
    ls.setItem = real
    s.plan.persist()
    expect(localStorage.getItem('kb:plan:' + k(ME))).toContain('hx')
  })
})

describe('L1: active ops are never dropped from storage', () => {
  it('keeps an old in-flight op even with 40 newer ones', async () => {
    const s = await setup()
    s.ops.ops.push({ id: 'old', flow: 'run', req: { kind: 'addStake', value: 1 }, address: ME, dry: false, phase: 'confirming', hash: 'x', startedAt: Date.now() - H })
    for (let i = 0; i < 45; i++) s.ops.ops.push({ id: 'n' + i, flow: 'run', req: { kind: 'addStake', value: 1 }, address: ME, dry: true, phase: 'confirmed', startedAt: Date.now() })
    s.ops.save()
    expect(JSON.parse(localStorage.getItem('kb:ops:' + k(ME))!).some((o: { id: string }) => o.id === 'old')).toBe(true)
  })
})

describe('L3, L6, L7: retry', () => {
  it('L3: refuses when the failed amount is no longer ready to share (shared elsewhere)', async () => {
    const s = await setup()
    s.account.$patch({ readyLuna: 0 })
    s.flow.$patch(failedStep())
    await s.money.retryRunLive()
    expect(submit).not.toHaveBeenCalled()
  })
  it('L6: an unknown step already in the ledger is done, not sent again', async () => {
    const s = await setup()
    const opId = '33333333-3333-4333-8333-333333333333'
    s.account.$patch({ readyLuna: 250_000 })
    s.plan.recordShared(250_000, 'done', false, 'send', 'r1', opId)
    s.flow.$patch(failedStep({ st: 'unknown', opId }))
    await s.money.retryRunLive()
    expect(submit).not.toHaveBeenCalled()
    expect(s.flow.steps[0].st).toBe('approved')
  })
  it('L7: a cancel name the SDK does not define is checked on chain before a re-send', async () => {
    const { classify } = await import('../src/services/nimiq')
    expect(classify({ name: 'NimiqProviderError', type: 'USER_CANCELLED', message: 'x' })).toEqual({ status: 'rejected', soft: true })
    expect(classify({ name: 'NimiqProviderError', type: 'PERMISSION_DENIED', code: 4001, message: 'x' })).toEqual({ status: 'rejected' })
    const s = await setup()
    const opId = '44444444-4444-4444-8444-444444444444'
    s.account.$patch({ readyLuna: 250_000 })
    s.ops.ops.push({ id: opId, flow: 'run', req: { kind: 'payment', value: 250_000, recipient: TO, data: 'Kickback' }, address: ME, dry: false, phase: 'rejected', softCancel: true, startedAt: Date.now() - 60e3, meta: { luna: 250_000, type: 'send', runId: 'r1' } })
    chain.byAddr[k(ME)] = [pay('went', Date.now() - 50e3)]
    s.flow.$patch(failedStep({ st: 'cancelled', opId }))
    await s.money.retryRunLive()
    await flush()
    expect(submit).not.toHaveBeenCalled()
  })
})

describe('L9: switching dry run swaps the run shown', () => {
  it('loads the other mode\'s run instead of carrying this one over', async () => {
    const s = await setup()
    s.flow.$patch(failedStep())
    s.money.persistRun()
    expect(s.money.setDryMode(true)).toBe(true)
    expect(s.flow.steps).toHaveLength(0)
    expect(s.money.setDryMode(false)).toBe(true)
    expect(s.flow.steps).toHaveLength(1)
  })
})
