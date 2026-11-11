import { defineStore } from 'pinia'
import { connectAccount, detectNimiqPay, hasHostContext, isUserRejection, onAccountsChanged, readBalance, toMessage } from '../services/nimiq'
import { useDiag } from './diag'
import { MOCK_ADDRESS, MOCK_BALANCE_NIM, MOCK_CONNECT_MS } from '../services/mock'

const MOCK_SECOND_ADDRESS = 'NQ07 A3J0 7SUY 2C29 MU2T KVXF RMYV 1SE5'
import { isNimiqAddress, lunaToNim, nimToLuna } from '../lib/format'
import { cacheGet, cacheSet, prefGet, prefSet } from '../lib/cache'
import { useDry } from './dry'
import { getAccountBalance, getAccountType, spaced } from '../services/chain'
import { pickBasic } from '../lib/wallets'
import { logError } from '../lib/logError'
import { rememberAccounts } from '../lib/walletAccounts'
import { addressShort } from '../lib/format'

/** One wallet balance refresh at a time per account list (connect and the live refresh both ask). */
let balanceInflight: { key: string, p: Promise<void> } | null = null
/** The accountsChanged listener is registered once per page. */
let accountsListener = false

/** One listed account's balance: from Nimiq Pay, the node, or a saved (stale) node value. luna null = unknown. */
export interface AccountBalance { luna: number | null, source: '' | 'sdk' | 'rpc' | 'cache', at: number, error?: string }

/**
 * detecting:  waiting to see if Nimiq Pay injects the provider
 * nimiqpay:   running inside Nimiq Pay
 * browser:    a normal browser, show "Open Kickback inside Nimiq Pay"
 * mock:       dev only (?mock=1), fake wallet and mock data
 * devpreview: dev only (?preview=NQ..), live data for an address without Nimiq Pay
 */
export type WalletEnv = 'detecting' | 'nimiqpay' | 'browser' | 'mock' | 'devpreview'

export type ConnectResult = { ok: true } | { ok: false, rejected: boolean, message: string }

/** ?mock=1 works only in dev builds, never in production. */
export function mockRequested(): boolean {
  if (!import.meta.env.DEV) return false
  return new URLSearchParams(window.location.search).get('mock') === '1'
}

/** ?preview=NQ.. (dev builds only): read an address with live data in a desktop browser. */
export function devPreviewRequested(): string | null {
  if (!import.meta.env.DEV) return null
  const a = new URLSearchParams(window.location.search).get('preview')
  return a && isNimiqAddress(a) ? spaced(a) : null
}

/** ?wallet=NQ.. (dev builds only): act as that wallet without Nimiq Pay, for dry-run walkthroughs. */
export function devWalletRequested(): string | null {
  if (!import.meta.env.DEV) return null
  const a = new URLSearchParams(window.location.search).get('wallet')
  return a && isNimiqAddress(a) ? spaced(a) : null
}

