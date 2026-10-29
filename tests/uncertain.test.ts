import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { memoryStorage } from './helpers/storage'

// Audit 4: after an uncertain error nothing is offered again for 10 minutes ("Still checking"),
// and a retry first searches the chain deeper (200 txs / 2 h, plus the mempool) for the old one.
const ME = 'NQ51 KVXF RMYV 9HPD CA8N 5X10 7SUY 2C29 MU2T', TO = 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8', OTHER = 'NQ16 373T EQ2V JX5B ME74 G056 3TA9 75L3 P717'
const KICKBACK_HEX = Buffer.from('Kickback').toString('hex')
const req = { kind: 'payment' as const, value: 250_000, recipient: TO, data: 'Kickback' }
type T = { hash: string, from: string, to: string, value: number, timestamp: number, blockNumber: number, executionResult: boolean, recipientData?: string }

const chain = vi.hoisted(() => ({ history: [] as unknown[], mempool: [] as unknown[], fail: false, source: 'direct' as string, calls: [] as Array<[string, unknown[]]> }))
vi.mock('../src/services/rpc', () => ({
  rpc: vi.fn(async (method: string, params: unknown[]) => {
    chain.calls.push([method, params])
    if (chain.fail) throw new Error('ALL_DOWN')
    let value: unknown
    if (method === 'mempoolContent') value = chain.mempool
    else if (method === 'getTransactionsByAddress') {
      const [, max, startAt] = params as [string, number, string | null]
      const list = chain.history as T[]
      const from = startAt ? list.findIndex(t => t.hash === startAt) + 1 : 0
      value = list.slice(from, from + max)
    }
    else if (method === 'getTransactionByHash') value = (chain.history as T[]).find(t => t.hash === params[0]) ?? null
    else value = null
    return { value, at: Date.now(), stale: false }
  }),
  rpcSource: () => chain.source,
  RpcError: class extends Error {},
}))
vi.mock('../src/services/nimiq', () => ({ submit: vi.fn(async () => ({ status: 'unknown', error: 'NETWORK_ERROR' })) }))

const now = Date.now()
const noise = (n: number, start: number): T[] => Array.from({ length: n }, (_, i) => ({ hash: `n${i}`, from: ME, to: OTHER, value: 1, timestamp: start - i * 1000, blockNumber: 10, executionResult: true }))

beforeEach(() => {
  memoryStorage()
  vi.resetModules()
  setActivePinia(createPinia())
  Object.assign(chain, { history: [], mempool: [], fail: false, source: 'direct', calls: [] })
})
afterEach(() => { vi.useRealTimers() })

describe('wide chain search before a re-send', () => {
  it('finds the old transaction 150 deep (past the first page)', async () => {
    const { searchWide } = await import('../src/services/tx')
    const hit: T = { hash: 'old', from: ME, to: TO, value: 250_000, timestamp: now - 600_000, blockNumber: 9, executionResult: true, recipientData: KICKBACK_HEX }
    chain.history = [...noise(150, now), hit]
    expect(await searchWide(ME, req, now - 700_000)).toBe('old')
  })
  it('a payment with different data is not ours', async () => {
    const { searchWide } = await import('../src/services/tx')
    chain.history = [{ hash: 'x', from: ME, to: TO, value: 250_000, timestamp: now - 1000, blockNumber: 9, executionResult: true, recipientData: Buffer.from('rent').toString('hex') }]
    expect(await searchWide(ME, req, now - 60_000)).toBeNull()
  })
  it('finds it in the mempool when it is not in a block yet', async () => {
    const { searchWide } = await import('../src/services/tx')
    chain.mempool = [{ hash: 'pending', from: ME, to: TO, value: 250_000, recipientData: KICKBACK_HEX }]
    expect(await searchWide(ME, req, now - 60_000)).toBe('pending')
  })
  it('reads at least 200 transactions or 2 hours', async () => {
    const { searchWide } = await import('../src/services/tx')
    chain.history = noise(400, now)
    expect(await searchWide(ME, req, now - 1000)).toBeNull()
    const read = chain.calls.filter(c => c[0] === 'getTransactionsByAddress').reduce((a, c) => a + (c[1][1] as number), 0)
    expect(read).toBeGreaterThanOrEqual(200)
  })
  it('nothing could be read: unknown, never "not sent"', async () => {
    const { searchWide, UNKNOWN } = await import('../src/services/tx')
    chain.fail = true
    expect(await searchWide(ME, req, now - 1000)).toBe(UNKNOWN)
  })
})

