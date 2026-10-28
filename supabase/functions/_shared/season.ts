/**
 * Season maths, computed on the server from verified data only (pure, so vitest covers it):
 * kickback streak, milestones, Stack skins and invite codes.
 */

const H = 3600e3
const DAY = 24 * H

/** ISO week of a time, weeks starting Monday 00:00 UTC: the Monday's date. */
export function weekKey(t: number): string {
  const d = new Date(t)
  const day = (d.getUTCDay() + 6) % 7
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10)
}

/** Payout txs within 10 minutes are one kickback (the pool pays in batches). Ascending times. */
export function batchKickbacks(times: number[], gapMs = 10 * 60e3): number[] {
  const out: number[] = []
  for (const t of [...times].sort((a, b) => a - b)) if (!out.length || t - out[out.length - 1] > gapMs) out.push(t)
  return out
}

export type StreakDot = 'ok' | 'saved' | 'missed' | 'pending'
export interface Streak { current: number, best: number, savers: number, pending: number, hist: StreakDot[] }

/**
 * A kickback counts when a verified plan run lands within 24h after it. Still inside its 24h
 * with no run: pending (doesn't break anything yet). Missed: the week's one streak saver keeps
 * the streak alive (the saver is gone until Monday); with no saver left the streak resets.
 */
export function streak(kickbackTimes: number[], runTimes: number[], now = Date.now()): Streak {
  const runs = [...runTimes].sort((a, b) => a - b)
  const used = new Set<string>()
  const hist: StreakDot[] = []
  let current = 0, best = 0, pending = 0
  for (const k of batchKickbacks(kickbackTimes)) {
    const shared = runs.some(r => r >= k && r <= k + DAY)
    if (shared) { current++; best = Math.max(best, current); hist.push('ok'); continue }
    if (now < k + DAY) { pending++; hist.push('pending'); continue }
    const w = weekKey(k)
    if (!used.has(w)) { used.add(w); hist.push('saved'); continue }
    current = 0
    hist.push('missed')
  }
  return { current, best, savers: used.has(weekKey(now)) ? 0 : 1, pending, hist: hist.slice(-14) }
}

/**
 * Which plan runs count: a run shares kickbacks, so it counts only when at least one kickback
 * landed after the last counted run (and before it). Many tiny runs after one kickback count once.
 */
export function countedRuns(kickbackTimes: number[], runs: Array<{ id: string, at: number }>): string[] {
  const kicks = batchKickbacks(kickbackTimes)
  const out: string[] = []
  let last = -Infinity
  for (const r of [...runs].sort((a, b) => a.at - b.at)) {
    if (kicks.some(k => k > last && k <= r.at)) { out.push(r.id); last = r.at }
  }
  return out
}

export const MILESTONES = ['first_stake', 'first_kickback', 'first_share', 'ten_runs', 'hundred_shared', 'streak_30', 'invited_staker'] as const
export type MilestoneKey = typeof MILESTONES[number]

/** Verified facts the server gathered for one wallet on one network. */
export interface Facts {
  /** Staked on chain now, or a verified stake tx. */
  staked: boolean
  /** Incoming payouts from a direct pool's reward address. */
  kickbacks: number
  /** Verified send shares. */
  sends: number
  /** Plan runs with at least one verified tx. */
  runs: number
  /** Verified send + restake, Luna. */
  sharedLuna: number
  bestStreak: number
  /** Invited wallets whose first stake is confirmed on chain. */
  invitedStakers: number
}

export const HUNDRED_NIM_LUNA = 10_000_000
/** 30 days of kickbacks at two a day. */
export const STREAK_30 = 60

export function milestonesFrom(f: Facts): MilestoneKey[] {
  const on: Record<MilestoneKey, boolean> = {
    first_stake: f.staked,
    first_kickback: f.kickbacks > 0,
    first_share: f.sends > 0,
    ten_runs: f.runs >= 10,
    hundred_shared: f.sharedLuna >= HUNDRED_NIM_LUNA,
    streak_30: f.bestStreak >= STREAK_30,
    invited_staker: f.invitedStakers > 0,
  }
  return MILESTONES.filter(k => on[k])
}

export const SKINS = ['spark', 'kick', 'bounce', 'rally', 'surge', 'legend'] as const
export type Skin = typeof SKINS[number]

/** No 0/O, 1/I: easy to read aloud and type. 32 characters, 5 bits each. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export function inviteCode(rand: Uint8Array): string {
  let s = ''
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[(rand[i] ?? 0) & 31]
  return `KICK-${s}`
}

export function isInviteCode(v: unknown): v is string {
  return typeof v === 'string' && /^KICK-[2-9A-HJ-NP-Z]{4}$/.test(v)
}