export const useWallet = defineStore('wallet', {
  state: () => ({
    env: 'detecting' as WalletEnv,
    connected: false,
    address: '',
    balanceLuna: 0,
    /** Read-only preview of another address (Diagnostics). Persisted until cleared. */
    previewAddress: (prefGet('preview') || '') as string,
    /** Balance of the preview address, from RPC getAccountByAddress. */
    previewBalanceLuna: 0,
    /** Where the wallet balance came from; '' = not known yet (never show a fake 0). 'cache' = saved, stale. */
    balanceSource: '' as '' | 'sdk' | 'rpc' | 'cache',
    /** When the shown balance was read (ms). For 'cache' this is the time of the saved value. */
    balanceAt: 0,
    /** Set when Nimiq Pay and the RPC both failed (a saved balance may still be shown, marked stale). */
    balanceError: '',
    /** Basic (non-contract) accounts Nimiq Pay listed. More than one: "Choose wallet". */
    basicAccounts: [] as string[],
    /**
     * Every account Nimiq Pay lists now: the wallet address first, then its HTLC remote account,
     * which holds the spendable NIM (SDK 0.2.5). The wallet balance is the sum of all of them.
     */
    accounts: [] as string[],
    /** Balance of each listed account (Diagnostics). */
    accountBalances: {} as Record<string, AccountBalance>,
  }),
  getters: {
    isMock: s => s.env === 'mock',
    isPreview: s => !!s.previewAddress,
    balanceNim: s => lunaToNim(s.balanceLuna),
    /** The address every screen reads: the preview address if set, else the wallet. */
    effectiveAddress: s => s.previewAddress || s.address,
    /** Spendable balance in Luna for what the screens show (dry run, preview, or the wallet). */
    effectiveBalanceLuna(s): number {
      if (s.env !== 'mock' && useDry().on && !s.previewAddress) return useDry().chain.balanceLuna
      return s.previewAddress ? s.previewBalanceLuna : s.balanceLuna
    },
    effectiveBalanceNim(): number { return lunaToNim(this.effectiveBalanceLuna) },
    /** False until a real balance (SDK, RPC or cache) is known. */
    balanceKnown(s): boolean { return s.env === 'mock' || !!s.previewAddress || useDry().on || s.balanceSource !== '' },
    /** The wallet balance shown is a saved value, not a fresh read. */
    balanceStale(s): boolean { return s.env === 'nimiqpay' && !s.previewAddress && !useDry().on && s.balanceSource === 'cache' },
    /** A preview address is shown instead of the connected Nimiq Pay account. */
    previewingOther(s): boolean { return !!s.previewAddress && s.env === 'nimiqpay' && !!s.address && s.previewAddress.replace(/\s/g, '') !== s.address.replace(/\s/g, '') },
    isDry: s => s.env !== 'mock' && useDry().on,
  },
  actions: {
    /** Synchronous first guess, before the router resolves the first screen. */
    primeEnv() {
      const diag = useDiag()
      diag.hostContextAtBoot = typeof window !== 'undefined' && !!window.nimiqPay
      diag.nimiqAtBoot = typeof window !== 'undefined' && !!window.nimiq
      const devPreview = devPreviewRequested()
      const devWallet = devWalletRequested()
      if (mockRequested()) { this.env = 'mock'; this.previewAddress = ''; diag.detectMethod = 'mock'; diag.detectMs = 0 }
      else if (devPreview) { this.env = 'devpreview'; this.previewAddress = devPreview; this.address = devPreview; this.connected = true }
      else if (devWallet) { this.env = 'devpreview'; this.previewAddress = ''; this.address = devWallet; this.connected = true }
      else if (hasHostContext()) { this.env = 'nimiqpay'; diag.detectMethod = 'host context (sync)'; diag.detectMs = 0 }
      else this.env = 'detecting'
    },
    async detect() {
      if (this.env !== 'detecting') return this.env
      this.env = (await detectNimiqPay()) ? 'nimiqpay' : 'browser'
      return this.env
    },
    setPreview(address: string | null) {
      this.previewAddress = address ? spaced(address) : (this.env === 'devpreview' ? this.address : '')
      this.previewBalanceLuna = 0
      prefSet('preview', address ? this.previewAddress : null)
    },
    useMockAccount() {
      this.address = MOCK_ADDRESS
      this.balanceLuna = nimToLuna(MOCK_BALANCE_NIM)
      this.connected = true
      const diag = useDiag()
      this.basicAccounts = [MOCK_ADDRESS, MOCK_SECOND_ADDRESS]
      this.accounts = [MOCK_ADDRESS]
      diag.accounts = [MOCK_ADDRESS, MOCK_SECOND_ADDRESS]
      diag.listAccountsMs = 0
      diag.recordBalance(this.balanceLuna, 0)
    },
    setBalance(luna: number, source: 'sdk' | 'rpc' | 'cache', at = Date.now()) {
      this.balanceLuna = luna
      this.balanceSource = source
      this.balanceAt = at
      if (source !== 'cache') {
        this.balanceError = ''
        cacheSet('bal:' + this.address.replace(/\s/g, ''), luna)
      }
    },
    /**
     * Wallet balance: the sum over every account Nimiq Pay lists (the wallet address and its HTLC
     * remote account). A saved total shows at once (marked stale). Each account is read with
     * Nimiq Pay's getBalance (retried while the host syncs, 8 s per attempt); if that is not ready,
     * times out or fails, the node of the current network answers for that address. The total is
     * shown once every account has a value; when one can't be read at all, a visible error is set.
     */
    refreshWalletBalance(): Promise<void> {
      if (this.env !== 'nimiqpay' || !this.address) return Promise.resolve()
      const address = this.address
      const accounts = this.accounts.length ? this.accounts.slice() : [address]
      const key = accounts.join('|')
      if (balanceInflight?.key === key) return balanceInflight.p
      const p = this.readWalletBalance(address, accounts).finally(() => { if (balanceInflight?.p === p) balanceInflight = null })
      balanceInflight = { key, p }
      return p
    },
    async readWalletBalance(address: string, accounts: string[] = [address]) {
      if (!this.balanceSource) {
        const c = cacheGet<number>('bal:' + address.replace(/\s/g, ''))
        if (c) this.setBalance(c.v, 'cache', c.t)
      }
      const parts: Record<string, AccountBalance> = {}
      /** Show the total once every account has a value. `final`: this read's last word. */
      const apply = (final: boolean) => {
        if (this.address !== address) return
        this.accountBalances = { ...parts }
        const list = accounts.map(a => parts[a])
        if (list.some(p => !p || p.luna == null)) return
        const total = list.reduce((sum, p) => sum + p.luna!, 0)
        const source = list.some(p => p.source === 'cache') ? 'cache' : list.some(p => p.source === 'rpc') ? 'rpc' : 'sdk'
        // An early node value never replaces a total Nimiq Pay itself gave.
        if (final || this.balanceSource !== 'sdk') this.setBalance(total, source, Math.min(...list.map(p => p.at)))
      }
      await Promise.all(accounts.map(async (a) => {
        parts[a] = await this.readAccountBalance(a, (early) => { if (parts[a]?.source !== 'sdk') { parts[a] = early; apply(false) } })
      }))
      apply(true)
      const errors = accounts.map(a => parts[a]?.error).filter(Boolean)
      if (this.address === address && errors.length) this.balanceError = errors.join(' ')
    },
    /** One account: Nimiq Pay's getBalance, else the node (started early while the host syncs). */
    async readAccountBalance(account: string, onEarly: (p: AccountBalance) => void): Promise<AccountBalance> {
      const label = addressShort(account)
      let rpcP: Promise<AccountBalance> | null = null
      const viaNode = (): Promise<AccountBalance> => rpcP ??= getAccountBalance(account, 0).then(
        (r): AccountBalance => {
          if (r.stale) logError(`balance RPC fallback (${label})`, new Error('RPC failed; using the last saved node value'))
          return { luna: r.value, source: r.stale ? 'cache' : 'rpc', at: r.at }
        },
        (error: unknown): AccountBalance => {
          logError(`balance RPC fallback (${label})`, error)
          return { luna: null, source: '', at: Date.now(), error: (error as Error)?.message || String(error) }
        })
      try {
        const luna = await readBalance(account, () => { void viaNode().then((p) => { if (p.luna != null) onEarly(p) }) })
        return { luna, source: 'sdk', at: Date.now() }
      }
      catch (error) {
        logError(`getBalance gave up for ${label}, using the network node`, error)
        const p = await viaNode()
        if (p.source === 'rpc') return p
        return { ...p, error: `Nimiq Pay: ${(error as Error)?.message || String(error)}. The network node ${p.source === 'cache' ? 'only had an old value' : "didn't answer either"} for ${label}.` }
      }
    },
    /** Read the live total right before a money action (dry run: the fake chain). Nimiq Pay pays out of the HTLC. */
    async freshBalance(): Promise<number> {
      if (this.isDry) return useDry().chain.balanceLuna
      if (this.env !== 'nimiqpay') return this.effectiveBalanceLuna
      const accounts = this.accounts.length ? this.accounts.slice() : [this.address]
      const values = await Promise.all(accounts.map(a => readBalance(a)))
      const at = Date.now()
      this.accountBalances = Object.fromEntries(accounts.map((a, i) => [a, { luna: values[i], source: 'sdk', at }]))
      const total = values.reduce((sum, v) => sum + v, 0)
      this.setBalance(total, 'sdk')
      return total
    },
    /** Diagnostics: read the balance again to see whether Nimiq Pay asks every time. */
    async rereadBalance() {
      const diag = useDiag()
      if (!this.address) return diag.error('getBalance', new Error('Not connected yet.'))
      diag.busy = true
      try {
        if (this.env === 'mock') diag.recordBalance(this.balanceLuna, 0)
        else if (this.env === 'nimiqpay') await this.freshBalance()
        await diag.loadRpc(this.effectiveAddress)
      }
      catch (error) { logError('Run getBalance again', error) }
      finally { diag.busy = false }
    },
    /** Nimiq Pay's current account list (wallet first). Remembered so the HTLCs count as this wallet's own. */
    setAccounts(accounts: string[]) {
      this.accounts = accounts.slice()
      rememberAccounts(accounts[0], accounts)
      useDiag().accounts = accounts.slice()
    },
    /** Pay replaced its HTLC (or the list changed): take the new list and read the balance again. */
    listenForAccountChanges() {
      if (accountsListener) return
      accountsListener = true
      void onAccountsChanged((accounts) => {
        if (!accounts.length) return
        if (accounts[0].replace(/\s/g, '') !== this.address.replace(/\s/g, '')) {
          logError('accountsChanged', new Error(`Nimiq Pay now lists another wallet (${addressShort(accounts[0])}); reopen Kickback to use it`))
          return
        }
        this.setAccounts(accounts)
        void this.refreshWalletBalance()
      }).then((ok) => { if (!ok) accountsListener = false }, (error: unknown) => { accountsListener = false; logError('accountsChanged', error) })
    },
    async connect(): Promise<ConnectResult> {
      if (this.env === 'mock') {
        await new Promise(r => setTimeout(r, MOCK_CONNECT_MS))
        this.useMockAccount()
        return { ok: true }
      }
      if (this.env === 'devpreview') {
        this.connected = true
        return { ok: true }
      }
      try {
        const account = await connectAccount()
        // Kickback acts as the account Nimiq Pay pays from (the first one). Other basic accounts
        // are offered read only; contracts (vesting, HTLC) are skipped. Types are read in the
        // background so a slow RPC never holds up Connect.
        this.address = account.accounts[0]
        // The HTLC remote account(s) are part of this wallet: counted in the balance, never a
        // separate "Switch account" entry (pickBasic keeps basic accounts only).
        this.setAccounts(account.accounts)
        this.basicAccounts = [account.accounts[0]]
        if (account.accounts.length > 1) {
          const types: Record<string, string | null> = {}
          void Promise.all(account.accounts.slice(1).map(async (a) => { types[a] = await getAccountType(a) }))
            .then(() => { if (this.address === account.accounts[0]) this.basicAccounts = pickBasic(account.accounts, types).basic })
            .catch((error: unknown) => logError('account types', error))
        }
        this.connected = true
        this.balanceSource = ''
        this.listenForAccountChanges()
        void this.refreshWalletBalance()
        return { ok: true }
      }
      catch (error) {
        return { ok: false, rejected: isUserRejection(error), message: toMessage(error) }
      }
    },
  },
})
