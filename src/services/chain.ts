// Reading staking and payouts from the chain (read-only).
import { rpc, rpcPeek } from './rpc'
import type { Result } from './rpc'
import { prefGet, prefSet } from '../lib/cache'

export const COINBASE = 'NQ81 C01N BASE 0000 0000 0000 0000 0000 0000'
export const STAKING_CONTRACT = 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001'
const H = 3600e3

export const norm = (a: string) => a.replace(/\s+/g, '').toUpperCase()
export const sameAddr = (a?: string | null, b?: string | null) => !!a && !!b && norm(a) === norm(b)
/** "NQ07ABCD..." -> "NQ07 ABCD ..." */
export const spaced = (a: string) => norm(a).replace(/(.{4})/g, '$1 ').trim()

export interface Staker {
  address: string
  balance: number          // active stake, Luna
  delegation: string       // validator address
  inactiveBalance: number  // deactivated, on its way out
  inactiveFrom: number | null
  retiredBalance: number
}

export interface ValidatorInfo {
  address: string
  rewardAddress: string
  inactivityFlag: number | null
  retired: boolean
  jailedFrom: number | null
  numStakers?: number
}

export interface Tx {
  hash: string
  blockNumber: number
  timestamp: number
  from: string
  to: string
  value: number
  relatedAddresses?: string[]
  recipientData?: string
  executionResult?: boolean
}

// ---------- single reads ----------

export function getStaker(address: string, ttl = 60e3): Promise<Result<Staker | null>> {
  return rpc<Staker | null>('getStakerByAddress', [address], { ttl })
}

export function getAccountBalance(address: string, ttl = 60e3): Promise<Result<number>> {
  return rpc<{ balance: number }>('getAccountByAddress', [address], { ttl })
    .then(r => ({ ...r, value: Number(r.value?.balance) || 0 }))
}

/** Reward (payout) address and health of a validator. Cached for 24h. */
export function getValidator(validator: string): Promise<Result<ValidatorInfo>> {
  return rpc<ValidatorInfo>('getValidatorByAddress', [validator], { ttl: 24 * H })
}

/**
 * When inactive stake becomes withdrawable: the block after the reporting
 * window that follows `inactiveFrom`, converted to a time with the current head
 * (blocks are 1s apart). Two cheap calls, only for stakers with inactive stake.
 */
export async function unstakeReadyAt(inactiveFrom: number): Promise<{ readyAt: number, startedAt: number }> {
  const [release, head] = await Promise.all([
    rpc<number>('getBlockAfterReportingWindow', [inactiveFrom], { ttl: 7 * 24 * H }),
    rpc<number>('getBlockNumber', [], { ttl: 60e3 }),
  ])
  const t = Date.now()
  return { readyAt: t + (release.value - head.value) * 1000, startedAt: t + (inactiveFrom - head.value) * 1000 }
}

// ---------- epochs ----------
// Albatross: an epoch is 43,200 blocks of 1 s (12 h). Stake changes count from
// the next election block (the first block of the next epoch).
export const GENESIS_BLOCK = 3_456_000
export const BLOCKS_PER_EPOCH = 43_200

export function nextElectionBlock(head: number): number {
  return GENESIS_BLOCK + (Math.floor((head - GENESIS_BLOCK) / BLOCKS_PER_EPOCH) + 1) * BLOCKS_PER_EPOCH
}

export async function headBlock(): Promise<{ block: number, at: number }> {
  const r = await rpc<number>('getBlockNumber', [], { ttl: 60e3 })
  return { block: r.value, at: r.at }
}

/** When the next epoch starts (ms), from a head block reading. */
export function nextElectionAt(head: { block: number, at: number }): number {
  return head.at + (nextElectionBlock(head.block) - head.block) * 1000
}

/**
 * When a new stake's first kickback should land: the stake counts from the
 * next election, earns for one epoch, then the pool pays at its next payout
 * after that epoch. Falls back to "epoch end + 1 h" without pool timing.
 */
export function firstKickbackAt(head: { block: number, at: number }, stats: PoolStats | null): number {
  const earnedBy = nextElectionAt(head) + BLOCKS_PER_EPOCH * 1000
  if (!stats?.lastPaidAt || !stats.intervalH) return earnedBy + 3600e3
  const step = stats.intervalH * 3600e3
  let t = stats.lastPaidAt
  while (t < earnedBy) t += step
  return t
}

/** When stake deactivated now would be released: next election + one epoch. */
export function releaseIfStoppedNow(head: { block: number, at: number }): number {
  return nextElectionAt(head) + BLOCKS_PER_EPOCH * 1000 + 1000
}

// ---------- history ----------

