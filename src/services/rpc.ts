// JSON-RPC client for the current network, over an ordered list of public nodes (src/lib/net.ts)
// with failover, and Kickback's Supabase rpc-proxy as the last resort (src/lib/endpoints.ts).
// The node allows about 20 units per 10 seconds per IP; history requests with
// max > 100 cost 5 units, everything else 1. This client:
//  - spends at most 16 units per 10s (token bucket, FIFO), and also pauses when
//    the node's own x-ratelimit headers say the window is nearly used up
//  - de-duplicates identical calls that are in flight
//  - times out after 8s; a network error, timeout, 5xx, 429 or non-JSON reply fails over to the
//    next endpoint (the failed one is retried after 60s); JSON-RPC errors are answers
//  - turns "No staker with address" into a normal `null` result
//  - caches results (memory + localStorage, timestamped) for stale-while-revalidate
import { reactive } from 'vue'
import { cacheGet, cacheSet, ageMs } from '../lib/cache'
import { net } from '../lib/net'
import { backendUrl } from './backend'
import { EndpointPool, classifyFailure } from '../lib/endpoints'
import { REST_FALLBACK, restResult, restUrl } from '../lib/restAdapter'

export const RPC_URL = net.rpcUrl
const BUDGET = 16
const WINDOW_MS = 10_000
const TIMEOUT_MS = 8_000
const HEALTH_TIMEOUT_MS = 3_000

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

// ---------- endpoints ----------
// An ordered list per network (src/lib/net.ts), then our Supabase rpc-proxy as the last resort.
// One token bucket per endpoint: every public node has its own budget.
const proxyUrl = backendUrl ? `${backendUrl}/functions/v1/rpc-proxy?network=${net.network}` : null
export const rpcPool = new EndpointPool(net.rpcUrls ?? [net.rpcUrl], { rest: REST_FALLBACK[net.network], proxy: proxyUrl })
/** Bumped whenever an endpoint's state changes (Diagnostics re-renders). */
export const rpcHealth = reactive({ tick: 0, active: '' as string, allDown: false })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

class Bucket {
  tokens = BUDGET
  last = Date.now()
  queue: Promise<void> = Promise.resolve()
  pausedUntil = 0
  refill() {
    const now = Date.now()
    this.tokens = Math.min(BUDGET, this.tokens + (now - this.last) * BUDGET / WINDOW_MS)
    this.last = now
  }
  acquire(cost: number): Promise<void> {
    const turn = this.queue.then(async () => {
      const t0 = Date.now()
      for (;;) {
        if (Date.now() < this.pausedUntil) { await sleep(this.pausedUntil - Date.now()); continue }
        this.refill()
        if (this.tokens >= cost) { this.tokens -= cost; break }
        await sleep(Math.ceil((cost - this.tokens) * WINDOW_MS / BUDGET))
      }
      rpcStats.waitedMs += Date.now() - t0
    })
    this.queue = turn.catch(() => {})
    return turn
  }
}
const buckets = new Map<string, Bucket>()
const bucketFor = (url: string) => { let b = buckets.get(url); if (!b) { b = new Bucket(); buckets.set(url, b) } return b }

function costOf(method: string, params: unknown[]): number {
  if (method === 'getTransactionsByAddress' || method === 'getTransactionHashesByAddress') {
    const max = Number(params[1] ?? 500)
    return max > 100 ? 5 : 1
  }
  return 1
}

function noteHealth() {
  rpcHealth.tick++
  rpcHealth.active = rpcPool.active() ?? ''
  rpcHealth.allDown = !rpcHealth.active
}

type Attempt<T> = { kind: 'answer', value: T } | { kind: 'rpcError', error: RpcError } | { kind: 'failover', reason: string } | { kind: 'skip' }

/** The REST fallback: a GET for the methods it can answer ('skip' for the rest, not a failure). */
async function attemptRest<T>(base: string, method: string, params: unknown[], timeoutMs: number): Promise<Attempt<T>> {
  const url = restUrl(base, method, params)
  if (!url) return { kind: 'skip' }
  const t0 = performance.now()
  let res: Response
  try { res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }) }
  catch (error) { return { kind: 'failover', reason: (error as Error).name === 'TimeoutError' ? `timed out after ${timeoutMs / 1000}s` : 'network error' } }
  const body = await res.json().catch(() => null)
  const r = restResult(method, params, res.status, body)
  if (!r) return { kind: 'failover', reason: `HTTP ${res.status}` }
  rpcPool.markOk(base, performance.now() - t0)
  if (r.error) return { kind: 'rpcError', error: new RpcError(r.error.code, r.error.message, r.error.data, method) }
  return { kind: 'answer', value: r.result!.data as T }
}

