import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { memoryStorage } from './helpers/storage'

// Wallet balance: Nimiq Pay's getBalance with an 8 s timeout, then the network node for the same
// address, a visible error when both fail, and a saved value always marked stale.
const ME = 'NQ57 2F6C X3GB Y9B7 04U5 2BVA 4BVC M2T0 ELRL', OTHER = 'NQ07 A3J0 7SUY 2C29 MU2T KVXF RMYV 1SE5'
const chain = vi.hoisted(() => ({ getAccountBalance: vi.fn(), getAccountType: vi.fn(async () => 'basic') }))
vi.mock('../src/services/chain', async orig => ({ ...(await orig<object>()), ...chain }))

type Provider = { listAccounts: () => Promise<string[]>, getBalance?: (a: string) => Promise<unknown> }
const host = { provider: null as Provider | null }

async function fresh(provider: Provider) {
  vi.resetModules()
  host.provider = provider
  ;(globalThis as unknown as { window: unknown }).window = { nimiq: provider }
  setActivePinia(createPinia())
  const { useWallet } = await import('../src/stores/wallet')
  const { useDiag } = await import('../src/stores/diag')
  const nimiq = await import('../src/services/nimiq')
  const w = useWallet()
  w.env = 'nimiqpay'
  w.address = ME
  return { w, diag: useDiag(), nimiq }
}

const TESTNET_LUNA = 11_000_000_000 // 110,000 NIM

beforeEach(() => {
  memoryStorage()
  chain.getAccountBalance.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as unknown as { window?: unknown }).window
  vi.restoreAllMocks()
})

describe('balance from Nimiq Pay', () => {
  it('a normal answer is shown as a fresh SDK balance', async () => {
    const { w } = await fresh({ listAccounts: async () => [ME], getBalance: async () => TESTNET_LUNA })
    await w.refreshWalletBalance()
    expect(w.balanceLuna).toBe(TESTNET_LUNA)
    expect(w.balanceSource).toBe('sdk')
    expect(w.balanceNim).toBe(110_000)
    expect(w.balanceStale).toBe(false)
    expect(chain.getAccountBalance).not.toHaveBeenCalled()
  })
  it('connect and the live refresh asking at once read the balance once', async () => {
    const getBalance = vi.fn(async () => TESTNET_LUNA)
    const { w } = await fresh({ listAccounts: async () => [ME], getBalance })
    await Promise.all([w.refreshWalletBalance(), w.refreshWalletBalance()])
    expect(getBalance).toHaveBeenCalledTimes(1)
  })
  it('an answer that is not a Luna amount is an error, never shown', async () => {
    const { nimiq } = await fresh({ listAccounts: async () => [ME], getBalance: async () => '110000' })
    await expect(nimiq.readBalance(ME)).rejects.toThrow(/not a Luna amount/)
  })
})

