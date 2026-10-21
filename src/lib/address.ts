import { ValidationUtils } from '@nimiq/utils/validation-utils'

// Nimiq addresses, checked with the official IBAN-style checksum from
// @nimiq/utils (the same check the Nimiq core uses), never just a regex.

/** "nq07 0000…" -> "NQ07 0000 0000 …" */
export function normalizeAddress(raw: string): string {
  return ValidationUtils.normalizeAddress(raw.trim())
}

export function isValidAddress(raw: string): boolean {
  return ValidationUtils.isValidAddress(raw.trim())
}

export function sameAddress(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false
  return a.replace(/\s+/g, '').toUpperCase() === b.replace(/\s+/g, '').toUpperCase()
}

export type AddressProblem = '' | 'invalid' | 'own'

/** Problem with a contact's address, if any. Your own address can't be a contact. */
export function contactAddressProblem(raw: string, ownAddress?: string | null): AddressProblem {
  if (!isValidAddress(raw)) return 'invalid'
  if (ownAddress && sameAddress(raw, ownAddress)) return 'own'
  return ''
}
