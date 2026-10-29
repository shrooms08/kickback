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
  if (b.method === 'getBlockByNumber' && params[1] != null && params[1] !== false) return { ok: false, status: 400, error: 'blocks without transaction bodies only' }
  return { ok: true, method: b.method, params, id: b.id ?? 1 }
}

/**
 * The caller's IP. On Supabase the gateway sits behind Cloudflare, which sets cf-connecting-ip
 * itself (a caller's own value is replaced). Without it (local stack), the LAST x-forwarded-for
 * hop, added by the proxy in front of us. The first hop and x-real-ip can be written by the
 * caller: never trusted.
 */
export function clientIp(h: Headers): string {
  const cf = h.get('cf-connecting-ip')?.trim()
  if (cf) return ipKey(cf)
  const hops = (h.get('x-forwarded-for') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return hops.length ? ipKey(hops[hops.length - 1]) : 'unknown'
}

/**
 * The rate-limit key of an IP: IPv4 as it is, IPv6 as its /64 (one subscriber usually gets a
 * whole /64, so per-address keys would be free to rotate). IPv4-mapped IPv6 is plain IPv4.
 * Anything that doesn't parse is kept as written.
 */
export function ipKey(raw: string): string {
  const a = raw.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '').toLowerCase()
  if (!a.includes(':')) return a
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a)
  if (mapped) return mapped[1]
  const parts = a.split('::')
  if (parts.length > 2) return a
  const head = parts[0] ? parts[0].split(':') : [], tail = parts.length === 2 && parts[1] ? parts[1].split(':') : []
  const groups = parts.length === 2 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head
  if (groups.length !== 8 || !groups.every(g => /^[0-9a-f]{1,4}$/.test(g))) return a
  return groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':') + '::/64'
}

/** Fixed-window counter per key (IP). When full, expired windows are evicted (never a global reset). */
export class RateLimiter {
  private hits = new Map<string, { n: number, start: number }>()
  constructor(private max: number, private windowMs: number, private now: () => number = Date.now, private maxKeys = 10_000) {}
  allow(key: string): boolean {
    const t = this.now()
    const h = this.hits.get(key)
    if (!h || t - h.start > this.windowMs) {
      if (!h && this.hits.size >= this.maxKeys) {
        for (const [k, v] of this.hits) if (t - v.start > this.windowMs) this.hits.delete(k)
        // Still full of live windows: refuse new keys rather than forget the counted ones.
        if (this.hits.size >= this.maxKeys) return false
      }
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