describe('getBalance timeout and the node fallback', () => {
  it('no answer for 8 s: the node of the current network fills in for the same address', async () => {
    vi.useFakeTimers()
    chain.getAccountBalance.mockResolvedValue({ value: TESTNET_LUNA, at: 1, stale: false })
    const { w, diag } = await fresh({ listAccounts: async () => [ME], getBalance: () => new Promise(() => {}) })
    const p = w.refreshWalletBalance()
    await vi.advanceTimersByTimeAsync(7_999)
    expect(w.balanceSource).toBe('')
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(chain.getAccountBalance).toHaveBeenCalledWith(ME, 0)
    expect(w.balanceLuna).toBe(TESTNET_LUNA)
    expect(w.balanceSource).toBe('rpc')
    expect(w.balanceError).toBe('')
    expect(diag.errors.some(e => /no answer from Nimiq Pay after 8 s/.test(e.message))).toBe(true)
  })
  it('an older host without getBalance uses the node right away', async () => {
    chain.getAccountBalance.mockResolvedValue({ value: TESTNET_LUNA, at: 1, stale: false })
    const { w } = await fresh({ listAccounts: async () => [ME] })
    await w.refreshWalletBalance()
    expect(w.balanceSource).toBe('rpc')
    expect(w.balanceLuna).toBe(TESTNET_LUNA)
  })
  it('both fail: a visible error, and no balance is invented', async () => {
    chain.getAccountBalance.mockRejectedValue(new Error('Network data is unavailable right now'))
    const { w, diag } = await fresh({ listAccounts: async () => [ME], getBalance: async () => { throw new Error('host broke') } })
    await w.refreshWalletBalance()
    expect(w.balanceKnown).toBe(false)
    expect(w.balanceError).toMatch(/host broke/)
    expect(diag.errors.map(e => e.where)).toContain('balance RPC fallback')
    expect(console.warn).toHaveBeenCalled()
  })
  it('both fail with a saved balance: it stays on screen, marked stale, with the error', async () => {
    chain.getAccountBalance.mockRejectedValue(new Error('down'))
    const { w } = await fresh({ listAccounts: async () => [ME], getBalance: async () => { throw new Error('host broke') } })
    const { cacheSet } = await import('../src/lib/cache')
    cacheSet('bal:' + ME.replace(/\s/g, ''), 5_000_000, 1_000)
    await w.refreshWalletBalance()
    expect(w.balanceLuna).toBe(5_000_000)
    expect(w.balanceSource).toBe('cache')
    expect(w.balanceStale).toBe(true)
    expect(w.balanceAt).toBe(1_000)
    expect(w.balanceError).not.toBe('')
  })
  it('a node answer that is only an old cached value counts as stale, not fresh', async () => {
    chain.getAccountBalance.mockResolvedValue({ value: 7, at: 2_000, stale: true })
    const { w } = await fresh({ listAccounts: async () => [ME], getBalance: async () => { throw new Error('host broke') } })
    await w.refreshWalletBalance()
    expect(w.balanceSource).toBe('cache')
    expect(w.balanceStale).toBe(true)
    expect(w.balanceError).toMatch(/host broke/)
  })
  it('a fresh SDK answer clears a stale saved value and its error', async () => {
    const { w } = await fresh({ listAccounts: async () => [ME], getBalance: async () => TESTNET_LUNA })
    w.setBalance(1, 'cache', 1)
    w.balanceError = 'old'
    await w.refreshWalletBalance()
    expect(w.balanceSource).toBe('sdk')
    expect(w.balanceStale).toBe(false)
    expect(w.balanceError).toBe('')
  })
})

describe('the node fallback must not mask its own problems', () => {
  it('getAccountBalance throws on an answer without a balance instead of returning 0', async () => {
    vi.resetModules()
    vi.doUnmock('../src/services/chain')
    vi.doMock('../src/services/rpc', async orig => ({ ...(await orig<object>()), rpc: vi.fn(async () => ({ value: null, at: 1, stale: false })) }))
    const { getAccountBalance } = await import('../src/services/chain')
    await expect(getAccountBalance(ME)).rejects.toThrow(/gave no balance/)
    vi.doUnmock('../src/services/rpc')
  })
})

describe('account selection', () => {
  it('every account Nimiq Pay lists can be picked at once; the wallet is the first', async () => {
    const { w } = await fresh({ listAccounts: async () => [ME, OTHER], getBalance: async () => TESTNET_LUNA })
    w.address = ''
    const r = await w.connect()
    expect(r.ok).toBe(true)
    expect(w.address).toBe(ME)
    expect(w.basicAccounts).toEqual([ME, OTHER])
  })
  it('picking another account shows it as a preview; clearing goes back to the wallet', async () => {
    const { w } = await fresh({ listAccounts: async () => [ME, OTHER], getBalance: async () => TESTNET_LUNA })
    w.setPreview(OTHER)
    expect(w.effectiveAddress).toBe(OTHER)
    expect(w.previewingOther).toBe(true)
    w.setPreview(null)
    expect(w.effectiveAddress).toBe(ME)
    expect(w.previewingOther).toBe(false)
  })
})
