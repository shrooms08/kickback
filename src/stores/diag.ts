import { defineStore } from 'pinia'
import { NimiqProviderError, getHostNetwork, getHostLanguage } from '@nimiq/mini-app-sdk'
import { lunaToNim } from '../lib/format'

// Diagnostics for testing the real wallet inside Nimiq Pay. Production-safe:
// it only records what the app already does and shows it in a hidden sheet
// (tap the K logo in the Home header 5 times within 3 seconds).

export const NIMIQ_RPC = 'https://rpc.nimiqwatch.com'

export interface DiagError { where: string, name: string, type?: string, code?: number | string, message: string, data?: string }

/** Full name, type, code and message of anything thrown by the SDK, the RPC or fetch. */
export function describeError(where: string, error: unknown): DiagError {
  const e = (NimiqProviderError.from(error) ?? error) as Record<string, unknown> | null
  if (e && typeof e === 'object') {
    const data = 'data' in e && e.data !== undefined ? safeJson(e.data) : undefined
    return {
      where,
      name: String(e.name ?? (e.constructor as { name?: string } | undefined)?.name ?? 'Error'),
      type: typeof e.type === 'string' ? e.type : undefined,
      code: typeof e.code === 'number' || typeof e.code === 'string' ? e.code : undefined,
      message: String(e.message ?? safeJson(e)),
      data,
    }
  }
  return { where, name: typeof error, message: String(error) }
}

export function safeJson(v: unknown): string {
  try { return JSON.stringify(v) ?? String(v) }
  catch { return String(v) }
}

interface BalanceRead { raw: string, type: string, nim: number | null, ms: number, at: string }

export const useDiag = defineStore('diag', {
  state: () => ({
    hostContextAtBoot: false,
    nimiqAtBoot: false,
    /** How the app decided it is inside Nimiq Pay. */
    detectMethod: '' as '' | 'host context (sync)' | 'init() wait' | 'mock',
    detectMs: null as number | null,
    /** First init() resolve time. */
    initMs: null as number | null,
    accounts: null as string[] | null,
    listAccountsMs: null as number | null,
    balanceReads: [] as BalanceRead[],
    stakerRaw: '' as string,
    accountRaw: '' as string,
    rpcMs: null as number | null,
    errors: [] as DiagError[],
    busy: false,
    rpcLoading: false,
  }),
  actions: {
    error(where: string, error: unknown) {
      this.errors.push(describeError(where, error))
    },
    recordBalance(raw: unknown, ms: number) {
      this.balanceReads.push({
        raw: safeJson(raw),
        type: typeof raw,
        nim: typeof raw === 'number' ? lunaToNim(raw) : null,
        ms: Math.round(ms),
        at: new Date().toLocaleTimeString('en-GB'),
      })
    },
    async rpc(method: string, params: unknown[]): Promise<string> {
      try {
        const res = await fetch(NIMIQ_RPC, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
        })
        const text = await res.text()
        try {
          const json = JSON.parse(text)
          if (json.error) this.errors.push({ where: `RPC ${method}`, name: 'JsonRpcError', code: json.error.code, message: String(json.error.message), data: json.error.data !== undefined ? safeJson(json.error.data) : undefined })
        }
        catch { /* not JSON: shown raw */ }
        return `HTTP ${res.status} ${text}`
      }
      catch (error) {
        this.error(`RPC ${method}`, error)
        return `failed: ${describeError(method, error).message}`
      }
    },
    async loadRpc(address: string) {
      if (this.rpcLoading) return
      this.rpcLoading = true
      this.stakerRaw = ''
      this.accountRaw = ''
      const t0 = performance.now()
      const [staker, account] = await Promise.all([
        this.rpc('getStakerByAddress', [address]),
        this.rpc('getAccountByAddress', [address]),
      ])
      this.rpcMs = Math.round(performance.now() - t0)
      this.stakerRaw = staker
      this.accountRaw = account
      this.rpcLoading = false
    },
  },
})

export function hostInfo() {
  let network = '', language = ''
  try { network = getHostNetwork() ?? '(undefined)'; language = getHostLanguage() ?? '(undefined)' }
  catch { /* outside Nimiq Pay */ }
  return { network, language }
}
