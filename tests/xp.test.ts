import { describe, expect, it } from 'vitest'
import { DAILY_RUN_CAP, QUESTS, TIERS, XP, dailyStakeXp, daySlot, questProgress, runQualifies, seasonOf, tierInfo, utcDay } from '../supabase/functions/_shared/xp'

describe('daily stake XP = min(2000, round(50 * sqrt(active NIM)))', () => {
  it('pins the formula', () => {
    expect(dailyStakeXp(100)).toBe(500)
    expect(dailyStakeXp(1000)).toBe(1581)
    expect(dailyStakeXp(1)).toBe(50)
    expect(dailyStakeXp(2.5)).toBe(79)
  })
  it('caps at 2000 (1,600 NIM and up)', () => {
    expect(dailyStakeXp(1600)).toBe(2000)
    expect(dailyStakeXp(25000)).toBe(2000)
  })
  it('no stake, no XP', () => {
    expect(dailyStakeXp(0)).toBe(0)
    expect(dailyStakeXp(-5)).toBe(0)
    expect(dailyStakeXp(Number.NaN)).toBe(0)
  })
})

describe('XP amounts', () => {
  it('match the brief', () => {
    expect(XP).toEqual({ run: 200, share: 100, invite: 500, quest: 300 })
    expect(DAILY_RUN_CAP).toBe(2)
  })
})

describe('runs: at most 2 counted per UTC day', () => {
  it('slots 1 and 2, then nothing', () => {
    expect(daySlot(0)).toBe(1)
    expect(daySlot(1)).toBe(2)
    expect(daySlot(2)).toBeNull()
  })
  it('a run counts with a verified tx and at least the minimum', () => {
    expect(runQualifies({ verifiedTxs: 1, totalLuna: 10_000, minLuna: 10_000 })).toBe(true)
    expect(runQualifies({ verifiedTxs: 0, totalLuna: 50_000, minLuna: 10_000 })).toBe(false)
    expect(runQualifies({ verifiedTxs: 2, totalLuna: 5_000, minLuna: 10_000 })).toBe(false)
  })
  it('UTC days', () => {
    expect(utcDay(Date.UTC(2026, 9, 28, 23, 59))).toBe('2026-10-28')
    expect(utcDay(Date.UTC(2026, 9, 29, 0, 0))).toBe('2026-10-29')
  })
})

describe('tiers: Spark 0, Kick 1k, Bounce 3k, Rally 8k, Surge 20k, Legend 50k; 3 sub-levels', () => {
  it('thresholds', () => {
    expect(TIERS.map(t => [t.name, t.at])).toEqual([['Spark', 0], ['Kick', 1000], ['Bounce', 3000], ['Rally', 8000], ['Surge', 20000], ['Legend', 50000]])
  })
  it('sub-levels are equal thirds of the gap to the next tier', () => {
    expect(tierInfo(0)).toMatchObject({ name: 'Spark', sub: 0, roman: 'I', next: 'Kick', toNext: 1000 })
    expect(tierInfo(333)).toMatchObject({ name: 'Spark', sub: 0 })
    expect(tierInfo(334)).toMatchObject({ name: 'Spark', sub: 1, roman: 'II' })
    expect(tierInfo(667)).toMatchObject({ name: 'Spark', sub: 2, roman: 'III' })
    expect(tierInfo(1000)).toMatchObject({ name: 'Kick', sub: 0, toNext: 2000 })
    expect(tierInfo(8000 + 4000)).toMatchObject({ name: 'Rally', sub: 1 })
    expect(tierInfo(19999)).toMatchObject({ name: 'Rally', sub: 2, toNext: 1 })
  })
  it('Legend sub-levels at 50k, 75k, 100k', () => {
    expect(tierInfo(50000)).toMatchObject({ name: 'Legend', sub: 0, next: null })
    expect(tierInfo(74999)).toMatchObject({ name: 'Legend', sub: 0 })
    expect(tierInfo(75000)).toMatchObject({ name: 'Legend', sub: 1 })
    expect(tierInfo(100000)).toMatchObject({ name: 'Legend', sub: 2, toNext: 0 })
    expect(tierInfo(250000)).toMatchObject({ name: 'Legend', sub: 2 })
  })
  it('each tier has its skin', () => {
    expect(TIERS.map(t => t.skin)).toEqual(['spark', 'kick', 'bounce', 'rally', 'surge', 'legend'])
  })
})

describe('weekly quests (reset Monday 00:00 UTC)', () => {
  it('three fixed quests, +300 each', () => {
    expect(QUESTS.map(q => [q.key, q.title, q.n])).toEqual([['run3', 'Run your plan 3 times', 3], ['add', 'Add someone to your plan', 1], ['keep', 'Keep your stake all week', 7]])
  })
  it('progress and completion', () => {
    const p = questProgress({ runsThisWeek: 4, addedAndUsed: false, stakeDays: 6 })
    expect(p).toEqual([{ key: 'run3', p: 3, n: 3, done: true }, { key: 'add', p: 0, n: 1, done: false }, { key: 'keep', p: 6, n: 7, done: false }])
    expect(questProgress({ runsThisWeek: 0, addedAndUsed: true, stakeDays: 7 }).map(q => q.done)).toEqual([false, true, true])
  })
})

