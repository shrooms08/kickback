import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_NETWORK, HOST_WAIT_MS, NS, applyNetwork, isTestnet, net, parseNetwork, pickFrom, resolveNetwork, watchLateHost } from '../src/lib/net'
import type { HostRead } from '../src/lib/net'
import { readyLuna } from '../src/lib/money'

/** A fake clock for resolveNetwork: sleep advances `now`. */
function clock() {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => { t += ms } }
}

describe('parseNetwork', () => {
  it('recognises testnet and mainnet in any case, with short forms', () => {
    expect(parseNetwork('testnet')).toBe('testnet')
    expect(parseNetwork(' TestNet ')).toBe('testnet')
    expect(parseNetwork('test')).toBe('testnet')
    expect(parseNetwork('mainnet')).toBe('mainnet')
    expect(parseNetwork('MAIN')).toBe('mainnet')
  })
  it('anything else is not a network', () => {
    for (const v of [undefined, null, '', 'devnet', 5, {}]) expect(parseNetwork(v)).toBeNull()
  })
})

describe('pickFrom: one host read', () => {
  it('uses the network the host reports', () => {
    expect(pickFrom({ value: 'testnet' }).network).toBe('testnet')
    expect(pickFrom({ value: 'mainnet' })).toEqual({ network: 'mainnet', source: 'Nimiq Pay host', reported: true })
    expect(pickFrom({ value: 'testnet' }).reported).toBe(true)
  })
  it('a missing or unknown host value keeps mainnet, flagged as not reported (never silent)', () => {
    expect(DEFAULT_NETWORK).toBe('mainnet')
    for (const value of [undefined, 'devnet']) {
      const p = pickFrom({ value })
      expect(p.network).toBe('mainnet')
      expect(p.reported).toBe(false)
    }
    expect(pickFrom({ value: 'devnet' }).source).toContain('unknown host value "devnet"')
  })
  it('a getHostNetwork exception is kept as an error, not swallowed', () => {
    expect(pickFrom({ value: undefined, error: 'getHostNetwork() threw: boom' }).error).toBe('getHostNetwork() threw: boom')
  })
})

describe('resolveNetwork: waits briefly for the host', () => {
  it('a value that is already there resolves at once', async () => {
    const c = clock()
    const read = vi.fn((): HostRead => ({ value: 'testnet' }))
    const p = await resolveNetwork({ read, ...c })
    expect(p).toEqual({ network: 'testnet', source: 'Nimiq Pay host', reported: true })
    expect(read).toHaveBeenCalledTimes(1)
  })
  it('a value that arrives late (within the wait) is used', async () => {
    const c = clock()
    const read = (): HostRead => ({ value: c.now() >= 500 ? 'mainnet' : undefined })
    const p = await resolveNetwork({ read, ...c })
    expect(p.network).toBe('mainnet')
    expect(p.source).toBe('Nimiq Pay host (after 500 ms)')
  })
  it('a value that arrives late as testnet is used (not the mainnet default)', async () => {
    const c = clock()
    const p = await resolveNetwork({ read: () => ({ value: c.now() >= 1_500 ? 'testnet' : undefined }), ...c })
    expect(p).toMatchObject({ network: 'testnet', reported: true })
  })
  it('a host that never reports gets mainnet after about 2 s, flagged as not reported', async () => {
    const c = clock()
    const p = await resolveNetwork({ read: () => ({ value: undefined }), ...c })
    expect(p.network).toBe('mainnet')
    expect(p.reported).toBe(false)
    expect(c.now()).toBe(HOST_WAIT_MS)
    expect(HOST_WAIT_MS).toBe(2000)
    expect(p.source).toMatch(/^default mainnet \(host gave no network after 2000 ms\)$/)
  })
  it('an unknown value keeps being polled, then falls back to mainnet, not reported', async () => {
    const c = clock()
    const p = await resolveNetwork({ read: () => ({ value: 'Testnet-2' }), ...c })
    expect(p).toMatchObject({ network: 'mainnet', reported: false })
    expect(c.now()).toBe(HOST_WAIT_MS)
  })
  it('a network that arrived late earlier in this session (hint) is used, still flagged not reported', async () => {
    const c = clock()
    expect(await resolveNetwork({ read: () => ({ value: undefined }), fallback: 'testnet', ...c })).toMatchObject({ network: 'testnet', reported: false })
  })
})

describe('applyNetwork: one config object, updated in place', () => {
  afterEach(() => applyNetwork({ network: 'mainnet', source: 'test', reported: true }))
  it('testnet: testnet endpoints, genesis and the t: storage namespace', () => {
    applyNetwork({ network: 'testnet', source: 'x', reported: true })
    expect(net.rpcUrl).toBe('https://rpc.testnet.nimiqwatch.com')
    expect(net.validatorsApiUrl).toBe('https://validators-api-test.je-cf9.workers.dev')
    expect(net.genesisBlock).toBe(3_032_010)
    expect(isTestnet).toBe(true)
    expect(NS).toBe('t:')
  })
  it('mainnet: mainnet endpoints and unchanged storage keys; importers see the new value', () => {
    const same = net
    applyNetwork({ network: 'mainnet', source: 'x', reported: false })
    expect(same.rpcUrl).toBe('https://rpc.nimiqwatch.com')
    expect(same.reported).toBe(false)
    expect(same.genesisBlock).toBe(3_456_000)
    expect(isTestnet).toBe(false)
    expect(NS).toBe('')
  })
  it('outside Nimiq Pay (unit tests) the provisional network is mainnet, not reported, mainnet keys unchanged', async () => {
    vi.resetModules()
    const fresh = await import('../src/lib/net')
    expect(fresh.net.network).toBe('mainnet')
    expect(fresh.net.reported).toBe(false)
    expect(fresh.NS).toBe('')
  })
})

describe('watchLateHost: re-resolves when the host value arrives after start', () => {
  afterEach(() => vi.useRealTimers())
  it('reports the network once it shows up', () => {
    vi.useFakeTimers()
    let value: unknown
    const onArrive = vi.fn()
    watchLateHost(onArrive, { read: () => ({ value }), everyMs: 100, forMs: 5000 })
    vi.advanceTimersByTime(1000)
    expect(onArrive).not.toHaveBeenCalled()
    value = 'mainnet'
    vi.advanceTimersByTime(100)
    expect(onArrive).toHaveBeenCalledWith('mainnet')
    vi.advanceTimersByTime(1000)
    expect(onArrive).toHaveBeenCalledTimes(1)
  })
  it('stops looking after its window', () => {
    vi.useFakeTimers()
    let value: unknown
    const onArrive = vi.fn()
    watchLateHost(onArrive, { read: () => ({ value }), everyMs: 100, forMs: 1000 })
    vi.advanceTimersByTime(1500)
    value = 'mainnet'
    vi.advanceTimersByTime(500)
    expect(onArrive).not.toHaveBeenCalled()
  })
})

describe('readyLuna test kickbacks', () => {
  it('a testnet test kickback counts once a plan exists, whenever it was marked', () => {
    const marked = [{ at: 10, luna: 100_000, manual: true }]
    expect(readyLuna(marked, null, [])).toBe(0)
    expect(readyLuna(marked, 1_000, [])).toBe(100_000)
    expect(readyLuna(marked, 1_000, [{ luna: 40_000, at: 2_000 }])).toBe(60_000)
  })
})
