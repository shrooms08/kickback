// Transaction lifecycle helpers: send, check the chain after an uncertain
// error, and wait for inclusion. Dry run swaps in the fake chain.
import { rpc, rpcSource, RpcError } from './rpc'
import { STAKING_CONTRACT, sameAddr } from './chain'
import type { Tx } from './chain'
import { submit } from './nimiq'
import type { SubmitResult } from './nimiq'
import type { SendRequest } from './sendTypes'
import { useDry } from '../stores/dry'

export const CHECK_WINDOW_MS = 60_000
/** After an uncertain error nothing is offered again for this long ("Still checking if it went through"). */
export const UNCERTAIN_HOLD_MS = 10 * 60_000
/**
 * A signed Nimiq transaction can still be included for about 7,200 blocks (~2 h) after it was
 * made. Until then (plus a margin) an uncertain amount stays held back from Ready to share.
 */
export const VALIDITY_MS = 2 * 3600e3 + 15 * 60_000
/** Block times are compared with the phone's clock, which can be off: allow this much. */
export const MATCH_SLACK_MS = 15 * 60_000
export const DRY_CHECK_WINDOW_MS = 10_000
export const CONFIRM_POLL_MS = 4_000
export const SLOW_AFTER_MS = 120_000

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Send one request: through Nimiq Pay, or simulated in dry run. */
export async function send(req: SendRequest): Promise<SubmitResult> {
  const dry = useDry()
  if (!dry.on) return submit(req)
  const r = await dry.send(req)
  if ('hash' in r) return { status: 'sent', hash: r.hash }
  if (r.error.type === 'PERMISSION_DENIED') return { status: 'rejected' }
  return { status: 'unknown', error: `${r.error.type} ${r.error.code}: ${r.error.message}` }
}

// Staking transaction data starts with the IncomingStakingTransactionData
// type byte (core-rs-albatross): 05 CreateStaker, 06 AddStake, 07 UpdateStaker,
// 08 SetActiveStake, 09 RetireStake. Seen on chain: AddStake = "06…".
const TYPE_BYTE: Partial<Record<SendRequest['kind'], string>> = { newStaker: '05', addStake: '06', updateStaker: '07', setActive: '08', retire: '09' }

const utf8Hex = (text: string) => Array.from(new TextEncoder().encode(text), b => b.toString(16).padStart(2, '0')).join('')

/** Does this on-chain transaction look like the one we tried to send? */
export function matches(tx: Tx & { recipientData?: string }, req: SendRequest, me: string): boolean {
  if (tx.executionResult === false) return false
  switch (req.kind) {
    case 'payment':
      return sameAddr(tx.from, me) && paidAs(tx, req)
    case 'remove':
      // Paid out of the staking contract to us; a fee could come out of the value.
      return sameAddr(tx.from, STAKING_CONTRACT) && sameAddr(tx.to, me) && tx.value <= req.value && tx.value >= req.value - 100_000
    default: {
      if (!sameAddr(tx.from, me) || !sameAddr(tx.to, STAKING_CONTRACT)) return false
      const t = TYPE_BYTE[req.kind]
      if (tx.recipientData && t && !tx.recipientData.startsWith(t)) return false
      if (req.kind === 'newStaker' || req.kind === 'addStake') return tx.value === req.value
      return true
    }
  }
}

/**
 * Same recipient, value and data (from any sender). Data only rules a transaction out when it is
 * there and clearly different: missing a match would mean sending twice.
 */
function paidAs(tx: Tx & { recipientData?: string }, req: SendRequest): boolean {
  if (!sameAddr(tx.to, req.recipient) || tx.value !== req.value || tx.executionResult === false) return false
  const rd = (tx.recipientData ?? '').toLowerCase()
  return !rd || (req.data ? rd.includes(utf8Hex(req.data)) : false)
}

/** The chain couldn't be read reliably: never conclude "not sent" from that. */
export const UNKNOWN = Symbol('unknown')

/**
 * After a network or unknown error, look for the transaction on chain before
 * saying anything: newest 25 transactions of the address every 5 s (20 s after the first
 * minute), for up to 60 s by default (the ops store passes the rest of the 10-minute hold; 10 s in dry run). Returns the hash if it went out, null if a JSON-RPC node
 * answered and it isn't there, UNKNOWN if nothing (or only the REST indexer or the
 * proxy, which can lag) could be read: the caller keeps checking and never offers a re-send.
 */
