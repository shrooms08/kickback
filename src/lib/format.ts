/** 1 NIM = 100,000 Luna. All on-chain amounts are integers in Luna. */
export const LUNA_PER_NIM = 100_000

export function lunaToNim(luna: number): number {
  return luna / LUNA_PER_NIM
}

export function nimToLuna(nim: number): number {
  return Math.round(nim * LUNA_PER_NIM)
}

const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** "31,480.55": thousands separators, always 2 decimals. */
export function nim2(n: number): string {
  return nf2.format(n)
}

/** Whole number with separators: "25,000". */
export function int0(n: number): string {
  return nf0.format(n)
}

/** Splits a NIM amount for display with dimmed decimals: ["31,480", ".55"]. */
export function nimParts(n: number): [string, string] {
  const [i, d] = nim2(n).split('.')
  return [i, '.' + d]
}

/** Estimates always say "about". */
export function about(text: string): string {
  return `about ${text}`
}

/** "about $40.92" */
export function aboutUsd(usd: number): string {
  return about('$' + nim2(usd))
}

/** "NQ52 8F3A ..." -> "NQ52 · 8F3A" (first group · last group), as the address chip shows it. */
export function addressChip(address: string): string {
  const groups = address.trim().split(/\s+/)
  if (groups.length < 2) return address
  return `${groups[0]} · ${groups[groups.length - 1]}`
}

/** "NQ52 … 8F3A" for support messages. */
export function addressShort(address: string): string {
  const groups = address.trim().split(/\s+/)
  if (groups.length < 2) return address
  return `${groups[0]} … ${groups[groups.length - 1]}`
}

/** Normalises user input to "NQXX XXXX ..." groups of four. */
export function formatAddress(raw: string): string {
  const compact = raw.replace(/\s+/g, '').toUpperCase()
  return compact.replace(/(.{4})/g, '$1 ').trim()
}

/** Nimiq user-friendly address check: NQ + 2 digits + 32 base32 chars (no I, O, W, Z). */
export function isNimiqAddress(raw: string): boolean {
  return /^NQ\d{2}[0-9A-HJ-NP-VXY]{32}$/.test(raw.replace(/\s+/g, '').toUpperCase())
}
