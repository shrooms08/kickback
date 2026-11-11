// Every account Nimiq Pay has listed for a wallet: the wallet address (accounts[0], the staking
// owner) and its HTLC "remote accounts". Nimiq Pay keeps the spendable NIM in an HTLC shared with
// its cosigner and pays out of it, and replaces the HTLC about weekly and on top-ups (SDK 0.2.5
// README, "Wallet balance"). Transactions from any of these are the wallet's own, also from an
// HTLC Pay has since replaced, so every address seen is remembered (per network, newest first).
import { prefGet, prefSet } from './cache'
import { sameAddress } from './address'

const MAX = 12
const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()
const key = (base: string) => 'accounts:' + compact(base)

/** Every account seen for this wallet, newest first (the wallet address included). */
export function knownAccounts(base: string): string[] {
  try {
    const v = JSON.parse(prefGet(key(base)) || '[]')
    return Array.isArray(v) ? v.filter((a): a is string => typeof a === 'string') : []
  }
  catch { return [] }
}

/** Add the accounts Nimiq Pay lists now (newest first, no duplicates). */
export function rememberAccounts(base: string, accounts: readonly string[]) {
  const seen = new Set<string>()
  const merged = [...accounts, ...knownAccounts(base)].filter((a) => { const c = compact(a); if (seen.has(c)) return false; seen.add(c); return true })
  prefSet(key(base), JSON.stringify(merged.slice(0, MAX)))
}

/** Is `address` the wallet itself or one of its HTLC accounts? */
export function isOwn(base: string, address: string | null | undefined): boolean {
  if (!address) return false
  return sameAddress(base, address) || knownAccounts(base).some(a => sameAddress(a, address))
}

/** The wallet's HTLC accounts (everything but the wallet address), newest first. */
export function ownContracts(base: string): string[] {
  return knownAccounts(base).filter(a => !sameAddress(a, base))
}
