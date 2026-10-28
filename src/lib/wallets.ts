// Nimiq Pay's listAccounts can include contract accounts (vesting, HTLC). Kickback only uses
// basic accounts: their type comes from RPC getAccountByAddress. 'unknown' = an address the
// chain hasn't seen yet (a fresh wallet), which is a basic account too. null = couldn't read it.
export type AccountType = string | null

export function pickBasic(accounts: string[], types: Record<string, AccountType>, lastUsed: string | null): { basic: string[], chosen: string } {
  const read = accounts.filter(a => types[a] != null)
  if (!read.length) return { basic: accounts.slice(0, 1), chosen: accounts[0] }
  const basic = read.filter(a => types[a] === 'basic' || types[a] === 'unknown')
  const chosen = basic.find(a => a === lastUsed) ?? basic[0] ?? accounts[0]
  return { basic, chosen }
}
