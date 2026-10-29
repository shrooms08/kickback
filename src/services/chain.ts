// Reading staking and payouts from the chain (read-only).
import { rpc, rpcPeek } from './rpc'
import type { Result } from './rpc'
import { prefGet, prefSet } from '../lib/cache'
import { knownReward } from './knownPools'
import { isTestnet, net } from '../lib/net'

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
  fee?: number
  /** Block the transaction was made at; it can be included until this plus the validity window. */
  validityStartHeight?: number
  relatedAddresses?: string[]
  recipientData?: string
  executionResult?: boolean
}

// ---------- single reads ----------

export interface ActiveValidator {
  address: string
  rewardAddress: string
  balance: number
  numStakers: number
  inactivityFlag: number | null
  retired: boolean
  jailedFrom: number | null
}

/** Every validator elected this epoch (testnet pool list). */
export function getActiveValidators(ttl = 10 * 60e3): Promise<Result<ActiveValidator[]>> {
  return rpc<ActiveValidator[]>('getActiveValidators', [], { ttl })
}

export function getStaker(address: string, ttl = 60e3): Promise<Result<Staker | null>> {
  return rpc<Staker | null>('getStakerByAddress', [address], { ttl })
}

export function getAccountBalance(address: string, ttl = 60e3): Promise<Result<number>> {
  return rpc<{ balance: number }>('getAccountByAddress', [address], { ttl })
    .then(r => ({ ...r, value: Number(r.value?.balance) || 0 }))
}

/** Account type from RPC: 'basic', 'vesting', 'htlc', 'staking' (null when it can't be read). */
export function getAccountType(address: string): Promise<string | null> {
  return rpc<{ type?: string }>('getAccountByAddress', [address], { ttl: 24 * H })
    .then(r => (typeof r.value?.type === 'string' ? r.value.type : 'unknown'), () => null)
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
// Albatross: an epoch is 43,200 blocks. Stake changes count from the next
// election block (the first block of the next epoch). Blocks are *nominally*
// 1 s apart but run a little faster on mainnet (about 0.996 s), so an epoch is
// about 11.94 h, not 12 h. Timing is measured from real election blocks: a few
// minutes of drift matters, because pools pay a couple of minutes after each
// election block (see docs/staking-lifecycle.md).
/** Mainnet 3,456,000; testnet 3,032,010 (getPolicyConstants genesisBlockNumber). */
export const GENESIS_BLOCK = net.genesisBlock
export const BLOCKS_PER_EPOCH = 43_200

export function nextElectionBlock(head: number): number {
  return GENESIS_BLOCK + (Math.floor((head - GENESIS_BLOCK) / BLOCKS_PER_EPOCH) + 1) * BLOCKS_PER_EPOCH
}

/** Real epoch timing: the latest election block's time and the measured epoch length. */
export interface EpochClock { block: number, at: number, epochMs: number }

/**
 * Head block number, then the timestamps of the last two election blocks
 * (immutable, cached for a month). Three 1-unit calls, two of them cached.
 */
export async function epochClock(): Promise<EpochClock> {
  const head = await rpc<number>('getBlockNumber', [], { ttl: 60e3 })
  const last = nextElectionBlock(head.value) - BLOCKS_PER_EPOCH
  const [a, b] = await Promise.all([
    rpc<{ timestamp: number }>('getBlockByNumber', [last, false], { ttl: 30 * 24 * H }),
    rpc<{ timestamp: number }>('getBlockByNumber', [last - BLOCKS_PER_EPOCH, false], { ttl: 30 * 24 * H }),
  ])
  const measured = a.value.timestamp - b.value.timestamp
  // Guard against a bad read: an epoch is 43,200 blocks of roughly 1 s.
  const epochMs = measured > 10 * H && measured < 14 * H ? measured : BLOCKS_PER_EPOCH * 1000
  return { block: last, at: a.value.timestamp, epochMs }
}

/**
 * Stand-in while the chain reading loads (or if it fails): a pool that pays
 * every epoch marks the elections itself, a minute or two after each one.
 */
export function payoutClock(stats: PoolStats | null): EpochClock | null {
  if (!stats?.lastPaidAt) return null
  const every = stats.intervalH && stats.intervalH > 10 && stats.intervalH < 14 ? stats.intervalH * H : BLOCKS_PER_EPOCH * 1000
  return { block: 0, at: stats.lastPaidAt, epochMs: every }
}

/** The first election at or after `t` (ms). Works for times before the clock's election too. */
export function electionAfter(c: EpochClock, t: number): number {
  return c.at + Math.ceil((t - c.at) / c.epochMs) * c.epochMs
}

/**
 * When a stake made at `stakeAt` gets its first kickback:
 *   1. it counts from the first election after `stakeAt` (E1),
 *   2. it earns for that whole epoch, which closes at the next election (E2 = E1 + epoch),
 *   3. the pool pays that epoch at its first payout after E2.
 * Pools pay a fixed time after an election block (Nimiq.Fun: about 2 min), so
 * the payout is found in epoch steps: the election before the pool's last
 * payout, plus whole multiples of its payout interval (in epochs), plus the
 * same offset. Without pool timing: E2 + 1 h.
 */
export function firstKickbackAt(c: EpochClock, stakeAt: number, stats: PoolStats | null): number {
  const idx = (t: number) => (t - c.at) / c.epochMs
  const earnedIdx = Math.ceil(idx(stakeAt)) + 1
  if (!stats?.lastPaidAt) return c.at + earnedIdx * c.epochMs + H
  const paidIdx = Math.floor(idx(stats.lastPaidAt))
  const offset = Math.min(stats.lastPaidAt - (c.at + paidIdx * c.epochMs), c.epochMs)
  const every = Math.max(1, Math.round((stats.intervalH ?? 12) * H / c.epochMs))
  const payIdx = paidIdx + Math.ceil((earnedIdx - paidIdx) / every) * every
  return c.at + payIdx * c.epochMs + offset
}

/** When stake deactivated now would be released: next election + one epoch. */
export function releaseIfStoppedNow(c: EpochClock): number {
  return electionAfter(c, Date.now()) + c.epochMs + 1000
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
  /** A dry-run fake. */
  dry?: boolean
  /** A testnet test kickback (marked in Diagnostics, backed by real testnet NIM in the wallet). */
  manual?: boolean
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

/**
 * A validator's reward address: from getValidatorByAddress, or, when that can't be read (no
 * JSON-RPC node up; the REST fallback has no validator route), from the fixed table of known
 * direct pools. Never guessed from where some staker delegates.
 */
export async function rewardOf(validator: string): Promise<string | null> {
  try { return (await getValidator(validator)).value.rewardAddress || null }
  catch { return knownReward(validator) }
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

/**
 * Payout health of a pool, from probes first, then a scan. On testnet there
 * is no payout check: reward addresses are the validators themselves (flooded
 * with block rewards, so a scan costs up to 50 units each) and no listed pool
 * pays to wallets, so every pool counts as alive with no schedule.
 */
export async function poolStats(reward: string): Promise<PoolStats> {
  if (isTestnet) return { alive: true, lastPaidAt: null, batches: [], intervalH: null, source: 'none', checkedAt: Date.now() }
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
