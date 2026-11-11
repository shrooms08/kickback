import { defineStore } from 'pinia'
import { connectAccount, detectNimiqPay, hasHostContext, isUserRejection, readBalance, toMessage } from '../services/nimiq'
import { useDiag } from './diag'
import { MOCK_ADDRESS, MOCK_BALANCE_NIM, MOCK_CONNECT_MS } from '../services/mock'

const MOCK_SECOND_ADDRESS = 'NQ07 A3J0 7SUY 2C29 MU2T KVXF RMYV 1SE5'
import { isNimiqAddress, lunaToNim, nimToLuna } from '../lib/format'
import { cacheGet, cacheSet, prefGet, prefSet } from '../lib/cache'
import { useDry } from './dry'
import { getAccountBalance, getAccountType, spaced } from '../services/chain'
import { pickBasic } from '../lib/wallets'
import { logError } from '../lib/logError'

/** One wallet balance refresh at a time per address (connect and the live refresh both ask). */
let balanceInflight: { address: string, p: Promise<void> } | null = null

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
     * Wallet balance: a saved value at once (marked stale), then Nimiq Pay's getBalance (retried
     * while the host syncs, 8 s per attempt). If the host is not ready, times out or fails, the
     * RPC node of the current network fills in for the same address. When both fail, a visible
     * error is set (a saved value stays on screen, marked stale).
     */
    refreshWalletBalance(): Promise<void> {
      if (this.env !== 'nimiqpay' || !this.address) return Promise.resolve()
      const address = this.address
      if (balanceInflight?.address === address) return balanceInflight.p
      const p = this.readWalletBalance(address).finally(() => { if (balanceInflight?.p === p) balanceInflight = null })
      balanceInflight = { address, p }
      return p
    },
    async readWalletBalance(address: string) {
      if (!this.balanceSource) {
        const c = cacheGet<number>('bal:' + address.replace(/\s/g, ''))
        if (c) this.setBalance(c.v, 'cache', c.t)
      }
      // The RPC fallback, started at most once (on the first "not ready" retry, or after a failure).
      let rpcP: Promise<boolean> | null = null
      const fallback = (): Promise<boolean> => rpcP ??= getAccountBalance(address, 0).then((r) => {
        if (this.address !== address) return true
        if (this.balanceSource !== 'sdk') this.setBalance(r.value, r.stale ? 'cache' : 'rpc', r.at)
        if (r.stale) logError('balance RPC fallback', new Error('RPC failed; showing the last saved RPC balance'))
        return !r.stale
      }, (error: unknown) => {
        logError('balance RPC fallback', error)
        return false
      })
      try {
        const luna = await readBalance(address, () => { void fallback() })
        if (this.address === address) this.setBalance(luna, 'sdk')
      }
      catch (error) {
        logError('getBalance gave up, using the network node', error)
        const rpcOk = await fallback()
        if (this.address !== address || rpcOk || this.balanceSource === 'sdk') return
        this.balanceError = `Nimiq Pay: ${(error as Error)?.message || String(error)}. The network node didn't answer either.`
      }
    },
    /** Read the live balance right before a money action (dry run: the fake chain). */
    async freshBalance(): Promise<number> {
      if (this.isDry) return useDry().chain.balanceLuna
      if (this.env !== 'nimiqpay') return this.effectiveBalanceLuna
      const v = await readBalance(this.address)
      this.setBalance(v, 'sdk')
      return v
    },
    /** Diagnostics: read the balance again to see whether Nimiq Pay asks every time. */
    async rereadBalance() {
      const diag = useDiag()
      if (!this.address) return diag.error('getBalance', new Error('Not connected yet.'))
      diag.busy = true
      try {
        if (this.env === 'mock') diag.recordBalance(this.balanceLuna, 0)
        else if (this.env === 'nimiqpay') this.setBalance(await readBalance(this.address), 'sdk')
        await diag.loadRpc(this.effectiveAddress)
      }
      catch (error) { logError('Run getBalance again', error) }
      finally { diag.busy = false }
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
        // Every listed account can be picked at once; contracts drop out when their types arrive.
        this.basicAccounts = account.accounts.slice()
        if (account.accounts.length > 1) {
          const types: Record<string, string | null> = {}
          void Promise.all(account.accounts.slice(1).map(async (a) => { types[a] = await getAccountType(a) }))
            .then(() => { if (this.address === account.accounts[0]) this.basicAccounts = pickBasic(account.accounts, types).basic })
            .catch((error: unknown) => logError('account types', error))
        }
        this.connected = true
        this.balanceSource = ''
        this.refreshWalletBalance()
        return { ok: true }
      }
      catch (error) {
        return { ok: false, rejected: isUserRejection(error), message: toMessage(error) }
      }
    },
  },
})
