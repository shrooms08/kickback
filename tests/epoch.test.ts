import { describe, expect, it } from 'vitest'
import { electionAfter, firstKickbackAt, medianGapHours, payoutClock } from '../src/services/chain'
import type { PoolStats } from '../src/services/chain'

// Real mainnet readings (2026-10-21): election block 64,800,000 and the one
// before it, and Nimiq.Fun payouts seen by a probe staker. Epochs are 11.94 h
// (blocks run at about 0.996 s), and Nimiq.Fun pays about 2 min after each election.
const H = 3600e3
const clock = { block: 64_800_000, at: 1792592467862, epochMs: 1792592467862 - 1792549474893 }
const pays = [1792592582864, 1792549560894, 1792506550024, 1792463507841, 1792420450034, 1792377460183]
const fun: PoolStats = { alive: true, lastPaidAt: pays[0], batches: pays, intervalH: medianGapHours(pays), source: 'probe', checkedAt: 0 }

describe('epoch clock', () => {
  it('finds the next election from measured epochs', () => {
    expect(electionAfter(clock, clock.at)).toBe(clock.at)
    expect(electionAfter(clock, clock.at + 1)).toBe(clock.at + clock.epochMs)
    expect(electionAfter(clock, clock.at - 1)).toBe(clock.at)
  })
})

describe('firstKickbackAt', () => {
  it('worked example: stake at 16:44 UTC with Nimiq.Fun lands about 21.5 h later, not 33.5 h', () => {
    const stake = 1792601062211 // 2026-10-21T16:44:22Z
    const at = firstKickbackAt(clock, stake, fun)
    expect(new Date(at).toISOString()).toBe('2026-10-22T14:16:08.802Z')
    expect((at - stake) / H).toBeCloseTo(21.53, 1)
  })
  it('always lands 12 to 26 h after staking with a pool that pays every epoch', () => {
    for (let i = 0; i < 48; i++) {
      const stake = clock.at + i * clock.epochMs / 48 + 1000
      const h = (firstKickbackAt(clock, stake, fun) - stake) / H
      expect(h).toBeGreaterThanOrEqual(11.9)
      expect(h).toBeLessThanOrEqual(26)
    }
  })
  it('works for a stake made in an earlier epoch (dry run confirm time or history)', () => {
    const stake = clock.at - 3 * H // the epoch before the clock's election
    expect(firstKickbackAt(clock, stake, fun)).toBe(clock.at + clock.epochMs + (pays[0] - clock.at))
  })
  it('pools that pay every other epoch land on their own elections', () => {
    const every2: PoolStats = { ...fun, intervalH: 23.9 }
    const at = firstKickbackAt(clock, clock.at + 1000, every2)
    // Earned by election +2; the pool pays on even elections from its last payout: +2.
    expect(at).toBe(clock.at + 2 * clock.epochMs + (pays[0] - clock.at))
  })
  it('before the chain reading arrives, the pool\'s own payouts stand in for the elections', () => {
    const stake = 1792601062211
    const h = (firstKickbackAt(payoutClock(fun)!, stake, fun) - stake) / H
    expect(h).toBeGreaterThan(21)
    expect(h).toBeLessThan(22)
  })
  it('without pool timing: end of the earning epoch + 1 h', () => {
    expect(firstKickbackAt(clock, clock.at + 1000, null)).toBe(clock.at + 2 * clock.epochMs + H)
  })
})
