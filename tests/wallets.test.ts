import { describe, expect, it } from 'vitest'
import { pickBasic } from '../src/lib/wallets'

const A = 'NQ52 8F3A 0000 0000 0000 0000 0000 2K9D', B = 'NQ07 A3J0 0000 0000 0000 0000 0000 1SE5', C = 'NQ77 0000 0000 0000 0000 0000 0000 0001'

// Nimiq Pay pays and signs from its own account (the SDK has no sender parameter), so Kickback
// always acts as accounts[0]; other basic accounts can only be viewed read only.
describe('wallet picker: Nimiq Pay\'s account first, other basic accounts to view', () => {
  it('the account Kickback acts as is always the first one Nimiq Pay lists', () => {
    expect(pickBasic([A, B], { [A]: 'basic', [B]: 'basic' }).primary).toBe(A)
    expect(pickBasic([B, A], { [A]: 'basic', [B]: 'basic' }).primary).toBe(B)
  })
  it('a failed type read for the first account never moves the app to another account', () => {
    expect(pickBasic([A, B], { [A]: null, [B]: 'basic' }).primary).toBe(A)
  })
  it('lists only basic accounts (vesting, HTLC, staking are skipped), Nimiq Pay\'s first', () => {
    expect(pickBasic([A, C, B], { [A]: 'basic', [C]: 'vesting', [B]: 'basic' }).basic).toEqual([A, B])
    expect(pickBasic([A, B], { [A]: 'basic', [B]: 'htlc' }).basic).toEqual([A])
  })
  it('a brand-new account the RPC does not know yet counts as basic', () => {
    expect(pickBasic([A, B], { [A]: 'basic', [B]: 'unknown' }).basic).toEqual([A, B])
  })
  it('an account that could not be read is not offered (the primary always is)', () => {
    expect(pickBasic([A, B], { [A]: null, [B]: null }).basic).toEqual([A])
  })
})
