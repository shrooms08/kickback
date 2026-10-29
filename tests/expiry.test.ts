import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { memoryStorage } from './helpers/storage'

// Final fix 1: a sent transaction that is past its validity window (validityStartHeight + the
// network's transactionValidityWindow from getPolicyConstants) and still not in a block didn't go
// through: the op ends "Didn't go through. Nothing moved." and its amount is ready again.
const ME = 'NQ51 KVXF RMYV 9HPD CA8N 5X10 7SUY 2C29 MU2T', TO = 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8'
const chain = vi.hoisted(() => ({ head: 1000, policy: true as boolean, vsh: 1000 as number | null, included: false }))
vi.mock('../src/services/rpc', () => ({
  rpc: vi.fn(async (method: string) => {
    let value: unknown = null
    if (method === 'getBlockNumber') value = chain.head
    else if (method === 'getPolicyConstants') { if (!chain.policy) throw new Error('not allowed'); value = { transactionValidityWindow: 7200 } }
    else if (method === 'getTransactionByHash') {
      if (chain.included) value = { hash: 'h1', from: ME, to: TO, value: 1, blockNumber: 9000, executionResult: true, timestamp: 1 }
      else if (chain.vsh != null) value = { hash: 'h1', from: ME, to: TO, value: 1, blockNumber: 0, validityStartHeight: chain.vsh, timestamp: 1 }
      else throw Object.assign(new Error('Transaction not found'), { data: 'Transaction not found' })
    }
    return { value, at: Date.now(), stale: false }
  }),
  rpcSource: () => 'direct',
  RpcError: class extends Error {},
}))
vi.mock('../src/services/nimiq', async orig => ({ ...(await orig<object>()), submit: vi.fn(async () => ({ status: 'sent', hash: 'h1' })) }))

beforeEach(() => {
  memoryStorage()
  vi.resetModules()
  setActivePinia(createPinia())
  Object.assign(chain, { head: 1000, policy: true, vsh: 1000, included: false })
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

async function start() {
  const opsMod = await import('../src/stores/ops')
  const { useUi } = await import('../src/stores/ui')
  const toasts: string[] = []
  vi.spyOn(useUi(), 'showToast').mockImplementation((m: string) => { toasts.push(m) })
  const ops = opsMod.useOps(); ops.load(ME)
  void ops.execute('run', { kind: 'payment', value: 250_000, recipient: TO }, ME, { step: 0, luna: 250_000, type: 'send' })
  await vi.advanceTimersByTimeAsync(10)
  return { ops, opsMod, id: ops.ops[0].id, toasts }
}

describe('stuck confirmation', () => {
  it('keeps confirming until the validity window has passed', async () => {
    const s = await start()
    expect(s.ops.byId(s.id)?.validUntil).toBe(8200)
    chain.head = 8200
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(s.ops.byId(s.id)?.phase).toBe('confirming')
  })
  it('past the window and not in a block: "Didn\'t go through. Nothing moved." and the amount is ready again', async () => {
    const s = await start()
    expect(s.opsMod.heldLuna(s.ops.ops, false)).toBe(250_000)
    chain.head = 8201
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    const op = s.ops.byId(s.id)!
    expect(op.phase).toBe('not-sent')
    expect(op.error).toBe('Didn\'t go through. Nothing moved.')
    expect(s.toasts).toContain('Didn\'t go through. Nothing moved.')
    expect(s.opsMod.heldLuna(s.ops.ops, false)).toBe(0)
  })
  it('included at the last moment: confirmed, not expired', async () => {
    const s = await start()
    chain.head = 8201; chain.included = true
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(s.ops.byId(s.id)?.phase).toBe('confirmed')
  })
  it('without the start height, the height at send time is used (never earlier)', async () => {
    chain.vsh = null
    const s = await start()
    expect(s.ops.byId(s.id)?.validUntil).toBe(8200)
  })
  it('policy constants unreadable: it never expires', async () => {
    chain.policy = false
    const s = await start()
    chain.head = 100_000
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(s.ops.byId(s.id)?.phase).toBe('confirming')
  })
})
