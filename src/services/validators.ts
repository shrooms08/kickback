// Nimiq Validators API (mainnet). Responses carry base64 logos (the direct
// list is ~380 KB, the known list ~1.3 MB), so results are trimmed to the
// fields Kickback uses before they are cached.
import { cacheGet, cacheSet, ageMs } from '../lib/cache'

export const VALIDATORS_API = 'https://validators-api-main.je-cf9.workers.dev'

export interface ApiValidator {
  address: string
  name: string
  /** 0..1, e.g. 0.025 */
  fee: number
  payoutType: 'direct' | 'restake' | 'none' | string
  payoutSchedule: string
  isListed: boolean
  /** score.total, 0..1, or null when the API has no score */
  score: number | null
  /** 'current' | 'stale' | 'no_score' */
  scoreStatus: string
  balance: number
  stakers: number
  website: string | null
}

export interface ApiStatus { elected: string[], unelected: string[], deleted: string[], epoch: number }
export interface ApiSupply { total: number, staking: number }

interface Fetched<T> { value: T, at: number, stale: boolean }

async function getJson(path: string): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const res = await fetch(VALIDATORS_API + path, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`Validators API ${path}: HTTP ${res.status}`)
    return await res.json()
  }
  finally { clearTimeout(timer) }
}

/** Stale-while-revalidate around one endpoint, trimmed by `map`. */
async function cached<T>(key: string, ttl: number, path: string, map: (raw: unknown) => T): Promise<Fetched<T>> {
  const c = cacheGet<T>(key)
  if (c && ageMs(c) < ttl) return { value: c.v, at: c.t, stale: false }
  try {
    const value = map(await getJson(path))
    const e = cacheSet(key, value)
    return { value, at: e.t, stale: false }
  }
  catch (error) {
    if (c) return { value: c.v, at: c.t, stale: true }
    throw error
  }
}

function slim(x: Record<string, any>): ApiValidator {
  return {
    address: x.address,
    name: x.name,
    fee: Number(x.fee) || 0,
    payoutType: x.payoutType,
    payoutSchedule: x.payoutSchedule || '',
    isListed: !!x.isListed,
    score: typeof x.score?.total === 'number' ? x.score.total : null,
    scoreStatus: x.score?.dataStatus || 'no_score',
    balance: Number(x.balance) || 0,
    stakers: Number(x.stakers) || 0,
    website: x.website || null,
  }
}

/** Every direct-payout validator, listed or not. */
export function directValidators() {
  return cached('api:direct', 6 * 3600e3, '/api/v1/validators?payout-type=direct&only-known=false', raw => (raw as any[]).map(slim))
}

/** The known (listed) validators, all payout types. Only needed to name a non-direct pool. */
export function knownValidators() {
  return cached('api:known', 24 * 3600e3, '/api/v1/validators', raw => (raw as any[]).map(slim))
}

export function status() {
  return cached<ApiStatus>('api:status', 30 * 60e3, '/api/v1/status', (raw: any) => ({
    elected: (raw.validators?.electedValidators || []).map((v: any) => v.address),
    unelected: (raw.validators?.unelectedValidators || []).map((v: any) => v.address),
    deleted: raw.validators?.deletedValidators || [],
    epoch: raw.validators?.epochNumber ?? 0,
  }))
}

export function supply() {
  return cached<ApiSupply>('api:supply', 6 * 3600e3, '/api/v1/supply', (raw: any) => ({ total: Number(raw.total), staking: Number(raw.staking) }))
}

// ---------- estimated reward rate ----------
// From core-rs-albatross policy.rs: the remaining supply decays by SUPPLY_DECAY
// every millisecond, so next year's emission = remaining * (1 - DECAY^msPerYear).
// Spread over all stake, that is the gross staking reward rate.
const TOTAL_SUPPLY = 2_100_000_000_000_000
const SUPPLY_DECAY = 0.9999999999960264
const MS_PER_YEAR = 365.25 * 24 * 3600e3

export function grossStakingApy(s: ApiSupply): number | null {
  if (!s.total || !s.staking) return null
  const remaining = TOTAL_SUPPLY - s.total
  const emission = remaining * (1 - Math.pow(SUPPLY_DECAY, MS_PER_YEAR))
  return emission / s.staking
}
