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
