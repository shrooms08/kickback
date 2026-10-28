/**
 * rpc-proxy rules (pure, so vitest covers them): only read-only methods the app uses, small and
 * well-formed params, no batches. Nothing that sends, signs or touches accounts is ever forwarded.
 */
export const PROXY_METHODS = new Set([
  'getBlockNumber', 'getAccountByAddress', 'getStakerByAddress', 'getValidatorByAddress', 'getActiveValidators',
  'getTransactionsByAddress', 'getTransactionByHash', 'getBlockAfterReportingWindow', 'getBlockByNumber',
])

export type ProxyCheck = { ok: true, method: string, params: unknown[], id: unknown } | { ok: false, status: number, error: string }

export function checkProxyRequest(body: unknown): ProxyCheck {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: 400, error: 'one JSON-RPC request, no batches' }
  const b = body as Record<string, unknown>
  if (typeof b.method !== 'string' || !PROXY_METHODS.has(b.method)) return { ok: false, status: 403, error: 'method not allowed' }
  const params = b.params ?? []
  if (!Array.isArray(params) || params.length > 4) return { ok: false, status: 400, error: 'params must be a list of at most 4' }
  for (const p of params) {
    const fine = p === null || typeof p === 'boolean' || (typeof p === 'number' && Number.isFinite(p)) || (typeof p === 'string' && p.length <= 120)
    if (!fine) return { ok: false, status: 400, error: 'params must be short strings, numbers, booleans or null' }
  }
  if (b.method === 'getTransactionsByAddress' && Number(params[1] ?? 500) > 100) return { ok: false, status: 400, error: 'at most 100 transactions per page' }
  return { ok: true, method: b.method, params, id: b.id ?? 1 }
}

/** Fixed-window counter per key (IP). */
export class RateLimiter {
  private hits = new Map<string, { n: number, start: number }>()
  constructor(private max: number, private windowMs: number, private now: () => number = Date.now) {}
  allow(key: string): boolean {
    const t = this.now()
    const h = this.hits.get(key)
    if (!h || t - h.start > this.windowMs) {
      if (this.hits.size > 5000) this.hits.clear()
      this.hits.set(key, { n: 1, start: t })
      return true
    }
    h.n++
    return h.n <= this.max
  }
}

/** Small in-memory cache with a time to live and a size cap. */
export class TtlCache<V> {
  private m = new Map<string, { at: number, v: V }>()
  constructor(private ttlMs: number, private max: number, private now: () => number = Date.now) {}
  get(k: string): V | undefined {
    const e = this.m.get(k)
    if (!e) return undefined
    if (this.now() - e.at > this.ttlMs) { this.m.delete(k); return undefined }
    return e.v
  }
  set(k: string, v: V) {
    if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value as string)
    this.m.set(k, { at: this.now(), v })
  }
}
