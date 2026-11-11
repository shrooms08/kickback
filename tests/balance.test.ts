import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { memoryStorage } from './helpers/storage'

// Wallet balance: Nimiq Pay's getBalance with an 8 s timeout, then the network node for the same
// address, a visible error when both fail, and a saved value always marked stale.
const ME = 'NQ74 808U MR99 JHE9 CEGB JEAB DF3U 7953 R0C7', OTHER = 'NQ21 C3EU F69A E1GV UFVC XSSJ HLXB SJU5 DRAF'
const HTLC = 'NQ97 GDBS 1HMT ERNN XDVD JTEV 4RL4 2Q9R X66F', HTLC2 = 'NQ57 2F6C X3GB Y9B7 04U5 2BVA 4BVC M2T0 ELRL'
const chain = vi.hoisted(() => ({ getAccountBalance: vi.fn(), getAccountType: vi.fn(async (_a: string): Promise<string | null> => 'basic') }))
vi.mock('../src/services/chain', async orig => ({ ...(await orig<object>()), ...chain }))

type Provider = { listAccounts: () => Promise<string[]>, getBalance?: (a: string) => Promise<unknown>, on?: (e: string, cb: (a: string[]) => void) => void }
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
  chain.getAccountType.mockReset(); chain.getAccountType.mockImplementation(async () => 'basic')
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
    expect(diag.errors.some(e => e.where.startsWith('balance RPC fallback'))).toBe(true)
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

describe('account selection', () => {
  it('the wallet is the first account; the Nimiq Pay HTLC is never offered as a separate account', async () => {
    chain.getAccountType.mockImplementation(async (a: string) => (a === HTLC ? 'htlc' : 'basic'))
    const { w } = await fresh({ listAccounts: async () => [ME, HTLC], getBalance: async () => 0 })
    w.address = ''
    expect((await w.connect()).ok).toBe(true)
    expect(w.address).toBe(ME)
    expect(w.basicAccounts).toEqual([ME])
    await new Promise(r => setTimeout(r, 0))
    expect(w.basicAccounts).toEqual([ME])
    expect(w.accounts).toEqual([ME, HTLC])
  })
  it('another basic account Nimiq Pay lists can still be picked (read only)', async () => {
    chain.getAccountType.mockImplementation(async () => 'basic')
    const { w } = await fresh({ listAccounts: async () => [ME, OTHER], getBalance: async () => 0 })
    w.address = ''
    await w.connect()
    await new Promise(r => setTimeout(r, 0))
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

describe('Nimiq Pay remote account (HTLC): the wallet balance is the sum of every listed account', () => {
  const byAddress = (m: Record<string, number>) => async (a: string) => m[a] ?? 0
  it('wallet 0 + HTLC 110,000 NIM shows 110,000 NIM, and each account in Diagnostics', async () => {
    const { w } = await fresh({ listAccounts: async () => [ME, HTLC], getBalance: byAddress({ [ME]: 0, [HTLC]: TESTNET_LUNA }) })
    w.address = ''
    await w.connect()
    await w.refreshWalletBalance()
    expect(w.balanceLuna).toBe(TESTNET_LUNA)
    expect(w.balanceNim).toBe(110_000)
    expect(w.balanceSource).toBe('sdk')
    expect(w.accountBalances[ME]).toMatchObject({ luna: 0, source: 'sdk' })
    expect(w.accountBalances[HTLC]).toMatchObject({ luna: TESTNET_LUNA, source: 'sdk' })
  })
  it('the HTLC read times out: the node answers for the HTLC, the total still adds up', async () => {
    vi.useFakeTimers()
    chain.getAccountBalance.mockImplementation(async (a: string) => ({ value: a === HTLC ? TESTNET_LUNA : 0, at: 1, stale: false }))
    const { w } = await fresh({ listAccounts: async () => [ME, HTLC], getBalance: async (a: string) => (a === HTLC ? new Promise(() => {}) : 5) })
    w.accounts = [ME, HTLC]
    const p = w.refreshWalletBalance()
    await vi.advanceTimersByTimeAsync(8_000)
    await p
    expect(chain.getAccountBalance).toHaveBeenCalledWith(HTLC, 0)
    expect(chain.getAccountBalance).not.toHaveBeenCalledWith(ME, 0)
    expect(w.balanceLuna).toBe(TESTNET_LUNA + 5)
    expect(w.balanceSource).toBe('rpc')
  })
  it('the HTLC cannot be read at all: no partial total, a visible error naming it', async () => {
    chain.getAccountBalance.mockRejectedValue(new Error('down'))
    const { w } = await fresh({ listAccounts: async () => [ME, HTLC], getBalance: async (a: string) => { if (a === HTLC) throw new Error('host broke'); return 7 } })
    w.accounts = [ME, HTLC]
    await w.refreshWalletBalance()
    expect(w.balanceKnown).toBe(false)
    expect(w.balanceError).toMatch(/NQ97 … X66F/)
  })
  it('freshBalance (before staking or a run) is the same total', async () => {
    const { w } = await fresh({ listAccounts: async () => [ME, HTLC], getBalance: byAddress({ [ME]: 3, [HTLC]: TESTNET_LUNA }) })
    w.accounts = [ME, HTLC]
    expect(await w.freshBalance()).toBe(TESTNET_LUNA + 3)
  })
  it('accountsChanged (Pay replaced its HTLC): takes the new list and reads the new HTLC', async () => {
    let listener: ((a: string[]) => void) | null = null
    const balances: Record<string, number> = { [ME]: 0, [HTLC]: TESTNET_LUNA, [HTLC2]: 0 }
    const { w } = await fresh({ listAccounts: async () => [ME, HTLC], getBalance: async (a: string) => balances[a] ?? 0, on: (_e: string, cb: (a: string[]) => void) => { listener = cb } })
    w.address = ''
    await w.connect()
    await w.refreshWalletBalance()
    expect(w.balanceLuna).toBe(TESTNET_LUNA)
    await new Promise(r => setTimeout(r, 0))
    expect(listener).not.toBeNull()
    balances[HTLC] = 0; balances[HTLC2] = TESTNET_LUNA
    listener!([ME, HTLC2])
    await w.refreshWalletBalance()
    expect(w.accounts).toEqual([ME, HTLC2])
    expect(w.balanceLuna).toBe(TESTNET_LUNA)
    expect(w.accountBalances[HTLC2]).toMatchObject({ luna: TESTNET_LUNA })
    const { isOwn } = await import('../src/lib/walletAccounts')
    expect(isOwn(ME, HTLC)).toBe(true)
    expect(isOwn(ME, HTLC2)).toBe(true)
  })
  it('accountsChanged for another wallet is not taken over (logged instead)', async () => {
    let listener: ((a: string[]) => void) | null = null
    const { w, diag } = await fresh({ listAccounts: async () => [ME, HTLC], getBalance: async () => 0, on: (_e: string, cb: (a: string[]) => void) => { listener = cb } })
    w.address = ''
    await w.connect()
    await new Promise(r => setTimeout(r, 0))
    listener!([OTHER, HTLC2])
    expect(w.address).toBe(ME)
    expect(w.accounts).toEqual([ME, HTLC])
    expect(diag.errors.some(e => e.where === 'accountsChanged')).toBe(true)
  })
})
