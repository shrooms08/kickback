// Nimiq Pay's listAccounts can include contract accounts (vesting, HTLC); their type comes from
// RPC getAccountByAddress ('unknown' = an address the chain hasn't seen yet, a fresh basic
// account; null = couldn't read it). Nimiq Pay signs and pays from its own selected account
// (the SDK has no sender parameter), so Kickback always acts as the first account it lists.
// Other accounts are offered read only: basic ones, and ones whose type couldn't be read (a slow
// or rate-limited node must not hide the picker). Known contracts are skipped.
export type AccountType = string | null

export function pickBasic(accounts: string[], types: Record<string, AccountType>): { primary: string, basic: string[] } {
  const primary = accounts[0]
  const others = accounts.slice(1).filter(a => types[a] === 'basic' || types[a] === 'unknown' || types[a] == null)
  return { primary, basic: [primary, ...others] }
}
