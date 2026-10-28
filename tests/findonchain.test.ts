import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const ME = 'NQ51 KVXF RMYV 9HPD CA8N 5X10 7SUY 2C29 MU2T', TO = 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8'
const req = { kind: 'payment' as const, value: 250_000, recipient: TO }

async function load(rpcImpl: () => Promise<unknown>, source: 'direct' | 'rest' | 'proxy') {
  vi.resetModules()
  vi.doMock('../src/services/rpc', () => ({
    rpc: vi.fn(async () => ({ value: await rpcImpl(), at: Date.now(), stale: false })),
    rpcSource: () => source,
    RpcError: class extends Error {},
  }))
  return await import('../src/services/tx')
}

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.doUnmock('../src/services/rpc'))

describe('after an uncertain send: found, absent, or unknown', () => {
  it('found on chain: the hash', async () => {
    const { findOnChain } = await load(async () => [{ hash: 'h1', from: ME, to: TO, value: 250_000, timestamp: Date.now(), blockNumber: 5, executionResult: true }], 'direct')
    expect(await findOnChain(ME, req, Date.now() - 1000, undefined, { windowMs: 10 })).toBe('h1')
  })
  it('a JSON-RPC node answered and it is not there: absent (nothing was sent)', async () => {
    const { findOnChain } = await load(async () => [], 'direct')
    expect(await findOnChain(ME, req, Date.now(), undefined, { windowMs: 10 })).toBeNull()
  })
  it('every read failed: unknown, never "not sent"', async () => {
    const { findOnChain, UNKNOWN } = await load(async () => { throw new Error('ALL_DOWN') }, 'direct')
    expect(await findOnChain(ME, req, Date.now(), undefined, { windowMs: 10 })).toBe(UNKNOWN)
  })
  it('only the REST indexer or the proxy answered (they can lag): unknown', async () => {
    const a = await load(async () => [], 'rest')
    expect(await a.findOnChain(ME, req, Date.now(), undefined, { windowMs: 10 })).toBe(a.UNKNOWN)
    const b = await load(async () => [], 'proxy')
    expect(await b.findOnChain(ME, req, Date.now(), undefined, { windowMs: 10 })).toBe(b.UNKNOWN)
  })
})
