// Verify shares and stakes against the chain and record the result. Used by sync (right after a
// write) and season (rechecks what wasn't on chain yet). A row only counts once verified.
import { db } from './db.ts'
import { getTx } from './chain.ts'
import type { Net } from './chain.ts'
import type { Rpc } from './payouts.ts'
import { STAKING_CONTRACT, checkTx } from './verify.ts'

export interface ShareRow { id: string, address: string, network: Net, amount_luna: number, slice_type: 'send' | 'restake' | 'keep', tx_hash: string | null, status: string }

/** Where a share's tx must have gone: a saved contact (send) or the staking contract (restake). */
async function recipientsFor(row: ShareRow): Promise<string[]> {
  if (row.slice_type === 'restake') return [STAKING_CONTRACT]
  const { data, error } = await db.from('contacts').select('contact_address').eq('address', row.address).eq('network', row.network)
  if (error) throw error
  return (data ?? []).map((c: { contact_address: string }) => c.contact_address)
}

/** true = verified now; false = not on chain (yet) or doesn't match; throws only on DB errors. */
export async function verifyShare(rpc: Rpc, row: ShareRow): Promise<boolean> {
  if (!row.tx_hash || row.slice_type === 'keep' || row.status !== 'confirmed') return false
  let tx
  try { tx = await getTx(rpc, row.tx_hash) }
  catch { return false } // RPC trouble: try again later
  const ok = checkTx(tx, { owner: row.address, value: Number(row.amount_luna), to: await recipientsFor(row) })
  const patch = ok ? { verified: true, block_at: new Date(tx!.timestamp).toISOString(), checked_at: new Date().toISOString() } : { checked_at: new Date().toISOString() }
  const { error } = await db.from('shares').update(patch).eq('id', row.id).eq('address', row.address).eq('network', row.network)
  if (error) {
    // Another share already holds this tx (unique verified hash): this one never counts.
    if (error.code === '23505') { await db.from('shares').update({ checked_at: new Date().toISOString() }).eq('id', row.id); return false }
    throw error
  }
  return ok
}

/** A stake or add-stake event counts when its tx went from the wallet to the staking contract. */
export async function verifyStakeEvent(rpc: Rpc, id: number, owner: string, hash: string, amountLuna: number | null): Promise<boolean> {
  let tx
  try { tx = await getTx(rpc, hash) }
  catch { return false }
  if (!checkTx(tx, { owner, to: [STAKING_CONTRACT], ...(amountLuna ? { value: amountLuna } : {}) })) return false
  const { error } = await db.from('events').update({ verified: true }).eq('id', id)
  if (error && error.code !== '23505') throw error
  return !error
}
