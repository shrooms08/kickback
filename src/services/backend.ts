// Kickback's Supabase backend: Edge Functions for sign-in and sync, and the public pool_stats
// table (anon key, read only). Without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY the app runs
// local-only, exactly as before.
import { net } from '../lib/net'

const URL_ = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') || ''
const ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || ''

export const backendEnabled = !!URL_ && !!ANON
export const backendUrl = URL_

export class BackendError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'BackendError'
    this.status = status
  }
}

/** Call an Edge Function. Throws BackendError (status 0 = network failure or timeout). */
export async function callFn<T>(name: string, opts: { method?: 'GET' | 'POST' | 'PUT', body?: unknown, token?: string | null, timeoutMs?: number } = {}): Promise<T> {
  if (!backendEnabled) throw new BackendError(0, 'Backend not configured')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000)
  let res: Response
  try {
    res = await fetch(`${URL_}/functions/v1/${name}`, {
      method: opts.method ?? 'POST',
      headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctrl.signal,
    })
  }
  catch (error) {
    throw new BackendError(0, (error as Error).name === 'AbortError' ? 'Timed out' : 'Network error')
  }
  finally { clearTimeout(timer) }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new BackendError(res.status, (data as { error?: string }).error || `HTTP ${res.status}`)
  return data as T
}

/** One row of public.pool_stats. */
export interface PoolStatsRow {
  network: string
  validator_address: string
  name: string | null
  fee: number | null
  reward_address: string | null
  last_payout_at: string | null
  median_interval_s: number | null
  next_payout_estimate_at: string | null
  payout_kind: 'direct' | 'restake' | 'unknown' | null
  active: boolean
  elected: boolean
  score: number | null
  score_status: string | null
  listed: boolean | null
  payout_schedule: string | null
  updated_at: string
}

/** pool_stats for the current network, read with the anon key (RLS: public select only). */
export async function readPoolStats(timeoutMs = 6000): Promise<PoolStatsRow[]> {
  if (!backendEnabled) throw new BackendError(0, 'Backend not configured')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${URL_}/rest/v1/pool_stats?network=eq.${net.network}&select=*`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }, signal: ctrl.signal })
    if (!res.ok) throw new BackendError(res.status, `pool_stats: HTTP ${res.status}`)
    return await res.json() as PoolStatsRow[]
  }
  catch (error) {
    if (error instanceof BackendError) throw error
    throw new BackendError(0, 'pool_stats unreachable')
  }
  finally { clearTimeout(timer) }
}
