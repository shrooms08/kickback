import { nimiqCalculatorRate } from '../lib/rate'
// Nimiq Validators API (mainnet, or the testnet deployment on testnet). Responses carry base64 logos (the direct
// list is ~380 KB, the known list ~1.3 MB), so results are trimmed to the
// fields Kickback uses before they are cached.
import { cacheGet, cacheSet, ageMs } from '../lib/cache'
import { isTestnet, net } from '../lib/net'

export const VALIDATORS_API = net.validatorsApiUrl

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

// ---------- reward rate: the Nimiq staking calculator ----------
// nimiq.com/staking computes the rate from one input, the staked ratio, which it reads from
// /api/staking-info. We do the same (src/lib/rate.ts is the exact port), falling back to the
// Validators API supply (staking / total) when that endpoint is unreachable or on testnet.
const STAKING_INFO = 'https://nimiq-website.je-cf9.workers.dev/api/staking-info'

export async function stakedRatio(s: ApiSupply | null): Promise<{ ratio: number, source: 'nimiq.com' | 'validators-api' } | null> {
  if (!isTestnet) {
    const c = cacheGet<number>('api:stakedRatio')
    if (c && ageMs(c) < 6 * 3600e3) return { ratio: c.v, source: 'nimiq.com' }
    try {
      const r = await fetch(STAKING_INFO, { signal: AbortSignal.timeout(8000) })
      const j = await r.json() as { stakedRatio?: number }
      if (r.ok && typeof j.stakedRatio === 'number' && j.stakedRatio > 0 && j.stakedRatio <= 1) { cacheSet('api:stakedRatio', j.stakedRatio); return { ratio: j.stakedRatio, source: 'nimiq.com' } }
    }
    catch { /* fall back */ }
    if (c) return { ratio: c.v, source: 'nimiq.com' }
  }
  if (s?.total && s.staking) return { ratio: s.staking / s.total, source: 'validators-api' }
  return null
}

/** Gross rate (before the pool fee) from the Nimiq staking calculator, or null. */
export function calculatorGross(ratio: number | null | undefined): number | null {
  return ratio ? nimiqCalculatorRate(ratio, 0, { chain: isTestnet ? 'test' : 'main' }) : null
}
