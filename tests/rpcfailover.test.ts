import { afterEach, describe, expect, it, vi } from 'vitest'

const ok = (data: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { data, metadata: null } }), { status: 200, headers: { 'content-type': 'application/json' } })
const rpcErr = (data: string) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error', data } }), { status: 200 })

async function load(urls: string[], proxy: string | null) {
  vi.resetModules()
  vi.doMock('../src/lib/net', () => ({ net: { network: 'mainnet', rpcUrl: urls[0], rpcUrls: urls }, isTestnet: false, NS: '' }))
  vi.doMock('../src/services/backend', () => ({ backendUrl: proxy ? 'https://sb.example' : '', backendEnabled: !!proxy }))
  return await import('../src/services/rpc')
}

afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock('../src/lib/net'); vi.doUnmock('../src/services/backend') })

describe('RPC client failover', () => {
  it('primary answering 503: the backup answers', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { seen.push(url); return url.startsWith('https://a') ? new Response('Site not available', { status: 503 }) : ok(15_000_000) }))
    const { rpc, rpcPool } = await load(['https://a.example', 'https://b.example'], null)
    const r = await rpc<number>('getBlockNumber', [], { noStore: true })
    expect(r.value).toBe(15_000_000)
    expect(seen).toEqual(['https://a.example', 'https://b.example'])
    expect(rpcPool.active()).toBe('https://b.example')
  })
  it('"No staker" is an answer from the primary, not a reason to fail over', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { seen.push(url); return rpcErr('No staker with address: NQ00') }))
    const { rpc } = await load(['https://a.example', 'https://b.example'], null)
    const r = await rpc('getStakerByAddress', ['NQ00'], { noStore: true })
    expect(r.value).toBeNull()
    expect(seen).toEqual(['https://a.example'])
  })
  it('every direct endpoint down: the proxy answers', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { seen.push(url); if (url.includes('rpc-proxy')) return ok(7); throw new TypeError('Failed to fetch') }))
    const { rpc } = await load(['https://a.example', 'https://b.example'], 'proxy')
    const r = await rpc<number>('getBlockNumber', [], { noStore: true })
    expect(r.value).toBe(7)
    expect(seen.at(-1)).toBe('https://sb.example/functions/v1/rpc-proxy?network=mainnet')
  })
  it('everything down: a clear "all endpoints down" error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502 })))
    const { rpc, RpcError } = await load(['https://a.example'], 'proxy')
    await expect(rpc('getBlockNumber', [], { noStore: true })).rejects.toMatchObject({ code: 'ALL_DOWN' })
    void RpcError
  })
})

describe('REST fallback (Nimiq.Watch) in the RPC client', () => {
  async function loadRest(urls: string[], proxy: boolean) {
    vi.resetModules()
    vi.doMock('../src/lib/net', () => ({ net: { network: 'mainnet', rpcUrl: urls[0], rpcUrls: urls }, isTestnet: false, NS: '' }))
    vi.doMock('../src/services/backend', () => ({ backendUrl: proxy ? 'https://sb.example' : '', backendEnabled: proxy }))
    return await import('../src/services/rpc')
  }
  it('JSON-RPC nodes down: the staker comes from the REST API', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.startsWith('https://v2.nimiqwatch.com')) return new Response(JSON.stringify({ address: 'NQ03', balance: 5, delegation: 'NQ32', inactiveBalance: 0, inactiveFrom: null, retiredBalance: 0 }), { status: 200 })
      return new Response('down', { status: 503 })
    }))
    const { rpc } = await loadRest(['https://a.example'], false)
    const r = await rpc<{ balance: number }>('getStakerByAddress', ['NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8'], { noStore: true })
    expect(r.value.balance).toBe(5)
    expect(seen.at(-1)).toBe('GET https://v2.nimiqwatch.com/api/v2/staker/NQ03J45B27LTQHD72PRM73QPSB15LM6HVCR8')
  })
  it('a method REST can\'t answer goes on to the proxy, and REST stays healthy', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { seen.push(url); if (url.includes('rpc-proxy')) return ok({ rewardAddress: 'NQ16' }); return new Response('down', { status: 503 }) }))
    const { rpc, rpcPool } = await loadRest(['https://a.example'], true)
    const r = await rpc<{ rewardAddress: string }>('getValidatorByAddress', ['NQ51'], { noStore: true })
    expect(r.value.rewardAddress).toBe('NQ16')
    expect(seen.some(u => u.includes('nimiqwatch.com/api'))).toBe(false)
    expect(rpcPool.status().find(e => e.kind === 'rest')?.state).not.toBe('down')
  })
})
