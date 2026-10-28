import { describe, expect, it } from 'vitest'
import { SKIN_FOR, batchKickbacks, inviteCode, isInviteCode, milestonesFrom, skinsFrom, streak, weekKey } from '../supabase/functions/_shared/season'
import { STAKING_CONTRACT, checkTx } from '../supabase/functions/_shared/verify'

const H = 3600e3
const D = 24 * H
// Monday 2026-10-26 00:00 UTC
const MON = Date.UTC(2026, 9, 26)

describe('weekKey: ISO weeks start Monday 00:00 UTC', () => {
  it('Sunday night and Monday morning are different weeks', () => {
    expect(weekKey(MON - 1)).not.toBe(weekKey(MON))
    expect(weekKey(MON)).toBe(weekKey(MON + 6 * D + 23 * H))
  })
})

describe('kickback batches', () => {
  it('payouts within 10 minutes are one kickback', () => {
    expect(batchKickbacks([MON, MON + 5 * 60e3, MON + 12 * H])).toEqual([MON, MON + 12 * H])
  })
})

describe('streak (shared within 24h of landing, 1 saver per week)', () => {
  it('counts kickbacks shared within 24h', () => {
    const k = [MON, MON + 12 * H, MON + D]
    const s = streak(k, [MON + 2 * H, MON + 13 * H, MON + D + 1 * H], MON + D + 2 * H)
    expect(s.current).toBe(3)
    expect(s.best).toBe(3)
  })
  it('one run covers every kickback that landed in the 24h before it', () => {
    const s = streak([MON, MON + 12 * H], [MON + 20 * H], MON + 30 * H)
    expect(s.current).toBe(2)
  })
  it('a kickback still inside its 24h is pending and does not break the streak', () => {
    const s = streak([MON, MON + 12 * H], [MON + 1 * H], MON + 14 * H)
    expect(s.current).toBe(1)
    expect(s.pending).toBe(1)
    expect(s.hist.at(-1)).toBe('pending')
  })
  it('the first miss in a week uses the saver: streak kept, saver gone', () => {
    const k = [MON, MON + 12 * H, MON + D]
    const s = streak(k, [MON + 1 * H, MON + 37 * H], MON + 38 * H)
    expect(s.hist).toEqual(['ok', 'saved', 'ok'])
    expect(s.current).toBe(2)
    expect(s.savers).toBe(0)
  })
  it('a second miss in the same week resets the streak', () => {
    const k = [MON, MON + 12 * H, MON + D, MON + 48 * H]
    const s = streak(k, [MON + 1 * H, MON + 49 * H], MON + 50 * H)
    expect(s.hist).toEqual(['ok', 'saved', 'missed', 'ok'])
    expect(s.current).toBe(1)
    expect(s.best).toBe(1)
  })
  it('the saver comes back on Monday', () => {
    const k = [MON + 5 * D, MON + 5 * D + 12 * H, MON + 7 * D + 1 * H]
    const s = streak(k, [MON + 5 * D + 1 * H], MON + 7 * D + 2 * H)
    expect(s.savers).toBe(1)
  })
  it('a run before a kickback does not count for it', () => {
    const s = streak([MON + 10 * H], [MON + 9 * H], MON + 40 * H)
    expect(s.current).toBe(0)
  })
  it('history shows at most the last 14 resolved kickbacks', () => {
    const k = Array.from({ length: 20 }, (_, i) => MON + i * 12 * H)
    const s = streak(k, k.map(t => t + H), MON + 20 * 12 * H)
    expect(s.hist).toHaveLength(14)
    expect(s.current).toBe(20)
  })
  it('no kickbacks: zero, one saver', () => {
    expect(streak([], [], MON)).toMatchObject({ current: 0, best: 0, savers: 1, hist: [] })
  })
})

describe('milestones from verified facts only', () => {
  const none = { staked: false, kickbacks: 0, sends: 0, runs: 0, sharedLuna: 0, bestStreak: 0, invitedStakers: 0 }
  it('nothing unlocks without facts', () => {
    expect(milestonesFrom(none)).toEqual([])
  })
  it('each fact unlocks its milestone', () => {
    expect(milestonesFrom({ ...none, staked: true })).toEqual(['first_stake'])
    expect(milestonesFrom({ ...none, kickbacks: 1 })).toEqual(['first_kickback'])
    expect(milestonesFrom({ ...none, sends: 1 })).toEqual(['first_share'])
    expect(milestonesFrom({ ...none, runs: 9 })).toEqual([])
    expect(milestonesFrom({ ...none, runs: 10 })).toEqual(['ten_runs'])
    expect(milestonesFrom({ ...none, sharedLuna: 9_999_999 })).toEqual([])
    expect(milestonesFrom({ ...none, sharedLuna: 10_000_000 })).toEqual(['hundred_shared'])
    expect(milestonesFrom({ ...none, bestStreak: 59 })).toEqual([])
    expect(milestonesFrom({ ...none, bestStreak: 60 })).toEqual(['streak_30'])
    expect(milestonesFrom({ ...none, invitedStakers: 1 })).toEqual(['invited_staker'])
  })
})

