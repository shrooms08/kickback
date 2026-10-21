import { init, NimiqProviderError } from '@nimiq/mini-app-sdk'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import type { SendRequest } from './sendTypes'
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
}

// ---------- "Nimiq network is not ready" ----------
// Right after boot Nimiq Pay may still be syncing: wallet calls reject with
// NETWORK_ERROR "Nimiq network is not ready" (seen on a phone 272 ms after
// boot). The host refuses before doing anything, so it is safe to retry,
// including send calls: nothing was sent.

export const NOT_READY_BACKOFF = [1000, 2000, 3000, 4000, 5000]

export function isHostNotReady(error: unknown): boolean {
  return NimiqProviderError.is(error) && error.type === 'NETWORK_ERROR' && /not ready/i.test(error.message)
}

/** Run a wallet call, retrying up to 5 times (1s..5s) while the host is still syncing. */
export async function whenHostReady<T>(what: string, fn: () => Promise<T>, onRetry?: (attempt: number) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    }
    catch (error) {
      if (!isHostNotReady(error) || attempt >= NOT_READY_BACKOFF.length) throw error
      useDiag().error(`${what} (host not ready, retry ${attempt + 1}/5)`, error)
      onRetry?.(attempt + 1)
      await new Promise(r => setTimeout(r, NOT_READY_BACKOFF[attempt]))
    }
  }
}

/** Reads a balance (with the not-ready retry) and records the raw result and timing for Diagnostics. */
export async function readBalance(address: string, onRetry?: (attempt: number) => void): Promise<number> {
  const nimiq = await getProvider()
  const diag = useDiag()
  if (typeof nimiq.getBalance !== 'function') {
    const e = new Error('getBalance is not available in this Nimiq Pay version. Update Nimiq Pay.')
    diag.error('getBalance', e)
    throw e
  }
  return whenHostReady('getBalance', async () => {
    const t0 = performance.now()
    try {
      const raw = await nimiq.getBalance(address)
      diag.recordBalance(raw, performance.now() - t0)
      return raw
    }
    catch (error) {
      if (!isHostNotReady(error)) diag.error(`getBalance (${Math.round(performance.now() - t0)} ms)`, error)
      throw error
    }
  }, onRetry)
}

/**
 * Connect wallet: ask for the user's accounts (Nimiq Pay shows a confirmation)
 * and take the first address. The balance is read separately (SDK with
 * retries, RPC as fallback) so a syncing host never blocks or zeroes Home.
 */
export async function connectAccount(): Promise<ConnectedAccount> {
  const nimiq = await getProvider()
  const diag = useDiag()
  const t0 = performance.now()
  let accounts: string[]
  try {
    accounts = await whenHostReady('listAccounts', () => nimiq.listAccounts())
    diag.listAccountsMs = Math.round(performance.now() - t0)
    diag.accounts = Array.isArray(accounts) ? accounts.slice() : accounts
  }
  catch (error) {
    diag.error('listAccounts', error)
    throw error
  }
  const address = accounts[0]
  if (!address) throw new Error('No Nimiq account available.')
  return { address }
}

/**
 * Sign a text message with the wallet (Nimiq Pay shows it and asks first). The host signs
 * SHA-256("\x16Nimiq Signed Message:\n" + byte length + message) with Ed25519 and returns
 * hex strings (nimiq-pay-app useMiniAppHost.ts). Rejection throws a NimiqProviderError
 * (see isUserRejection).
 */
export async function signMessage(message: string): Promise<{ publicKey: string, signature: string }> {
  const nimiq = await getProvider()
  if (typeof (nimiq as unknown as { sign?: unknown }).sign !== 'function') throw new Error('This Nimiq Pay version cannot sign messages.')
  const r = await nimiq.sign(message)
  if (!r || typeof r.publicKey !== 'string' || typeof r.signature !== 'string') throw new Error('Nimiq Pay returned no signature.')
  return { publicKey: r.publicKey, signature: r.signature }
}

// ---------- sending ----------

export type SubmitResult =
  | { status: 'sent', hash: string }
  /** The user closed or declined the Nimiq Pay confirmation. */
  | { status: 'rejected' }
  /** The host refused before sending (bad parameters, unsupported, still syncing). */
  | { status: 'not-sent', error: string }
  /** Network or unknown error after the request reached the wallet: it may have gone out. Check the chain. */
  | { status: 'unknown', error: string }

function describe(error: unknown): string {
  if (NimiqProviderError.is(error)) return `${error.type}${error.code != null ? ` ${error.code}` : ''}: ${error.message}`
  return toMessage(error)
}

/** Send one transaction through Nimiq Pay. Each call shows its own approval. */
export async function submit(req: SendRequest): Promise<SubmitResult> {
  const nimiq = await getProvider()
  const call = (): Promise<string> => {
    switch (req.kind) {
      case 'payment':
        return req.data
          ? nimiq.sendBasicTransactionWithData({ recipient: req.recipient!, value: req.value, data: req.data })
          : nimiq.sendBasicTransaction({ recipient: req.recipient!, value: req.value })
      case 'newStaker': return nimiq.sendNewStakerTransaction({ delegation: req.delegation!, value: req.value })
      case 'addStake': return nimiq.sendStakeTransaction({ value: req.value })
      case 'setActive': return nimiq.sendSetActiveStakeTransaction({ newActiveBalance: req.value })
      case 'updateStaker': return nimiq.sendUpdateStakerTransaction({ newDelegation: req.newDelegation!, reactivateAllStake: true })
      case 'retire': return nimiq.sendRetireStakeTransaction({ retireStake: req.value })
      case 'remove': return nimiq.sendRemoveStakeTransaction({ value: req.value })
    }
  }
  try {
    const hash = await whenHostReady(req.kind, call)
    return { status: 'sent', hash }
  }
  catch (error) {
    useDiag().error(`send ${req.kind}`, error)
    return classify(error)
  }
}

/** Map a wallet error to what we can honestly say about it. */
export function classify(error: unknown): SubmitResult {
  if (NimiqProviderError.is(error)) {
    if (error.type === 'PERMISSION_DENIED' || error.code === 4001) return { status: 'rejected' }
    if (isHostNotReady(error)) return { status: 'not-sent', error: describe(error) }
    if (error.type === 'INVALID_TRANSACTION' || error.type === 'UNKNOWN_REQUEST') return { status: 'not-sent', error: describe(error) }
  }
  // NETWORK_ERROR, INTERNAL_ERROR, UNKNOWN_ERROR, anything else: maybe sent.
  return { status: 'unknown', error: describe(error) }
}
