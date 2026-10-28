// Persistent rate limits (public.hit_rate_limit in Postgres): the same count in every isolate.
import { db } from './db.ts'

/**
 * true = allowed. Counts one hit on `key` in a fixed window of `windowS` seconds.
 * If the database can't answer, the call is allowed (and logged): a limiter outage must not
 * take the app down; the function's own database work fails anyway in that case.
 */
export async function allowHit(key: string, windowS: number, max: number): Promise<boolean> {
  const { data, error } = await db.rpc('hit_rate_limit', { p_key: key, p_window_s: windowS, p_max: max })
  if (error) { console.error('rate limit', key.split(':')[0], error.message); return true }
  return data === true
}

/** A positive whole number from an env var (function secret), else the production default. */
export function limitFromEnv(name: string, fallback: number): number {
  const n = Number(Deno.env.get(name))
  return Number.isInteger(n) && n > 0 ? n : fallback
}
