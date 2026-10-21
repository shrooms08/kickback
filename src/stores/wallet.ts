import { defineStore } from 'pinia'
import { connectAccount, detectNimiqPay, hasHostContext, isUserRejection, readBalance, toMessage } from '../services/nimiq'
import { useDiag } from './diag'
import { MOCK_ADDRESS, MOCK_BALANCE_NIM, MOCK_CONNECT_MS } from '../services/mock'
import { lunaToNim, nimToLuna } from '../lib/format'

/**
 * detecting: waiting to see if Nimiq Pay injects the provider
 * nimiqpay:  running inside Nimiq Pay
 * browser:   a normal browser, show "Open Kickback inside Nimiq Pay"
 * mock:      dev only (?mock=1), fake wallet
 */
export type WalletEnv = 'detecting' | 'nimiqpay' | 'browser' | 'mock'

export type ConnectResult = { ok: true } | { ok: false, rejected: boolean, message: string }

/** ?mock=1 works only in dev builds, never in production. */
export function mockRequested(): boolean {
  if (!import.meta.env.DEV) return false
  return new URLSearchParams(window.location.search).get('mock') === '1'
}

export const useWallet = defineStore('wallet', {
  state: () => ({
    env: 'detecting' as WalletEnv,
    connected: false,
    address: '',
    balanceLuna: 0,
  }),
  getters: {
    isMock: s => s.env === 'mock',
    balanceNim: s => lunaToNim(s.balanceLuna),
  },
  actions: {
    /** Synchronous first guess, before the router resolves the first screen. */
    primeEnv() {
      const diag = useDiag()
      diag.hostContextAtBoot = typeof window !== 'undefined' && !!window.nimiqPay
      diag.nimiqAtBoot = typeof window !== 'undefined' && !!window.nimiq
      if (mockRequested()) { this.env = 'mock'; diag.detectMethod = 'mock'; diag.detectMs = 0 }
      else if (hasHostContext()) { this.env = 'nimiqpay'; diag.detectMethod = 'host context (sync)'; diag.detectMs = 0 }
      else this.env = 'detecting'
    },
    async detect() {
      if (this.env !== 'detecting') return this.env
      this.env = (await detectNimiqPay()) ? 'nimiqpay' : 'browser'
      return this.env
    },
    useMockAccount() {
      this.address = MOCK_ADDRESS
      this.balanceLuna = nimToLuna(MOCK_BALANCE_NIM)
      this.connected = true
      const diag = useDiag()
      diag.accounts = [MOCK_ADDRESS]
      diag.listAccountsMs = 0
      diag.recordBalance(this.balanceLuna, 0)
    },
    /** Diagnostics: read the balance again to see whether Nimiq Pay asks every time. */
    async rereadBalance() {
      const diag = useDiag()
      if (!this.address) return diag.error('getBalance', new Error('Not connected yet.'))
      diag.busy = true
      try {
        if (this.env === 'mock') diag.recordBalance(this.balanceLuna, 0)
        else this.balanceLuna = await readBalance(this.address)
        await diag.loadRpc(this.address)
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
      try {
        const account = await connectAccount()
        this.address = account.address
        this.balanceLuna = account.balanceLuna
        this.connected = true
        return { ok: true }
      }
      catch (error) {
        return { ok: false, rejected: isUserRejection(error), message: toMessage(error) }
      }
    },
  },
})
