import { init, NimiqProviderError } from '@nimiq/mini-app-sdk'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { lunaToNim } from '../lib/format'
import { useDiag } from '../stores/diag'

/** How long to wait for Nimiq Pay to inject the provider before assuming a normal browser (same as Nimcade). */
const PROVIDER_TIMEOUT_MS = 3000

let providerPromise: Promise<NimiqProvider> | null = null

/**
 * True when Nimiq Pay has already set up the page. `window.nimiqPay` is seeded
 * synchronously before our script runs; `window.nimiq` is the provider itself.
 */
export function hasHostContext(): boolean {
  return typeof window !== 'undefined' && (!!window.nimiqPay || !!window.nimiq)
}

/**
 * Waits for Nimiq Pay to inject the provider. Rejects after the timeout, so a
 * normal desktop browser falls back to the "Open in Nimiq Pay" screen instead
 * of hanging. A rejected attempt is dropped so a retry starts fresh.
 */
export function getProvider(timeout = PROVIDER_TIMEOUT_MS): Promise<NimiqProvider> {
  if (!providerPromise) {
    const t0 = performance.now()
    providerPromise = init({ timeout }).then((p) => {
      const diag = useDiag()
      diag.initMs ??= Math.round(performance.now() - t0)
      return p
    }, (error: unknown) => {
      providerPromise = null
      useDiag().error('init()', error)
      throw error
    })
  }
  return providerPromise
}

/** True when Kickback runs inside Nimiq Pay. */
export async function detectNimiqPay(): Promise<boolean> {
  const t0 = performance.now()
  const diag = useDiag()
  diag.detectMethod = 'init() wait'
  try {
    await getProvider(hasHostContext() ? 10_000 : PROVIDER_TIMEOUT_MS)
    return true
  }
  catch {
    return false
  }
  finally {
    diag.detectMs = Math.round(performance.now() - t0)
  }
}

/** The user closed or declined the Nimiq Pay confirmation. */
export function isUserRejection(error: unknown): boolean {
  return NimiqProviderError.is(error) && (error.type === 'PERMISSION_DENIED' || error.code === 4001)
}

export function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export interface ConnectedAccount {
  address: string
  balanceLuna: number
  balanceNim: number
}

/** Reads a balance and records the raw result and timing for Diagnostics. */
export async function readBalance(address: string): Promise<number> {
  const nimiq = await getProvider()
  const diag = useDiag()
  if (typeof nimiq.getBalance !== 'function') {
    const e = new Error('getBalance is not available in this Nimiq Pay version. Update Nimiq Pay.')
    diag.error('getBalance', e)
    throw e
  }
  const t0 = performance.now()
  try {
    const raw = await nimiq.getBalance(address)
    diag.recordBalance(raw, performance.now() - t0)
    return raw
  }
  catch (error) {
    diag.error(`getBalance (${Math.round(performance.now() - t0)} ms)`, error)
    throw error
  }
}

/**
 * Connect wallet: ask for the user's accounts (Nimiq Pay shows a confirmation),
 * take the first address and read its balance. SDK 0.2.x rejects with
 * NimiqProviderError on wallet errors instead of resolving with `{ error }`.
 */
export async function connectAccount(): Promise<ConnectedAccount> {
  const nimiq = await getProvider()
  const diag = useDiag()
  const t0 = performance.now()
  let accounts: string[]
  try {
    accounts = await nimiq.listAccounts()
    diag.listAccountsMs = Math.round(performance.now() - t0)
    diag.accounts = Array.isArray(accounts) ? accounts.slice() : accounts
  }
  catch (error) {
    diag.error('listAccounts', error)
    throw error
  }
  const address = accounts[0]
  if (!address) throw new Error('No Nimiq account available.')
  const balanceLuna = await readBalance(address)
  diag.loadRpc(address)
  return { address, balanceLuna, balanceNim: lunaToNim(balanceLuna) }
}
