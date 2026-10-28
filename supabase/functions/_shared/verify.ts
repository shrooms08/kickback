/**
 * Does an on-chain transaction prove what the app claims? Pure (no Deno APIs), so vitest covers it.
 * A share or stake counts only when the tx exists, executed, was sent by the signed-in wallet,
 * went to an expected recipient (a saved contact, or the staking contract) and, when given,
 * carried exactly the claimed amount.
 */
export const STAKING_CONTRACT = 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001'

export interface ChainTx { hash: string, from: string, to: string, value: number, timestamp: number, blockNumber?: number, executionResult?: boolean }
export interface TxExpect { owner: string, to: string[], value?: number }

const norm = (a: string) => String(a || '').replace(/\s+/g, '').toUpperCase()

export function checkTx(tx: ChainTx | null | undefined, e: TxExpect): boolean {
  // Only an executed tx in a block counts (a missing result is not success).
  if (!tx || tx.executionResult !== true || !(Number(tx.blockNumber) > 0)) return false
  if (norm(tx.from) !== norm(e.owner)) return false
  if (!e.to.some(a => norm(a) === norm(tx.to))) return false
  if (e.value != null && tx.value !== e.value) return false
  return true
}

/**
 * Has this address ever staked? Reads its whole history, newest first, 100 a page: a tx from it to
 * the staking contract (stake, add stake) or from the contract to it (unstaked funds paid out).
 * A history longer than maxPages pages is taken as "has staked" (it is not a new wallet).
 */
export async function everStaked(page: (startAt: string | null) => Promise<ChainTx[]>, address: string, maxPages = 20): Promise<boolean> {
  const me = norm(address), contract = norm(STAKING_CONTRACT)
  let startAt: string | null = null
  for (let i = 0; i < maxPages; i++) {
    const list = await page(startAt)
    if (list.some(t => (norm(t.from) === me && norm(t.to) === contract) || (norm(t.from) === contract && norm(t.to) === me))) return true
    if (list.length < 100) return false
    startAt = list[list.length - 1].hash
  }
  return true
}

/**
 * A restake shares a kickback: its tx must be no older than the latest kickback that had landed
 * when the share was reported. An older stake tx shares nothing new and never counts as a restake.
 */
export function restakeAfterKickback(txAt: number, kickbackTimes: number[], reportedAt: number): boolean {
  const before = kickbackTimes.filter(k => k <= reportedAt)
  return before.length > 0 && txAt >= Math.max(...before)
}
