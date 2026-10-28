import { describe, expect, it } from 'vitest'
import { DEFAULT_MIN_READY, MIN_READY_CHOICES, collecting, minLabel } from '../src/lib/minReady'

describe('Run when ready reaches', () => {
  it('offers 0.10 / 1 / 5 NIM, default 0.10', () => {
    expect(MIN_READY_CHOICES).toEqual([10_000, 100_000, 500_000])
    expect(DEFAULT_MIN_READY).toBe(10_000)
    expect(MIN_READY_CHOICES.map(minLabel)).toEqual(['0.10', '1', '5'])
  })
  it('collecting while something is ready but less than the minimum', () => {
    expect(collecting(6_000, 10_000)).toEqual({ on: true, pct: 60, have: '0.06', need: '0.10' })
    expect(collecting(0, 10_000).on).toBe(false)
    expect(collecting(10_000, 10_000).on).toBe(false)
    expect(collecting(50_000, 100_000)).toMatchObject({ on: true, pct: 50, have: '0.50', need: '1' })
  })
})
