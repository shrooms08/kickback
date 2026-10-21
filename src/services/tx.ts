// Transaction lifecycle helpers: send, check the chain after an uncertain
// error, and wait for inclusion. Dry run swaps in the fake chain.
import { rpc, RpcError } from './rpc'
import { STAKING_CONTRACT, sameAddr } from './chain'
import type { Tx } from './chain'
import { submit } from './nimiq'
import type { SubmitResult } from './nimiq'
import type { SendRequest } from './sendTypes'
import { useDry } from '../stores/dry'

export const CHECK_WINDOW_MS = 60_000
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

/** Does this on-chain transaction look like the one we tried to send? */
export function matches(tx: Tx & { recipientData?: string }, req: SendRequest, me: string): boolean {
  if (tx.executionResult === false) return false
  switch (req.kind) {
    case 'payment':
      return sameAddr(tx.from, me) && sameAddr(tx.to, req.recipient) && tx.value === req.value
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
 * After a network or unknown error, look for the transaction on chain before
 * saying anything: newest 25 transactions of the address every 5 s, for up to
 * 60 s (10 s in dry run). Returns the hash if it went out.
 */
export async function findOnChain(me: string, req: SendRequest, since: number, onTick?: (msLeft: number) => void): Promise<string | null> {
  const dry = useDry()
  const window = dry.on ? DRY_CHECK_WINDOW_MS : CHECK_WINDOW_MS
  const end = Date.now() + window
  for (;;) {
    if (dry.on) {
      const h = dry.findSince(req, since)
      if (h) return h
    }
    else {
      try {
        const r = await rpc<Tx[]>('getTransactionsByAddress', [me, 25, null], { noStore: true })
        const hit = (r.value || []).find(t => t.timestamp >= since - 30_000 && matches(t, req, me))
        if (hit) return hit.hash
      }
      catch { /* keep looking until the window closes */ }
    }
    const left = end - Date.now()
    onTick?.(Math.max(0, left))
    if (left <= 0) return null
    await sleep(Math.min(5000, left))
  }
}

export type Inclusion = 'ok' | 'failed'

/**
 * Poll getTransactionByHash every 4 s until the transaction is in a block.
 * After 2 minutes `onSlow` fires once and polling carries on in the
 * background (stop it with `signal`). "Transaction not found" means not yet.
 */
export async function waitIncluded(hash: string, opts: { onSlow?: () => void, signal?: { stopped: boolean } } = {}): Promise<Inclusion> {
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
        if (r.value && r.value.blockNumber > 0) return r.value.executionResult === false ? 'failed' : 'ok'
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
