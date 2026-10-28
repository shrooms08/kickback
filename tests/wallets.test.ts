import { describe, expect, it } from 'vitest'
import { pickBasic } from '../src/lib/wallets'

const A = 'NQ52 8F3A 0000 0000 0000 0000 0000 2K9D', B = 'NQ07 A3J0 0000 0000 0000 0000 0000 1SE5', C = 'NQ77 0000 0000 0000 0000 0000 0000 0001'

describe('wallet picker: only basic accounts', () => {
  it('drops contract accounts (vesting, HTLC, staking)', () => {
    const r = pickBasic([A, C, B], { [A]: 'basic', [C]: 'staking', [B]: 'basic' }, null)
    expect(r.basic).toEqual([A, B])
  })
  it('prefers the last used basic account, else the first', () => {
    expect(pickBasic([A, B], { [A]: 'basic', [B]: 'basic' }, B).chosen).toBe(B)
    expect(pickBasic([A, B], { [A]: 'basic', [B]: 'basic' }, C).chosen).toBe(A)
  })
  it('an account the RPC could not read is not shown, unless nothing could be read', () => {
    expect(pickBasic([A, B], { [A]: 'basic', [B]: null }, null).basic).toEqual([A])
    expect(pickBasic([A, B], { [A]: null, [B]: null }, null)).toEqual({ basic: [A], chosen: A })
  })
  it('a brand-new account the RPC does not know yet counts as basic', () => {
    expect(pickBasic([A], { [A]: 'unknown' }, null).basic).toEqual([A])
  })
  it('only contracts: falls back to the first account', () => {
    expect(pickBasic([C], { [C]: 'vesting' }, null)).toEqual({ basic: [], chosen: C })
  })
})
