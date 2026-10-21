// JSON-RPC client for the public node of the current network (rpc.nimiqwatch.com,
// or rpc.testnet.nimiqwatch.com on testnet; see src/lib/net.ts).
// The node allows about 20 units per 10 seconds per IP; history requests with
// max > 100 cost 5 units, everything else 1. This client:
//  - spends at most 16 units per 10s (token bucket, FIFO), and also pauses when
//    the node's own x-ratelimit headers say the window is nearly used up
//  - de-duplicates identical calls that are in flight
//  - times out after 8s, retries network errors twice with backoff
//  - turns "No staker with address" into a normal `null` result
//  - caches results (memory + localStorage, timestamped) for stale-while-revalidate
import { reactive } from 'vue'
import { cacheGet, cacheSet, ageMs } from '../lib/cache'
import { net } from '../lib/net'

export const RPC_URL = net.rpcUrl
const BUDGET = 16
const WINDOW_MS = 10_000
const TIMEOUT_MS = 8_000
const RETRIES = 2

export class RpcError extends Error {
  code: number | string
  data?: unknown
  method?: string
  constructor(code: number | string, message: string, data?: unknown, method?: string) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.data = data
    this.method = method
  }
}

/** Live counters, shown in Diagnostics and used for the cold-open count. */
export const rpcStats = reactive({
  calls: 0,
  units: 0,
  deduped: 0,
  cacheHits: 0,
  retries: 0,
  throttled: 0,
  errors: 0,
  waitedMs: 0,
  byMethod: {} as Record<string, number>,
  lastError: '' as string,
})

export function resetRpcStats() {
  Object.assign(rpcStats, { calls: 0, units: 0, deduped: 0, cacheHits: 0, retries: 0, throttled: 0, errors: 0, waitedMs: 0, byMethod: {}, lastError: '' })
}

// ---------- token bucket ----------
let tokens = BUDGET
let last = Date.now()
let queue: Promise<void> = Promise.resolve()
let pausedUntil = 0
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function refill() {
  const now = Date.now()
  tokens = Math.min(BUDGET, tokens + (now - last) * BUDGET / WINDOW_MS)
  last = now
}

function acquire(cost: number): Promise<void> {
  const turn = queue.then(async () => {
    const t0 = Date.now()
    for (;;) {
      if (Date.now() < pausedUntil) { await sleep(pausedUntil - Date.now()); continue }
      refill()
      if (tokens >= cost) { tokens -= cost; break }
      await sleep(Math.ceil((cost - tokens) * WINDOW_MS / BUDGET))
    }
    rpcStats.waitedMs += Date.now() - t0
  })
  queue = turn.catch(() => {})
  return turn
}

function costOf(method: string, params: unknown[]): number {
  if (method === 'getTransactionsByAddress' || method === 'getTransactionHashesByAddress') {
    const max = Number(params[1] ?? 500)
    return max > 100 ? 5 : 1
  }
  return 1
}

// ---------- one request ----------
async function send<T>(method: string, params: unknown[]): Promise<T> {
  const cost = costOf(method, params)
  let attempt = 0
  for (;;) {
    await acquire(cost)
    rpcStats.calls++
    rpcStats.units += cost
    rpcStats.byMethod[method] = (rpcStats.byMethod[method] || 0) + 1
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: rpcStats.calls, method, params }),
        signal: ctrl.signal,
      })
    }
    catch (error) {
      clearTimeout(timer)
      // network error or timeout: retry with backoff
      if (attempt < RETRIES) { attempt++; rpcStats.retries++; await sleep(600 * 2 ** (attempt - 1)); continue }
      rpcStats.errors++
      const msg = ctrl.signal.aborted ? `Timed out after ${TIMEOUT_MS / 1000}s` : (error as Error).message
      rpcStats.lastError = `${method}: ${msg}`
      throw new RpcError(ctrl.signal.aborted ? 'TIMEOUT' : 'NETWORK', msg, undefined, method)
    }
    clearTimeout(timer)

    const remaining = Number(res.headers.get('x-ratelimit-remaining'))
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000
    if (res.status === 429) {
      rpcStats.throttled++
      pausedUntil = Math.max(pausedUntil, (reset || Date.now() + WINDOW_MS) + 250)
      tokens = 0
      if (attempt < RETRIES) { attempt++; continue }
      rpcStats.errors++
      throw new RpcError(429, 'Rate limit exceeded', undefined, method)
    }
    if (res.headers.has('x-ratelimit-remaining') && remaining <= 2 && reset) pausedUntil = Math.max(pausedUntil, reset + 250)

    let body: { result?: { data: T }, error?: { code: number, message: string, data?: unknown } | string }
    try { body = await res.json() }
    catch {
      rpcStats.errors++
      throw new RpcError(res.status, `HTTP ${res.status}: not JSON`, undefined, method)
    }
    if (body.error) {
      const e = typeof body.error === 'string' ? { code: res.status, message: body.error } : body.error
      // Not a staker is an answer, not a failure.
      if (method === 'getStakerByAddress' && typeof e.data === 'string' && e.data.startsWith('No staker with address')) return null as T
      rpcStats.errors++
      rpcStats.lastError = `${method}: ${e.code} ${e.message}${e.data ? ` (${String(e.data)})` : ''}`
      throw new RpcError(e.code, e.message, e.data, method)
    }
    return (body.result?.data ?? null) as T
  }
}

// ---------- de-duplication + cache ----------
const inflight = new Map<string, Promise<unknown>>()

export interface CallOptions {
  /** Serve from cache without a request while younger than this (ms). */
  ttl?: number
  /** Polling: always ask the node, never cache the answer. */
  noStore?: boolean
}

export interface Result<T> {
  value: T
  /** When the value was fetched (ms since epoch). */
  at: number
  /** True when the request failed and this is an older cached value. */
  stale: boolean
}

/**
 * Call a method. Fresh cache (younger than `ttl`) is returned without a request.
 * If the request fails and any cached value exists, that value is returned with
 * `stale: true`; otherwise the error is thrown.
 */
export async function rpc<T>(method: string, params: unknown[], opts: CallOptions = {}): Promise<Result<T>> {
  const key = `rpc:${method}:${JSON.stringify(params)}`
  if (opts.noStore) {
    let p = inflight.get(key) as Promise<T> | undefined
    if (!p) { p = send<T>(method, params).finally(() => inflight.delete(key)); inflight.set(key, p) }
    return { value: await p, at: Date.now(), stale: false }
  }
  const cached = cacheGet<T>(key)
  if (cached && opts.ttl && ageMs(cached) < opts.ttl) {
    rpcStats.cacheHits++
    return { value: cached.v, at: cached.t, stale: false }
  }
  let p = inflight.get(key) as Promise<T> | undefined
  if (p) rpcStats.deduped++
  else {
    p = send<T>(method, params).finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  try {
    const value = await p
    const e = cacheSet(key, value)
    return { value, at: e.t, stale: false }
  }
  catch (error) {
    if (cached) return { value: cached.v, at: cached.t, stale: true }
    throw error
  }
}

/** Cached value without any request (for instant first paint). */
export function rpcPeek<T>(method: string, params: unknown[]): Result<T> | null {
  const e = cacheGet<T>(`rpc:${method}:${JSON.stringify(params)}`)
  return e ? { value: e.v, at: e.t, stale: false } : null
}
