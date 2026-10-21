import { describe, expect, it } from 'vitest'
import {
  FEE_RESERVE_LUNA, LUNA, MIN_STAKE_LUNA, checkStake, ledgerFor, maxStake, parseNimInput, readyLuna, runAmount, splitLuna, spendable,
} from '../src/lib/money'

describe('splitLuna', () => {
  it('splits exactly and gives the remainder to the last slice', () => {
    expect(splitLuna(1000, [50, 30, 20])).toEqual([500, 300, 200])
    expect(splitLuna(1001, [50, 30, 20])).toEqual([500, 300, 201])
    expect(splitLuna(7, [33, 33, 34])).toEqual([2, 2, 3])
    expect(splitLuna(1, [50, 50])).toEqual([0, 1])
  })
  it('always sums to the total, for many random totals', () => {
    const plans = [[50, 30, 20], [33, 33, 34], [10, 0, 90], [5, 5, 5, 85], [0, 50, 50], [100, 0, 0]]
    for (let i = 0; i < 2000; i++) {
      const total = Math.floor(Math.random() * 1e12)
      for (const p of plans) {
        const parts = splitLuna(total, p)
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
        expect(parts.every(x => Number.isInteger(x) && x >= 0)).toBe(true)
      }
    }
  })
  it('puts everything in the last slice when all shares are zero', () => {
    expect(splitLuna(500, [0, 0, 0])).toEqual([0, 0, 500])
  })
  it('rejects non-integer totals', () => {
    expect(() => splitLuna(10.5, [50, 50])).toThrow()
    expect(() => splitLuna(-1, [50, 50])).toThrow()
  })
})

describe('parseNimInput', () => {
  it('parses NIM text into integer Luna without float error', () => {
    expect(parseNimInput('100')).toBe(100 * LUNA)
    expect(parseNimInput('0.1')).toBe(10_000)
    expect(parseNimInput('1,234.56789')).toBe(123_456_789)
    expect(parseNimInput('0.00001')).toBe(1)
    expect(parseNimInput('')).toBe(0)
    expect(parseNimInput('abc')).toBe(0)
    expect(parseNimInput('1.123456')).toBe(0)
  })
})

describe('fee reserve and caps', () => {
  it('keeps the reserve out of what can be spent', () => {
    expect(spendable(10 * LUNA)).toBe(10 * LUNA - FEE_RESERVE_LUNA)
    expect(spendable(FEE_RESERVE_LUNA - 1)).toBe(0)
    expect(maxStake(200 * LUNA)).toBe(200 * LUNA - FEE_RESERVE_LUNA)
  })
  it('caps a run by the spendable balance and says so', () => {
    expect(runAmount(500, 10 * LUNA)).toEqual({ amount: 500, capped: false })
    expect(runAmount(10 * LUNA, 5 * LUNA)).toEqual({ amount: 5 * LUNA - FEE_RESERVE_LUNA, capped: true })
    expect(runAmount(100, 0)).toEqual({ amount: 0, capped: true })
  })
  it('validates stake amounts', () => {
    const bal = 1000 * LUNA
    expect(checkStake(0, bal, true)).toBe('zero')
    expect(checkStake(99 * LUNA, bal, true)).toBe('below-min')
    expect(checkStake(MIN_STAKE_LUNA, bal, true)).toBe('ok')
    expect(checkStake(bal, bal, true)).toBe('over-balance') // reserve
    expect(checkStake(maxStake(bal), bal, true)).toBe('ok')
    expect(checkStake(1 * LUNA, bal, false)).toBe('ok') // adding needs no minimum
    expect(checkStake(0, 50 * LUNA, true)).toBe('balance-below-min')
    expect(checkStake(60 * LUNA, 50 * LUNA, true)).toBe('balance-below-min')
  })
})

describe('readyLuna ledger', () => {
  const start = 1_000_000
  const kb = [
    { at: start - 10, luna: 999 }, // before the plan started
    { at: start + 1, luna: 300 },
    { at: start + 2, luna: 200 },
    { at: start + 3, luna: 500, restaked: true }, // paid into stake, never in the wallet
  ]
  it('counts only wallet kickbacks after the plan started', () => {
    expect(readyLuna(kb, start, [])).toBe(500)
  })
  it('is zero before a plan exists', () => {
    expect(readyLuna(kb, null, [])).toBe(0)
  })
  it('subtracts processed and in-flight amounts, never below zero', () => {
    expect(readyLuna(kb, start, [{ luna: 300, at: start + 5 }])).toBe(200)
    expect(readyLuna(kb, start, [{ luna: 300, at: start + 5 }], 150)).toBe(50)
    expect(readyLuna(kb, start, [{ luna: 900, at: start + 5 }])).toBe(0)
  })
  it('failed or cancelled steps stay ready because they never enter the ledger', () => {
    const ledgerAfterPartialRun = [{ luna: 250, at: start + 9 }] // send ok, restake failed (not recorded)
    expect(readyLuna(kb, start, ledgerAfterPartialRun)).toBe(250)
  })
})

describe('readyLuna dry run', () => {
  const start = 1_000_000
  it('a dry-run kickback added before the plan was saved counts once the plan exists', () => {
    const kb = [{ at: start - 60_000, luna: 2_500_000, dry: true }]
    expect(readyLuna(kb, null, [])).toBe(0)
    expect(readyLuna(kb, start, [])).toBe(2_500_000)
  })
  it('dry-run shares never eat real kickbacks, and a reset dry ledger frees new fake ones', () => {
    const ledger = [{ luna: 2_500_000, at: start + 5, dry: true }, { luna: 100, at: start + 6 }]
    const real = [{ at: start + 1, luna: 300 }]
    expect(readyLuna(real, start, ledgerFor(ledger, false))).toBe(200)
    // After "Reset dry run" the old fake kickback is gone; its share must go too.
    const fresh = [{ at: start + 10, luna: 2_500_000, dry: true }]
    expect(readyLuna(fresh, start, ledgerFor(ledger, true))).toBe(0) // the bug: old dry share still subtracted
    expect(readyLuna(fresh, start, ledgerFor(ledger.filter(e => !e.dry), true))).toBe(2_500_000)
  })
})
