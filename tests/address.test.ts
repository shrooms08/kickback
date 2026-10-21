import { describe, expect, it } from 'vitest'
import { contactAddressProblem, isValidAddress, normalizeAddress, sameAddress } from '../src/lib/address'

// Real mainnet addresses (see docs/data-notes.md).
const REAL = [
  'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8',
  'NQ11 NMR7 4E14 CD4Q 3YEQ DJ67 5L6G YAM7 RNF4',
  'NQ16 373T EQ2V JX5B ME74 G056 3TA9 75L3 P717',
  'NQ77 0000 0000 0000 0000 0000 0000 0000 0001',
]

describe('address validation', () => {
  it('accepts real addresses, with or without spaces and in any case', () => {
    for (const a of REAL) {
      expect(isValidAddress(a)).toBe(true)
      expect(isValidAddress(a.replace(/\s/g, ''))).toBe(true)
      expect(isValidAddress(a.toLowerCase())).toBe(true)
    }
  })
  it('rejects a changed character (checksum), not just the format', () => {
    // Same format as a real address, one character changed: a regex would pass this.
    expect(isValidAddress('NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR9')).toBe(false)
    expect(isValidAddress('NQ04 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8')).toBe(false)
    expect(isValidAddress('NQ08 0000 0000 0000 0000 0000 0000 0000 0000')).toBe(false)
    expect(isValidAddress('NQ07 0000 0000 0000 0000 0000 0000 0000 0000')).toBe(true) // the docs' example address really is valid
  })
  it('rejects wrong length, prefix and alphabet', () => {
    expect(isValidAddress('NQ12 ABCD 1234')).toBe(false)
    expect(isValidAddress('DE03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8')).toBe(false)
    expect(isValidAddress('NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCRO')).toBe(false) // O is not in the alphabet
    expect(isValidAddress('')).toBe(false)
  })
  it('normalizes and compares', () => {
    expect(normalizeAddress('nq03j45b27ltqhd72prm73qpsb15lm6hvcr8')).toBe(REAL[0])
    expect(sameAddress('nq03 j45b27ltqhd72prm73qpsb15lm6hvcr8', REAL[0])).toBe(true)
  })
  it('blocks your own address as a contact', () => {
    expect(contactAddressProblem(REAL[0], REAL[0].toLowerCase())).toBe('own')
    expect(contactAddressProblem(REAL[1], REAL[0])).toBe('')
    expect(contactAddressProblem('NQ00 nope', REAL[0])).toBe('invalid')
  })
})