describe('season clock', () => {
  it('Season 1 runs until 2026-11-30 23:59 UTC', () => {
    expect(seasonOf(Date.UTC(2026, 10, 30, 23, 58))).toMatchObject({ id: 1, ended: false })
    expect(seasonOf(Date.UTC(2026, 11, 1, 0, 0))).toMatchObject({ id: 1, ended: true })
  })
  it('says when Season 2 starts', () => {
    const s = seasonOf(Date.UTC(2026, 11, 3))
    expect(s.nextStartsAt).toBe('2026-12-07T00:00:00.000Z')
    expect(seasonOf(Date.UTC(2026, 11, 7, 1)).id).toBe(2)
  })
})

import { INVITE_KEEP_DAYS, inviteStakeKept } from '../supabase/functions/_shared/xp'
describe('invite XP: the invitee keeps a real stake for 7 days after the claim (audit 11)', () => {
  const D = 864e5, MIN = 1_000_000
  const claimed = Date.parse('2026-10-10T15:00:00Z')
  // Snapshots for the 7 days after the claim day (Oct 11..17), 10 NIM each.
  const week = (luna = MIN) => Array.from({ length: 7 }, (_, i) => ({ day: utcDay(claimed + (i + 1) * D), active_luna: luna }))
  const at = (t: number, snaps: Array<{ day: string, active_luna: number }>) => inviteStakeKept(claimed, t, snaps, MIN)
  it('is a week', () => expect(INVITE_KEEP_DAYS).toBe(7))
  it('waits until 7 days have passed, however much was staked before', () => {
    expect(at(claimed + 3 * D, week().slice(0, 3))).toBe('wait')
    expect(at(claimed + 7 * D - 1, week())).toBe('wait')
  })
  it('counts once the 7 days after the claim all held 10+ NIM and the stake is still there today', () => {
    expect(at(claimed + 7 * D, week())).toBe('yes')
    expect(at(claimed + 9 * D, [...week(), { day: utcDay(claimed + 9 * D), active_luna: MIN }])).toBe('yes')
  })
  it('needs today\'s stake: none (yet) or below 10 NIM today waits', () => {
    expect(at(claimed + 9 * D, week())).toBe('wait')
    expect(at(claimed + 9 * D, [...week(), { day: utcDay(claimed + 9 * D), active_luna: MIN - 1 }])).toBe('wait')
  })
  it('never counts when a day of the week dropped below 10 NIM', () => {
    const w = week(); w[3] = { ...w[3], active_luna: 5 }
    expect(at(claimed + 8 * D, [...w, { day: utcDay(claimed + 8 * D), active_luna: MIN }])).toBe('never')
  })
  it('stake before or on the claim day does not count towards the week', () => {
    const before = Array.from({ length: 7 }, (_, i) => ({ day: utcDay(claimed - i * D), active_luna: MIN }))
    expect(at(claimed + 8 * D, [...before, { day: utcDay(claimed + 8 * D), active_luna: MIN }])).toBe('never')
  })
  it('tolerates one day without a snapshot (cron outage), not two', () => {
    const one = week().filter((_, i) => i !== 2), two = week().filter((_, i) => i !== 2 && i !== 4)
    const today = { day: utcDay(claimed + 8 * D), active_luna: MIN }
    expect(at(claimed + 8 * D, [...one, today])).toBe('yes')
    expect(at(claimed + 8 * D, [...two, today])).toBe('never')
  })
})

describe('invite week starts on the first day with a stake after the claim (review info)', () => {
  const D = 864e5, MIN = 1_000_000
  const claimed = Date.parse('2026-10-10T23:00:00Z')
  const day = (i: number, luna = MIN) => ({ day: utcDay(claimed + i * D), active_luna: luna })
  it('the day after the claim was snapshotted (00:10) before the invitee staked: the week starts the next day', () => {
    const snaps = [day(1, 0), ...[2, 3, 4, 5, 6, 7, 8].map(i => day(i)), day(9)]
    expect(inviteStakeKept(claimed, claimed + 9 * D, snaps, MIN)).toBe('yes')
    expect(inviteStakeKept(claimed, claimed + 7 * D, snaps.slice(0, 7), MIN)).toBe('wait')
  })
  it('a dip after the week started still means never', () => {
    const snaps = [day(1, 0), ...[2, 3, 4].map(i => day(i)), day(5, 10), ...[6, 7, 8, 9].map(i => day(i))]
    expect(inviteStakeKept(claimed, claimed + 9 * D, snaps, MIN)).toBe('never')
  })
  it('the stake must start within the 7 days after the claim', () => {
    const late = [...[1, 2, 3, 4, 5, 6, 7].map(i => day(i, 0)), ...[8, 9, 10, 11, 12, 13, 14, 15].map(i => day(i))]
    expect(inviteStakeKept(claimed, claimed + 15 * D, late, MIN)).toBe('never')
    expect(inviteStakeKept(claimed, claimed + 5 * D, late.slice(0, 5), MIN)).toBe('wait')
  })
})