describe('an uncertain send stays "checking" for 10 minutes', () => {
  it('does not say "not sent" after 1 minute, only after 10', async () => {
    vi.useFakeTimers({ now })
    const { useOps } = await import('../src/stores/ops')
    const ops = useOps(); ops.load(ME)
    void ops.execute('run', req, ME, { step: 0, luna: 250_000, type: 'send' })
    const id = ops.ops[0].id
    await vi.advanceTimersByTimeAsync(90_000)
    expect(ops.byId(id)?.phase).toBe('checking')
    expect(ops.byId(id)?.uncertainAt).toBeTypeOf('number')
    await vi.advanceTimersByTimeAsync(9 * 60_000)
    expect(ops.byId(id)?.phase).toBe('not-sent')
  })
})

describe('retry after an uncertain error', () => {
  it('finds the earlier send on chain and does not pay again', async () => {
    vi.doMock('../src/router', () => ({ go: vi.fn(), back: vi.fn() }))
    vi.doMock('../src/lib/fx', () => ({ fxStep: vi.fn() }))
    vi.doMock('../src/stores/live', () => ({ currentStaker: () => null, useLive: () => ({ clock: null }) }))
    const nimiq = await import('../src/services/nimiq')
    const money = await import('../src/money')
    const { useOps } = await import('../src/stores/ops'), { useFlow } = await import('../src/stores/flow')
    const { usePlan } = await import('../src/stores/plan'), { useWallet } = await import('../src/stores/wallet')
    const wallet = useWallet(), ops = useOps(), flow = useFlow(), plan = usePlan()
    wallet.$patch({ env: 'nimiqpay', address: ME, connected: true, previewAddress: '' })
    vi.spyOn(wallet, 'freshBalance').mockResolvedValue(100_000_000)
    plan.loadFor(ME); ops.load(ME)
    const opId = '11111111-1111-4111-8111-111111111111'
    ops.ops.push({ id: opId, flow: 'run', req, phase: 'not-sent', address: ME, dry: false, startedAt: now - 15 * 60_000, uncertainAt: now - 15 * 60_000, meta: { step: 0, luna: 250_000, type: 'send', runId: 'r1' } })
    flow.$patch({ runPhase: 'done', doneMode: 'partial', runDry: false, runAmountLuna: 250_000, steps: [{ type: 'send', luna: 250_000, amt: 2.5, recipient: TO, label: 'Send', st: 'failed', opId, runId: 'r1' }] })
    chain.history = [{ hash: 'late', from: ME, to: TO, value: 250_000, timestamp: now - 14 * 60_000, blockNumber: 9, executionResult: true, recipientData: KICKBACK_HEX }]
    await money.retryRunLive()
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0))
    money.syncRunSteps()
    expect(nimiq.submit).not.toHaveBeenCalled()
    expect(flow.steps[0].st).toBe('approved')
    expect(plan.ledger).toMatchObject([{ id: opId, hash: 'late', luna: 250_000 }])
  })
  it('blocks the re-send while the network cannot be read', async () => {
    vi.doMock('../src/router', () => ({ go: vi.fn(), back: vi.fn() }))
    vi.doMock('../src/lib/fx', () => ({ fxStep: vi.fn() }))
    vi.doMock('../src/stores/live', () => ({ currentStaker: () => null, useLive: () => ({ clock: null }) }))
    const nimiq = await import('../src/services/nimiq')
    const money = await import('../src/money')
    const { useOps } = await import('../src/stores/ops'), { useFlow } = await import('../src/stores/flow')
    const { usePlan } = await import('../src/stores/plan'), { useWallet } = await import('../src/stores/wallet')
    const wallet = useWallet(), ops = useOps(), flow = useFlow()
    const { useUi } = await import('../src/stores/ui')
    const toasts: string[] = []
    vi.spyOn(useUi(), 'showToast').mockImplementation((m: string) => { toasts.push(m) })
    wallet.$patch({ env: 'nimiqpay', address: ME, connected: true, previewAddress: '' })
    vi.spyOn(wallet, 'freshBalance').mockResolvedValue(100_000_000)
    usePlan().loadFor(ME); ops.load(ME)
    flow.$patch({ runPhase: 'done', doneMode: 'partial', runDry: false, steps: [{ type: 'send', luna: 250_000, amt: 2.5, recipient: TO, label: 'Send', st: 'failed', opId: 'gone-after-pruning' }] })
    chain.fail = true
    await money.retryRunLive()
    expect(nimiq.submit).not.toHaveBeenCalled()
    expect(flow.steps[0].st).toBe('failed')
    expect(toasts.join(' ')).toMatch(/can't check the network/i)
  })
})

describe('"Still checking" says how long and that it is safe', () => {
  it('shows elapsed time', async () => {
    const { checkingLine } = await import('../src/lib/time')
    expect(checkingLine(now - 130_000, now)).toBe('Still checking if it went through (2m 10s). Nothing is sent twice.')
    expect(checkingLine(now - 5_000, now)).toBe('Still checking if it went through (5s). Nothing is sent twice.')
    expect(checkingLine(undefined, now)).toBe('Checking if it went through…')
  })
})