/** One request to one endpoint, classified: an answer, a JSON-RPC error (also an answer), or a failed endpoint. */
async function attempt<T>(url: string, method: string, params: unknown[], timeoutMs: number): Promise<Attempt<T>> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const t0 = performance.now()
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcStats.calls, method, params }),
      signal: ctrl.signal,
    })
  }
  catch (error) {
    clearTimeout(timer)
    const timeout = ctrl.signal.aborted
    return { kind: 'failover', reason: timeout ? `timed out after ${timeoutMs / 1000}s` : ((error as Error).message || 'network error') }
  }
  clearTimeout(timer)
  const remaining = Number(res.headers.get('x-ratelimit-remaining'))
  const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000
  const bucket = bucketFor(url)
  if (res.status === 429) {
    rpcStats.throttled++
    bucket.pausedUntil = Math.max(bucket.pausedUntil, (reset || Date.now() + WINDOW_MS) + 250)
    bucket.tokens = 0
  }
  else if (res.headers.has('x-ratelimit-remaining') && remaining <= 2 && reset) bucket.pausedUntil = Math.max(bucket.pausedUntil, reset + 250)
  let body: { result?: { data: T }, error?: { code: number, message: string, data?: unknown } | string } | null = null
  try { body = await res.json() }
  catch { body = null }
  if (classifyFailure({ status: res.status, json: !!body && (body.result !== undefined || body.error !== undefined) }) === 'failover') return { kind: 'failover', reason: `HTTP ${res.status}${body ? '' : ': not JSON'}` }
  rpcPool.markOk(url, performance.now() - t0)
  if (body!.error) {
    const e = typeof body!.error === 'string' ? { code: res.status, message: body!.error } : body!.error
    return { kind: 'rpcError', error: new RpcError(e.code, e.message, e.data, method) }
  }
  return { kind: 'answer', value: (body!.result?.data ?? null) as T }
}

// ---------- one request ----------
async function send<T>(method: string, params: unknown[]): Promise<T> {
  const cost = costOf(method, params)
  const tried: string[] = []
  for (const ep of rpcPool.order()) {
    await bucketFor(ep.url).acquire(cost)
    rpcStats.calls++
    rpcStats.units += cost
    rpcStats.byMethod[method] = (rpcStats.byMethod[method] || 0) + 1
    const r = ep.kind === 'rest' ? await attemptRest<T>(ep.url, method, params, TIMEOUT_MS) : await attempt<T>(ep.url, method, params, TIMEOUT_MS)
    if (r.kind === 'skip') continue
    if (r.kind === 'failover') {
      rpcPool.markDown(ep.url, r.reason)
      tried.push(`${new URL(ep.url).host}: ${r.reason}`)
      rpcStats.retries++
      noteHealth()
      continue
    }
    noteHealth()
    if (r.kind === 'answer') return r.value
    const e = r.error
    // Not a staker is an answer, not a failure.
    if (method === 'getStakerByAddress' && typeof e.data === 'string' && e.data.startsWith('No staker with address')) return null as T
    rpcStats.errors++
    rpcStats.lastError = `${method}: ${e.code} ${e.message}${e.data ? ` (${String(e.data)})` : ''}`
    throw e
  }
  rpcStats.errors++
  rpcStats.lastError = `${method}: every RPC endpoint failed${tried.length ? ` (${tried.join('; ')})` : ' (all waiting to be retried)'}`
  noteHealth()
  throw new RpcError('ALL_DOWN', 'Network data is unavailable right now', undefined, method)
}

/** Health check (getBlockNumber, 3 s) of every endpoint, in parallel: on start and from Diagnostics. */
export async function checkEndpoints(): Promise<void> {
  await Promise.all(rpcPool.status().map(async (ep) => {
    const check = ep.kind === 'rest' ? attemptRest<number>(ep.url, 'getBlockNumber', [], HEALTH_TIMEOUT_MS) : attempt<number>(ep.url, 'getBlockNumber', [], HEALTH_TIMEOUT_MS)
    const r = await check.catch(() => ({ kind: 'failover', reason: 'error' }) as const)
    if (r.kind === 'failover') rpcPool.markDown(ep.url, r.reason)
  }))
  noteHealth()
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