export interface History { txs: Tx[], complete: boolean, at: number, stale: boolean }

/**
 * Newest-first history of an address, paging back (100 per page) until `days`
 * are covered, history ends, or `maxPages` is reached. The newest page is
 * cached for `ttl`; older pages never change, so they are cached for a week.
 */
export async function addressHistory(address: string, opts: { days?: number, maxPages?: number, ttl?: number } = {}): Promise<History> {
  const days = opts.days ?? 30, maxPages = opts.maxPages ?? 6, since = Date.now() - days * 24 * H
  const txs: Tx[] = []
  let startAt: string | null = null, complete = false, at = Date.now(), stale = false
  for (let page = 0; page < maxPages; page++) {
    const r: Result<Tx[]> = await rpc<Tx[]>('getTransactionsByAddress', [address, 100, startAt], { ttl: page === 0 ? (opts.ttl ?? 60e3) : 7 * 24 * H })
    if (page === 0) { at = r.at; stale = r.stale }
    const list = r.value || []
    txs.push(...list)
    if (list.length < 100) { complete = true; break }
    if (list[list.length - 1].timestamp < since) { complete = true; break }
    startAt = list[list.length - 1].hash
  }
  return { txs, complete, at, stale }
}

/** First page from cache only, for instant paint. */
export function peekHistory(address: string): Tx[] | null {
  return rpcPeek<Tx[]>('getTransactionsByAddress', [address, 100, null])?.value ?? null
}

// ---------- kickbacks ----------

export interface Kickback {
  hash: string
  at: number
  luna: number
  from: string
  /** Paid into stake (AddStake to the staking contract) instead of the wallet. */
  restaked: boolean
}

/** Incoming payouts to `address` from any of `rewardAddresses`. */
export function findKickbacks(address: string, txs: Tx[], rewardAddresses: string[], days = 30): Kickback[] {
  const rewards = new Set(rewardAddresses.map(norm))
  const me = norm(address), since = Date.now() - days * 24 * H
  const seen = new Set<string>()
  const out: Kickback[] = []
  for (const t of txs) {
    if (seen.has(t.hash) || t.timestamp < since || t.executionResult === false || !(t.value > 0)) continue
    if (!rewards.has(norm(t.from))) continue
    const toMe = norm(t.to) === me
    const related = (t.relatedAddresses || []).some(a => norm(a) === me)
    if (!toMe && !related) continue
    seen.add(t.hash)
    out.push({ hash: t.hash, at: t.timestamp, luna: t.value, from: t.from, restaked: !toMe })
  }
  return out.sort((a, b) => b.at - a.at)
}

// ---------- payout batches ----------

/** Group payout times (any order) into batches: within 10 minutes = one batch. Returns batch start times, newest first. */
export function batchTimes(times: number[], gapMs = 10 * 60e3): number[] {
  const s = [...times].sort((a, b) => b - a)
  const out: number[] = []
  for (const t of s) {
    if (out.length && out[out.length - 1] - t < gapMs) out[out.length - 1] = t
    else out.push(t)
  }
  return out
}

export function medianGapHours(batches: number[]): number | null {
  if (batches.length < 2) return null
  const gaps = batches.slice(0, -1).map((b, i) => (b - batches[i + 1]) / H).sort((a, b) => a - b)
  const m = Math.floor(gaps.length / 2)
  return gaps.length % 2 ? gaps[m] : (gaps[m - 1] + gaps[m]) / 2
}

