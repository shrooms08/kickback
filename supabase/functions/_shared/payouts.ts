import { EndpointPool, classifyFailure } from './endpoints.ts'
/**
 * Pool payout timing, server side. The same method the app uses (src/services/chain.ts):
 * payouts land as many transactions within minutes, so times are grouped into batches
 * (10-minute gap); the interval is the median gap between batches. A pool's reward address is
 * flooded with block rewards, so the cheap read is a *probe*: a known staker of that pool,
 * whose short history shows weeks of payouts. Falls back to scanning the reward address.
 * No Deno APIs here: fetch only.
 */

const H = 3600e3

export function batchTimes(times: number[], gapMs = 10 * 60e3): number[] {
  const sorted = [...times].sort((a, b) => b - a)
  const out: number[] = []
  for (const t of sorted) {
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

/** The first expected payout after `now`: last payout plus whole intervals. */
export function nextPayoutAfter(lastAt: number | null, intervalH: number | null, now = Date.now()): number | null {
  if (!lastAt || !intervalH) return null
  const step = intervalH * H
  return lastAt + Math.max(1, Math.ceil((now - lastAt) / step)) * step
}

export interface Tx { hash: string, timestamp: number, from: string, to: string, value: number, relatedAddresses?: string[] }

const norm = (a: string) => a.replace(/\s+/g, '').toUpperCase()

/**
 * JSON-RPC with the public nodes' budget: about 20 units per 10 s per IP; history reads with
 * max > 100 cost 5. This client spends at most `budget` units per 10 s per endpoint. With several
 * URLs it fails over in order on network errors, timeouts, 5xx, 429 and non-JSON replies (the
 * failed one is retried after 60 s); a JSON-RPC error is an answer and is thrown as before.
 * `retry429: false` (user-facing reads): a 429 fails over at once instead of sleeping.
 */
export function createRpc(urls: string | string[], budget = 14, opts: { retry429?: boolean } = {}) {
  const retry429 = opts.retry429 ?? true
  const pool = new EndpointPool(Array.isArray(urls) ? urls : [urls])
  const buckets = new Map<string, { tokens: number, last: number }>()
  let units = 0, calls = 0
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
  async function take(url: string, cost: number) {
    const b = buckets.get(url) ?? { tokens: budget, last: Date.now() }
    buckets.set(url, b)
    for (;;) {
      const now = Date.now()
      b.tokens = Math.min(budget, b.tokens + (now - b.last) * budget / 10_000)
      b.last = now
      if (b.tokens >= cost) { b.tokens -= cost; return }
      await sleep(Math.ceil((cost - b.tokens) * 10_000 / budget))
    }
  }
  /** The node's reply as it is ({ result } or { error }), from the first endpoint that answers. */
  async function raw(method: string, params: unknown[]): Promise<{ result?: { data: unknown, metadata?: unknown }, error?: { code: number, message: string, data?: unknown } }> {
    const cost = method === 'getTransactionsByAddress' && Number(params[1]) > 100 ? 5 : 1
    const failed: string[] = []
    for (const ep of pool.order()) {
      for (let attempt = 0; ; attempt++) {
        await take(ep.url, cost)
        calls++; units += cost
        let res: Response
        try { res = await fetch(ep.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: calls, method, params }), signal: AbortSignal.timeout(8000) }) }
        catch (e) { pool.markDown(ep.url, (e as Error).name === 'TimeoutError' ? 'timeout' : 'network'); failed.push(`${ep.url}: network`); break }
        if (res.status === 429 && retry429 && attempt < 2) { buckets.get(ep.url)!.tokens = 0; await sleep(5000); continue }
        const body = await res.json().catch(() => null)
        if (classifyFailure({ status: res.status, json: !!body && (body.result !== undefined || body.error !== undefined) }) === 'failover') { pool.markDown(ep.url, `HTTP ${res.status}`); failed.push(`${ep.url}: HTTP ${res.status}`); break }
        pool.markOk(ep.url, 0)
        return body
      }
    }
    throw new Error(`${method}: every RPC endpoint failed${failed.length ? ` (${failed.join('; ')})` : ''}`)
  }
  async function call<T>(method: string, params: unknown[]): Promise<T> {
    const body = await raw(method, params)
    if (body.error) throw new Error(rpcErrorText(method, body.error))
    return body.result?.data as T
  }
  return { call, raw, stats: () => ({ calls, units }), status: () => pool.status() }
}

export type Rpc = ReturnType<typeof createRpc>

/** The node puts the useful part ("No staker with address …") in error.data: keep it. */
export function rpcErrorText(method: string, e: { message?: string, data?: unknown }): string {
  const data = typeof e.data === 'string' ? e.data : e.data != null ? JSON.stringify(e.data) : ''
  return `${method}: ${e.message ?? 'error'}${data ? `: ${data}` : ''}`
}

export interface PayoutStats { lastPaidAt: number | null, intervalH: number | null, batches: number[], source: 'probe' | 'scan' | 'none', probe?: string }

/** A probe staker's last 25 transactions (1 unit): payouts from the reward address, to the wallet or as AddStake. */
export async function fromProbe(rpc: Rpc, reward: string, probe: string, aliveMs = 72 * H): Promise<PayoutStats | null> {
  const txs = await rpc.call<Tx[]>('getTransactionsByAddress', [probe, 25, null])
  const times = (txs || []).filter(t => norm(t.from) === norm(reward) && t.value > 0).map(t => t.timestamp)
  if (!times.length || Date.now() - Math.max(...times) > aliveMs) return null
  const batches = batchTimes(times)
  return { lastPaidAt: batches[0], intervalH: medianGapHours(batches), batches, source: 'probe', probe }
}

/**
 * Scan the reward address in pages of 500 (5 units each) until two payout batches show up, or
 * `maxPages`. Returns the biggest recent direct recipient as a new probe.
 */
export async function fromScan(rpc: Rpc, reward: string, maxPages = 4, aliveMs = 72 * H): Promise<PayoutStats & { learned?: string }> {
  const since = Date.now() - aliveMs
  const out: Tx[] = []
  let startAt: string | null = null
  for (let page = 0; page < maxPages; page++) {
    const list = await rpc.call<Tx[]>('getTransactionsByAddress', [reward, 500, startAt]) || []
    out.push(...list.filter(t => norm(t.from) === norm(reward) && norm(t.to) !== norm(reward) && t.value > 0))
    if (batchTimes(out.map(t => t.timestamp)).length >= 2) break
    if (list.length < 500 || list[list.length - 1].timestamp < since) break
    startAt = list[list.length - 1].hash
  }
  const recent = out.filter(t => t.timestamp >= since)
  if (!recent.length) return { lastPaidAt: out.length ? Math.max(...out.map(t => t.timestamp)) : null, intervalH: null, batches: [], source: 'scan' }
  // Only a wallet payout makes a useful probe: AddStake payouts go to the staking contract and
  // do not show up in the staker's own address history.
  const staking = 'NQ7700000000000000000000000000000001'
  const learned = [...recent].filter(t => norm(t.to) !== staking).sort((a, b) => b.value - a.value)[0]?.to
  const batches = batchTimes(recent.map(t => t.timestamp))
  return { lastPaidAt: batches[0], intervalH: medianGapHours(batches), batches, source: 'scan', learned }
}