describe('skins from milestones', () => {
  it('spark is always unlocked', () => {
    expect(skinsFrom([])).toEqual(['spark'])
  })
  it('maps milestones to the prototype skins', () => {
    expect(SKIN_FOR).toMatchObject({ first_stake: 'kick', first_kickback: 'bounce', first_share: 'rally', ten_runs: 'surge', hundred_shared: 'legend', streak_30: 'legend' })
    expect(skinsFrom(['first_stake', 'ten_runs'])).toEqual(['spark', 'kick', 'surge'])
    expect(skinsFrom(['hundred_shared', 'streak_30'])).toEqual(['spark', 'legend'])
    expect(skinsFrom(['invited_staker'])).toEqual(['spark'])
  })
})

describe('invite codes', () => {
  it('KICK- plus 4 unambiguous characters', () => {
    const c = inviteCode(new Uint8Array([0, 1, 2, 255]))
    expect(c).toMatch(/^KICK-[2-9A-HJ-NP-Z]{4}$/)
    expect(isInviteCode(c)).toBe(true)
  })
  it('rejects anything else', () => {
    for (const bad of ['KICK-0000', 'kick-abcd', 'KICK-ABC', 'KICK-ABCDE', '', 'KICK-AB I']) expect(isInviteCode(bad)).toBe(false)
  })
})

describe('checkTx: a share or stake counts only for the matching on-chain tx', () => {
  const owner = 'NQ51 KVXF RMYV 9HPD CA8N 5X10 7SUY 2C29 MU2T'
  const to = 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8'
  const tx = { hash: 'ab'.repeat(32), from: owner.replace(/ /g, ''), to: to.replace(/ /g, ''), value: 250_000, timestamp: MON, executionResult: true }
  it('accepts the exact send', () => {
    expect(checkTx(tx, { owner, value: 250_000, to: [to] })).toBe(true)
  })
  it('rejects someone else\'s tx', () => {
    expect(checkTx({ ...tx, from: to }, { owner, value: 250_000, to: [to] })).toBe(false)
  })
  it('rejects a different amount or recipient', () => {
    expect(checkTx(tx, { owner, value: 250_001, to: [to] })).toBe(false)
    expect(checkTx(tx, { owner, value: 250_000, to: [owner] })).toBe(false)
  })
  it('rejects a failed tx and a missing one', () => {
    expect(checkTx({ ...tx, executionResult: false }, { owner, value: 250_000, to: [to] })).toBe(false)
    expect(checkTx(null, { owner, value: 250_000, to: [to] })).toBe(false)
  })
  it('stakes go to the staking contract; any amount when value is not given', () => {
    const st = { ...tx, to: STAKING_CONTRACT, value: 10_000_000 }
    expect(checkTx(st, { owner, to: [STAKING_CONTRACT] })).toBe(true)
    expect(checkTx(st, { owner, to: [to] })).toBe(false)
  })
})

import { ValidationError, validateEvent, validateShare } from '../supabase/functions/_shared/validate'

describe('share and event validation (season fields)', () => {
  const base = { id: '1b4e28ba-2fa1-41d2-883f-0016d3cca427', amount_luna: 1000, slice_type: 'send', tx_hash: 'ab'.repeat(32) }
  it('keeps a uuid run_id', () => {
    expect(validateShare({ ...base, run_id: '2b4e28ba-2fa1-41d2-883f-0016d3cca427' }).run_id).toBe('2b4e28ba-2fa1-41d2-883f-0016d3cca427')
    expect(validateShare(base).run_id).toBeNull()
  })
  it('rejects a bad run_id', () => {
    expect(() => validateShare({ ...base, run_id: 'run-1' })).toThrow(ValidationError)
  })
  it('stake events may carry a tx hash; other kinds may not', () => {
    expect(validateEvent({ kind: 'stake', amount_luna: 10_000_000, tx_hash: 'AB'.repeat(32) }).tx_hash).toBe('ab'.repeat(32))
    expect(validateEvent({ kind: 'connect' }).tx_hash).toBeNull()
    expect(() => validateEvent({ kind: 'connect', tx_hash: 'ab'.repeat(32) })).toThrow(ValidationError)
    expect(() => validateEvent({ kind: 'stake', tx_hash: 'xyz' })).toThrow(ValidationError)
  })
})
