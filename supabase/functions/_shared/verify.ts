/**
 * Does an on-chain transaction prove what the app claims? Pure (no Deno APIs), so vitest covers it.
 * A share or stake counts only when the tx exists, executed, was sent by the signed-in wallet,
 * went to an expected recipient (a saved contact, or the staking contract) and, when given,
 * carried exactly the claimed amount.
 */
export const STAKING_CONTRACT = 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001'

export interface ChainTx { hash: string, from: string, to: string, value: number, timestamp: number, executionResult?: boolean }
export interface TxExpect { owner: string, to: string[], value?: number }

const norm = (a: string) => String(a || '').replace(/\s+/g, '').toUpperCase()

export function checkTx(tx: ChainTx | null | undefined, e: TxExpect): boolean {
  if (!tx || tx.executionResult === false) return false
  if (norm(tx.from) !== norm(e.owner)) return false
  if (!e.to.some(a => norm(a) === norm(tx.to))) return false
  if (e.value != null && tx.value !== e.value) return false
  return true
}