/** "About every 12h", or "00:00 and 12:00 UTC" when every batch lands within 3 minutes of the same whole hours. */
export function scheduleLabel(batches: number[], intervalH: number | null): string {
  const every = intervalH ? `About every ${Math.round(intervalH)}h` : 'About every 12h'
  if (batches.length < 4) return every
  const hours = new Set<number>()
  for (const b of batches) {
    const d = new Date(b)
    const mins = d.getUTCMinutes() + d.getUTCSeconds() / 60
    if (mins > 3 && mins < 57) return every
    hours.add((d.getUTCHours() + (mins >= 57 ? 1 : 0)) % 24)
  }
  if (hours.size > 3) return every
  const list = [...hours].sort((a, b) => a - b).map(h => String(h).padStart(2, '0') + ':00')
  return list.length === 1 ? `${list[0]} UTC` : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]} UTC`
}

// ---------- pool payout stats ----------
// A pool's reward address also receives a block reward every minute or so
// (60-80 coinbase inherents an hour), so its own history is flooded: 100
// transactions cover about 1.5h and 500 cover 6-8h. Instead Kickback reads a
// *probe*: a known staker of that pool, whose short history (25 txs, 1 unit)
// shows weeks of payouts. If no probe works, it scans the reward address in
// pages of 500 (5 units each) and learns new probes from the payout batch.

export interface PoolStats {
  alive: boolean
  lastPaidAt: number | null
  batches: number[]
  intervalH: number | null
  source: 'probe' | 'scan' | 'none'
  checkedAt: number
}

/** Seed probes: stakers seen receiving direct payouts (see docs/data-notes.md). Learned probes are added at runtime. */
const SEED_PROBES: Record<string, string[]> = {
  // Nimiq.Fun reward address
  'NQ16373TEQ2VJX5BME74G0563TA975L3P717': ['NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8', 'NQ33 VCNC TLSY 10X3 BKJ7 NSY1 B6F6 R0J9 1SUK'],
  // ObsidianStake reward address
  'NQ155JNSU7CERAH53T02F8A9JCT6QMG97TSV': ['NQ11 NMR7 4E14 CD4Q 3YEQ DJ67 5L6G YAM7 RNF4', 'NQ47 P7A4 FB6L FCG1 LGU9 B8UE AXV8 ADH8 5XVR'],
}

function learnedProbes(reward: string): string[] {
  try { return JSON.parse(prefGet('probes:' + norm(reward)) || '[]') }
  catch { return [] }
}
export function learnProbe(reward: string, address: string) {
  const list = learnedProbes(reward).filter(a => !sameAddr(a, address))
  prefSet('probes:' + norm(reward), JSON.stringify([address, ...list].slice(0, 4)))
}

const ALIVE_MS = 72 * H

async function fromProbe(reward: string, probe: string): Promise<PoolStats | null> {
  const r = await rpc<Tx[]>('getTransactionsByAddress', [probe, 25, null], { ttl: 15 * 60e3 })
  const times = (r.value || []).filter(t => sameAddr(t.from, reward) && t.value > 0).map(t => t.timestamp)
  if (!times.length || Date.now() - Math.max(...times) > ALIVE_MS) return null
  const batches = batchTimes(times)
  return { alive: true, lastPaidAt: batches[0], batches, intervalH: medianGapHours(batches), source: 'probe', checkedAt: r.at }
}

async function fromScan(reward: string): Promise<PoolStats> {
  const since = Date.now() - ALIVE_MS
  const out: Tx[] = []
  let startAt: string | null = null, at = Date.now()
  for (let page = 0; page < 10; page++) {
    const r: Result<Tx[]> = await rpc<Tx[]>('getTransactionsByAddress', [reward, 500, startAt], { ttl: page ? 7 * 24 * H : 15 * 60e3 })
    if (!page) at = r.at
    const list = r.value || []
    out.push(...list.filter(t => sameAddr(t.from, reward) && !sameAddr(t.to, reward) && t.value > 0))
    // Two batches are enough for an interval; stop early to save units.
    if (batchTimes(out.map(t => t.timestamp)).length >= 2) break
    if (list.length < 500 || list[list.length - 1].timestamp < since) break
    startAt = list[list.length - 1].hash
  }
  const recent = out.filter(t => t.timestamp >= since)
  if (!recent.length) return { alive: false, lastPaidAt: out.length ? Math.max(...out.map(t => t.timestamp)) : null, batches: [], intervalH: null, source: 'scan', checkedAt: at }
  // Learn the biggest direct recipient as a probe for next time.
  const top = recent.filter(t => !sameAddr(t.to, STAKING_CONTRACT)).sort((a, b) => b.value - a.value)[0]
  if (top) learnProbe(reward, top.to)
  const batches = batchTimes(recent.map(t => t.timestamp))
  return { alive: true, lastPaidAt: batches[0], batches, intervalH: medianGapHours(batches), source: 'scan', checkedAt: at }
}

/** Payout health of a pool, from probes first, then a scan. */
export async function poolStats(reward: string): Promise<PoolStats> {
  const probes = [...learnedProbes(reward), ...(SEED_PROBES[norm(reward)] || [])]
  for (const p of probes.slice(0, 3)) {
    try {
      const s = await fromProbe(reward, p)
      if (s) return s
    }
    catch { /* try the next probe */ }
  }
  return fromScan(reward)
}

/** Stats from the user's own kickbacks, when they have enough of them. */
export function statsFromKickbacks(kickbacks: Kickback[]): PoolStats | null {
  if (!kickbacks.length) return null
  const batches = batchTimes(kickbacks.map(k => k.at))
  return { alive: Date.now() - batches[0] <= ALIVE_MS, lastPaidAt: batches[0], batches, intervalH: medianGapHours(batches), source: 'probe', checkedAt: Date.now() }
}
