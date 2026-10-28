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
    /** Where the wallet balance came from; '' = not known yet (never show a fake 0). */
    balanceSource: '' as '' | 'sdk' | 'rpc' | 'cache',
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
    setBalance(luna: number, source: 'sdk' | 'rpc' | 'cache') {
      this.balanceLuna = luna
      this.balanceSource = source
      this.balanceError = ''
      if (source !== 'cache') cacheSet('bal:' + this.address.replace(/\s/g, ''), luna)
    },
    /**
     * Wallet balance: cached value at once, then the SDK (retrying while the
     * host syncs). If the host says "not ready", the RPC balance fills in
     * meanwhile. An error only when the SDK and the RPC both fail.
     */
    async refreshWalletBalance() {
      if (this.env !== 'nimiqpay' || !this.address) return
      const address = this.address
      if (!this.balanceSource) {
        const c = cacheGet<number>('bal:' + address.replace(/\s/g, ''))
        if (c) this.setBalance(c.v, 'cache')
      }
      let rpcTried = false
      const fallback = () => {
        if (rpcTried) return
        rpcTried = true
        getAccountBalance(address).then((r) => { if (this.balanceSource !== 'sdk') this.setBalance(r.value, 'rpc') }).catch(() => {})
      }
      try {
        this.setBalance(await readBalance(address, fallback), 'sdk')
      }
      catch (error) {
        fallback()
        await new Promise(r => setTimeout(r, 4000))
        if (!this.balanceSource) this.balanceError = (error as Error).message || 'Balance unavailable'
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
        else if (this.env === 'nimiqpay') this.balanceLuna = await readBalance(this.address)
        await diag.loadRpc(this.effectiveAddress)
      }
      catch { /* recorded in diag */ }
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
        this.basicAccounts = [account.accounts[0]]
        if (account.accounts.length > 1) {
          const types: Record<string, string | null> = {}
          void Promise.all(account.accounts.slice(1).map(async (a) => { types[a] = await getAccountType(a) }))
            .then(() => { if (this.address === account.accounts[0]) this.basicAccounts = pickBasic(account.accounts, types).basic })
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
