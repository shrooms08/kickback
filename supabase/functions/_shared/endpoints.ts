// Ordered RPC endpoint list with failover (pure; shared by the app's RPC client and tested).
// The first healthy endpoint is used. An endpoint that fails (network error, timeout, 5xx,
// 429, a body that isn't JSON) is skipped for 60 s, then tried again. A valid JSON-RPC answer
// is never a failure, even an error such as "No staker with address". The proxy (our Supabase
// rpc-proxy) always comes last.

export type EndpointKind = 'direct' | 'proxy'
export interface Endpoint { url: string, kind: EndpointKind }
export interface EndpointStatus { url: string, kind: EndpointKind, state: 'ok' | 'down' | 'unknown', lastError: string, latencyMs: number | null }

export const RETRY_AFTER_MS = 60_000

export class EndpointPool {
  private list: Array<Endpoint & { downUntil: number, state: EndpointStatus['state'], lastError: string, latencyMs: number | null }>
  private now: () => number
  private retryMs: number

  constructor(urls: string[], opts: { now?: () => number, proxy?: string | null, retryMs?: number } = {}) {
    this.now = opts.now ?? Date.now
    this.retryMs = opts.retryMs ?? RETRY_AFTER_MS
    const all: Endpoint[] = [...urls.map(url => ({ url, kind: 'direct' as const })), ...(opts.proxy ? [{ url: opts.proxy, kind: 'proxy' as const }] : [])]
    this.list = all.map(e => ({ ...e, downUntil: 0, state: 'unknown', lastError: '', latencyMs: null }))
  }

  /** Endpoints to try now, in order (failed ones are left out until their retry time). */
  order(): Endpoint[] {
    const t = this.now()
    return this.list.filter(e => e.downUntil <= t).map(({ url, kind }) => ({ url, kind }))
  }

  /** The endpoint a call would use now, or null when every one is waiting to be retried. */
  active(): string | null { return this.order()[0]?.url ?? null }

  markOk(url: string, latencyMs: number) {
    const e = this.list.find(x => x.url === url)
    if (e) Object.assign(e, { downUntil: 0, state: 'ok', lastError: '', latencyMs: Math.round(latencyMs) })
  }

  markDown(url: string, error: string) {
    const e = this.list.find(x => x.url === url)
    if (e) Object.assign(e, { downUntil: this.now() + this.retryMs, state: 'down', lastError: error })
  }

  status(): EndpointStatus[] {
    return this.list.map(({ url, kind, state, lastError, latencyMs }) => ({ url, kind, state, lastError, latencyMs }))
  }
}

/** Is this response a failed endpoint (try the next one) or an answer (return or throw it)? */
export function classifyFailure(r: { network?: boolean, timeout?: boolean, status?: number, json?: boolean, rpcError?: string }): 'failover' | 'answer' {
  if (r.network || r.timeout) return 'failover'
  if (r.status != null && (r.status >= 500 || r.status === 429)) return 'failover'
  if (!r.json) return 'failover'
  return 'answer'
}