export async function findOnChain(me: string, req: SendRequest, since: number, onTick?: (msLeft: number) => void, opts: { windowMs?: number, skip?: ReadonlySet<string> } = {}): Promise<string | null | typeof UNKNOWN> {
  const skip = opts.skip ?? new Set<string>()
  const dry = useDry()
  const window = opts.windowMs ?? (dry.on ? DRY_CHECK_WINDOW_MS : CHECK_WINDOW_MS)
  let directReads = 0
  const start = Date.now(), end = start + window
  for (;;) {
    if (dry.on) {
      const h = dry.findSince(req, since)
      if (h) return h
    }
    else {
      try {
        const r = await rpc<Tx[]>('getTransactionsByAddress', [me, 25, null], { noStore: true })
        const hit = (r.value || []).find(t => t.timestamp >= since - MATCH_SLACK_MS && !skip.has(t.hash) && matches(t, req, me))
        if (hit) return hit.hash
        if (rpcSource(r.value) === 'direct') directReads++
      }
      catch { /* keep looking until the window closes */ }
    }
    const left = end - Date.now()
    onTick?.(Math.max(0, left))
    if (left <= 0) return dry.on || directReads > 0 ? null : UNKNOWN
    // Every 5 s for the first minute, then every 20 s (the public node allows ~20 units / 10 s).
    await sleep(Math.min(Date.now() - start < 60_000 ? 5000 : 20_000, left))
  }
}

/**
 * Before anything is sent again after an uncertain error: look deeper than findOnChain. The
 * address history page by page (at least 200 transactions and 2 hours back, at most 500) plus
 * the mempool, for this exact request after `since`. `skipHashes` (already in the ledger) never
 * count, so an earlier identical payment isn't taken for this one. Returns the hash, null when a
 * JSON-RPC node answered both and it isn't there, UNKNOWN otherwise (then nothing is re-sent).
 */
export async function searchWide(me: string, req: SendRequest, since: number, skipHashes: ReadonlySet<string> = new Set()): Promise<string | null | typeof UNKNOWN> {
  const dry = useDry()
  if (dry.on) return dry.findSince(req, since)
  const ok = (t: Tx & { recipientData?: string }) => !skipHashes.has(t.hash) && matches(t, req, me)
  const deep = Math.min(since - MATCH_SLACK_MS, Date.now() - 2 * 3600e3)
  let read = 0, startAt: string | null = null, historyDirect = true
  try {
    for (let page = 0; page < 5; page++) {
      const r: { value: Tx[] } = await rpc<Tx[]>('getTransactionsByAddress', [me, 100, startAt], { noStore: true })
      const list = r.value || []
      if (rpcSource(r.value) !== 'direct') historyDirect = false
      const hit = list.find(t => t.timestamp >= since - MATCH_SLACK_MS && ok(t))
      if (hit) return hit.hash
      read += list.length
      const oldest = list[list.length - 1]
      if (list.length < 100 || !oldest || (read >= 200 && oldest.timestamp < deep)) break
      startAt = oldest.hash
    }
  }
  catch { return UNKNOWN }
  // A payment Nimiq Pay signed from another account never shows in this address's history:
  // look at the recipient's side too (the signer check then stops further sends).
  if (req.kind === 'payment' && req.recipient) {
    try {
      const r = await rpc<Tx[]>('getTransactionsByAddress', [req.recipient, 100, null], { noStore: true })
      const hit = (r.value || []).find(t => t.timestamp >= since - MATCH_SLACK_MS && !skipHashes.has(t.hash) && paidAs(t, req))
      if (hit) return hit.hash
    }
    catch { return UNKNOWN }
  }
  let pending: Array<Tx & { recipientData?: string }>
  try { pending = (await rpc<Array<Tx & { recipientData?: string }>>('mempoolContent', [true], { noStore: true })).value || [] }
  catch { return UNKNOWN }
  const hit = pending.find(t => typeof t === 'object' && !skipHashes.has(t.hash) && (matches({ ...t, executionResult: undefined }, req, me) || (req.kind === 'payment' && paidAs({ ...t, executionResult: undefined }, req))))
  if (hit) return hit.hash
  return historyDirect ? null : UNKNOWN
}

export type Inclusion = 'ok' | 'failed'

/**
 * Poll getTransactionByHash every 4 s until the transaction is in a block.
 * After 2 minutes `onSlow` fires once and polling carries on in the
 * background (stop it with `signal`). "Transaction not found" means not yet.
 */
export async function waitIncluded(hash: string, opts: { onSlow?: () => void, signal?: { stopped: boolean }, onTx?: (tx: Tx) => void } = {}): Promise<Inclusion> {
  const dry = useDry()
  const start = Date.now()
  let slowFired = false
  for (;;) {
    if (opts.signal?.stopped) throw new Error('stopped')
    if (dry.on && dry.txs.some(x => x.hash === hash)) {
      const s = dry.lookup(hash)
      if (s === 'included') return 'ok'
    }
    else {
      try {
        const r = await rpc<Tx | null>('getTransactionByHash', [hash], { noStore: true })
        // Only a real result counts (a fallback source missing the field keeps polling).
        if (r.value && r.value.blockNumber > 0 && typeof r.value.executionResult === 'boolean') {
          opts.onTx?.(r.value)
          return r.value.executionResult ? 'ok' : 'failed'
        }
      }
      catch (error) {
        const notYet = error instanceof RpcError && typeof error.data === 'string' && error.data.startsWith('Transaction not found')
        if (!notYet && !(error instanceof RpcError)) { /* network hiccup: keep polling */ }
      }
    }
    if (!slowFired && Date.now() - start > SLOW_AFTER_MS) { slowFired = true; opts.onSlow?.() }
    await sleep(dry.on ? 1000 : CONFIRM_POLL_MS)
  }
}
