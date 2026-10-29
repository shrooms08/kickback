import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { matches } from '../src/services/tx'

// Final fix 3: a staking transaction only matches when its amount matches too.
// Layout seen on chain: SetActiveStake / RetireStake data = type byte + amount as u64 big-endian + proof.
// e.g. RetireStake 0x09 00000000001e8582 = 2,000,258 Luna (retired, then removed as value 2,000,258).
const ME = 'NQ51 KVXF RMYV 9HPD CA8N 5X10 7SUY 2C29 MU2T', SC = 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001'
const u64 = (n: number) => n.toString(16).padStart(16, '0')
const proof = '0052c06cf20790aa4cef9a'
const toContract = (data: string, value = 0) => ({ hash: 'h', blockNumber: 1, timestamp: 1, from: ME, to: SC, value, fee: 0, recipientData: data, executionResult: true })

beforeEach(() => setActivePinia(createPinia()))

describe('staking amounts', () => {
  it('retire: the amount in the data must match', () => {
    expect(matches(toContract('09' + u64(2_000_258) + proof), { kind: 'retire', value: 2_000_258 }, ME)).toBe(true)
    expect(matches(toContract('09' + u64(12_000_000) + proof), { kind: 'retire', value: 2_000_258 }, ME)).toBe(false)
  })
  it('set active stake: the new active balance in the data must match', () => {
    expect(matches(toContract('08' + u64(0) + proof), { kind: 'setActive', value: 0 }, ME)).toBe(true)
    expect(matches(toContract('08' + u64(500_000_000) + proof), { kind: 'setActive', value: 0 }, ME)).toBe(false)
  })
  it('new stake and add stake: the value must match', () => {
    expect(matches(toContract('06' + 'ab'.repeat(20), 1_000_000), { kind: 'addStake', value: 1_000_000 }, ME)).toBe(true)
    expect(matches(toContract('06' + 'ab'.repeat(20), 999_999), { kind: 'addStake', value: 1_000_000 }, ME)).toBe(false)
  })
  it('remove stake: paid from the contract, the fee may come out of the amount', () => {
    const out = (value: number, fee: number) => ({ hash: 'h', blockNumber: 1, timestamp: 1, from: SC, to: ME, value, fee, senderData: '01', executionResult: true })
    expect(matches(out(2_000_258, 0), { kind: 'remove', value: 2_000_258 }, ME)).toBe(true)
    expect(matches(out(2_000_068, 190), { kind: 'remove', value: 2_000_258 }, ME)).toBe(true)
    expect(matches(out(1_950_000, 0), { kind: 'remove', value: 2_000_258 }, ME)).toBe(false) // was accepted before (100,000 Luna slack)
  })
  it('a source without the data field can\'t rule a staking tx out', () => {
    const t = { ...toContract(''), recipientData: undefined }
    expect(matches(t, { kind: 'retire', value: 5 }, ME)).toBe(true)
  })
})
