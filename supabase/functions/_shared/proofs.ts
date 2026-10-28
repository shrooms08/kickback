// Verify shares and stakes against the chain and record the result. Used by sync (right after a
// write) and season (rechecks what wasn't on chain yet). A row only counts once verified.
import { db } from './db.ts'
import { getTx } from './chain.ts'
import type { Net } from './chain.ts'
import type { Rpc } from './payouts.ts'
import { STAKING_CONTRACT, checkTx, restakeAfterKickback } from './verify.ts'

export interface ShareRow { id: string, address: string, network: Net, amount_luna: number, slice_type: 'send' | 'restake' | 'keep', tx_hash: string | null, status: string }

/** Where a share's tx must have gone: a saved contact (send) or the staking contract (restake). */
async function recipientsFor(row: ShareRow): Promise<string[]> {
  if (row.slice_type === 'restake') return [STAKING_CONTRACT]
  const { data, error } = await db.from('contacts').select('contact_address').eq('address', row.address).eq('network', row.network)
  if (error) throw error
  return (data ?? []).map((c: { contact_address: string }) => c.contact_address)
}

/** When the app reported the share (the server's own time). */
async function reportedAt(row: ShareRow): Promise<number> {
  const { data, error } = await db.from('shares').select('created_at').eq('id', row.id).maybeSingle()
  if (error) throw error
  return data ? Date.parse(data.created_at) : Date.now()
}

/** The wallet's latest known kickback (found on chain by the season scan), as a list of 0 or 1 times. */
async function latestKickback(row: ShareRow): Promise<number[]> {
  const { data, error } = await db.from('kickbacks_seen').select('at').eq('address', row.address).eq('network', row.network)
    .lte('at', new Date(await reportedAt(row)).toISOString()).order('at', { ascending: false }).limit(1)
  if (error) throw error
  return (data ?? []).map((k: { at: string }) => Date.parse(k.at))
}

/** true = verified now; false = not on chain (yet) or doesn't match; throws only on DB errors. */
export async function verifyShare(rpc: Rpc, row: ShareRow): Promise<boolean> {
  if (!row.tx_hash || row.slice_type === 'keep' || row.status !== 'confirmed') return false
  let tx
  try { tx = await getTx(rpc, row.tx_hash) }
  catch { return false } // RPC trouble: try again later
  // A stake already counted as a verified stake event can't also be a restake share.
  const { data: asStake } = await db.from('events').select('id').eq('network', row.network).eq('tx_hash', row.tx_hash).eq('verified', true).limit(1)
  let ok = !asStake?.length && checkTx(tx, { owner: row.address, value: Number(row.amount_luna), to: await recipientsFor(row) })
  if (ok && row.slice_type === 'restake') ok = restakeAfterKickback(tx!.timestamp, await latestKickback(row), await reportedAt(row))
  const now = new Date().toISOString()
  const patch = ok ? { verified: true, block_at: new Date(tx!.timestamp).toISOString(), checked_at: now } : { checked_at: now }
  // Only the row exactly as checked may be marked verified: if the app changed it meanwhile,
  // nothing matches and nothing is verified (a trigger also clears verified on such changes).
  const { data, error } = await db.from('shares').update(patch)
    .eq('id', row.id).eq('address', row.address).eq('network', row.network)
    .eq('tx_hash', row.tx_hash).eq('amount_luna', row.amount_luna).eq('slice_type', row.slice_type).eq('status', 'confirmed')
    .select('id')
  if (error) {
    // Another share already holds this tx (unique verified hash): this one never counts.
    if (error.code === '23505') { await db.from('shares').update({ checked_at: now, check_count: 10 }).eq('id', row.id); return false }
    throw error
  }
  if (!ok) await db.rpc('kickback_share_checked', { p_id: row.id })
  return ok && (data?.length ?? 0) > 0
}

/** A stake or add-stake event counts when its tx went from the wallet to the staking contract. */
export async function verifyStakeEvent(rpc: Rpc, network: Net, id: number, owner: string, hash: string, amountLuna: number | null): Promise<boolean> {
  let tx
  try { tx = await getTx(rpc, hash) }
  catch { return false }
  // A tx already counted as a verified share can't also count as a stake.
  const { data: asShare } = await db.from('shares').select('id').eq('network', network).eq('tx_hash', hash).eq('verified', true).limit(1)
  if (asShare?.length) return false
  if (!checkTx(tx, { owner, to: [STAKING_CONTRACT], ...(amountLuna ? { value: amountLuna } : {}) })) return false
  const { error } = await db.from('events').update({ verified: true }).eq('id', id)
  if (error && error.code !== '23505') throw error
  return !error
}
