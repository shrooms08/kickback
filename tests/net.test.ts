import { describe, expect, it } from 'vitest'
import { NS, isTestnet, net } from '../src/lib/net'
import { readyLuna } from '../src/lib/money'

describe('network config', () => {
  it('defaults to mainnet outside Nimiq Pay, with mainnet storage keys unchanged', () => {
    expect(net.network).toBe('mainnet')
    expect(isTestnet).toBe(false)
    expect(NS).toBe('')
    expect(net.rpcUrl).toBe('https://rpc.nimiqwatch.com')
    expect(net.validatorsApiUrl).toBe('https://validators-api-main.je-cf9.workers.dev')
    expect(net.genesisBlock).toBe(3_456_000)
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
