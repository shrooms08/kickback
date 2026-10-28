/**
 * Season XP maths (pure, so vitest covers it). XP is only ever written by the server, as rows in
 * xp_ledger whose unique constraints make double counting impossible; this file decides amounts,
 * caps, tiers, quests and the season clock.
 */

export const XP = { run: 200, share: 100, invite: 500, quest: 300 } as const
/** Runs (and run shares) counted per UTC day. */
export const DAILY_RUN_CAP = 2

/** Daily stake XP: min(2000, round(50 * sqrt(active staked NIM))). */
export function dailyStakeXp(activeNim: number): number {
  if (!(activeNim > 0)) return 0
  return Math.min(2000, Math.round(50 * Math.sqrt(activeNim)))
}

export const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10)

/** Which of the day's two run slots the next qualifying run takes (null = cap reached). */
export function daySlot(alreadyCounted: number): 1 | 2 | null {
  return alreadyCounted === 0 ? 1 : alreadyCounted === 1 ? 2 : null
}

/** A run counts when at least one of its txs was found on chain and it shared at least the minimum. */
export function runQualifies(r: { verifiedTxs: number, totalLuna: number, minLuna: number }): boolean {
  return r.verifiedTxs > 0 && r.totalLuna >= r.minLuna
}

export const TIERS = [
  { name: 'Spark', at: 0, skin: 'spark' },
  { name: 'Kick', at: 1000, skin: 'kick' },
  { name: 'Bounce', at: 3000, skin: 'bounce' },
  { name: 'Rally', at: 8000, skin: 'rally' },
  { name: 'Surge', at: 20000, skin: 'surge' },
  { name: 'Legend', at: 50000, skin: 'legend' },
] as const
/** Legend's sub-levels sit at 50k, 75k and 100k: steps of 25k. */
const LEGEND_STEP = 25000
const ROMAN = ['I', 'II', 'III'] as const

export interface TierInfo { i: number, name: string, skin: string, sub: 0 | 1 | 2, roman: string, next: string | null, toNext: number, floor: number }

/** Tier and sub-level (equal thirds of the gap to the next tier). */
export function tierInfo(xp: number): TierInfo {
  const x = Math.max(0, Math.floor(xp || 0))
  let i = 0
  while (i < TIERS.length - 1 && x >= TIERS[i + 1].at) i++
  const t = TIERS[i], last = i === TIERS.length - 1
  const step = last ? LEGEND_STEP : (TIERS[i + 1].at - t.at) / 3
  const sub = Math.max(0, Math.min(2, Math.floor((x - t.at) / step))) as 0 | 1 | 2
  const toNext = last ? (sub < 2 ? t.at + (sub + 1) * step - x : 0) : TIERS[i + 1].at - x
  return { i, name: t.name, skin: t.skin, sub, roman: ROMAN[sub], next: last ? null : TIERS[i + 1].name, toNext, floor: t.at }
}

export const QUESTS = [
  { key: 'run3', title: 'Run your plan 3 times', n: 3 },
  { key: 'add', title: 'Add someone to your plan', n: 1 },
  { key: 'keep', title: 'Keep your stake all week', n: 7 },
] as const
export type QuestKey = typeof QUESTS[number]['key']

export function questProgress(f: { runsThisWeek: number, addedAndUsed: boolean, stakeDays: number }) {
  const val: Record<QuestKey, number> = { run3: f.runsThisWeek, add: f.addedAndUsed ? 1 : 0, keep: f.stakeDays }
  return QUESTS.map(q => { const p = Math.min(q.n, Math.max(0, val[q.key])); return { key: q.key, p, n: q.n, done: p >= q.n } })
}

export const SEASONS = [
  { id: 1, startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-30T23:59:59.999Z' },
  { id: 2, startsAt: '2026-12-07T00:00:00.000Z', endsAt: null as string | null },
] as const

/** The season a time belongs to: running, or ended and waiting for the next one. */
export function seasonOf(t = Date.now()): { id: number, startsAt: string, endsAt: string | null, ended: boolean, nextStartsAt: string | null } {
  for (let k = SEASONS.length - 1; k >= 0; k--) {
    const s = SEASONS[k]
    if (t >= Date.parse(s.startsAt)) {
      const ended = !!s.endsAt && t > Date.parse(s.endsAt)
      return { id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, ended, nextStartsAt: ended ? (SEASONS[k + 1]?.startsAt ?? null) : null }
    }
  }
  return { id: 1, startsAt: SEASONS[0].startsAt, endsAt: SEASONS[0].endsAt, ended: false, nextStartsAt: null }
}
