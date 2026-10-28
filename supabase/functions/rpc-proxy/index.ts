// rpc-proxy: POST ?network=mainnet|testnet with one JSON-RPC request. The app's last resort when
// every public endpoint it can reach from the browser has failed. Forwards ONLY read-only
// methods on an allowlist (_shared/rpcProxy.ts) to the server-side endpoint list (failover,
// including endpoints without CORS), caches identical calls for 15 s and rate limits per IP.
// Nothing that sends, signs or touches accounts is ever forwarded.
// Limits (Postgres, shared by every isolate): RPC_PROXY_IP_MAX calls per IP a minute (default 60)
// and RPC_PROXY_GLOBAL_MAX upstream calls a minute for everyone together (default 60, half the
// public node's per-IP budget), so the proxy can't starve pool-stats-cron and xp-cron.
import { corsHeaders, json, readJson } from '../_shared/http.ts'
import { createRpc } from '../_shared/payouts.ts'
import { allowHit, limitFromEnv } from '../_shared/rateLimit.ts'
import { RateLimiter, TtlCache, checkProxyRequest, clientIp } from '../_shared/rpcProxy.ts'
import { serverRest, serverRpcUrls } from '../_shared/rpcEndpoints.ts'
import type { Net } from '../_shared/rpcEndpoints.ts'

const IP_MAX = limitFromEnv('RPC_PROXY_IP_MAX', 60)
const GLOBAL_MAX = limitFromEnv('RPC_PROXY_GLOBAL_MAX', 60)
// First line, per isolate (no database round trip for an obvious flood).
const limiter = new RateLimiter(IP_MAX, 60_000)
const cache = new TtlCache<{ result?: unknown, error?: unknown }>(15_000, 2000)
const clients: Partial<Record<Net, ReturnType<typeof createRpc>>> = {}

// The node's reply is passed on as it is: a result, or a JSON-RPC error such as "No staker".
async function forward(net: Net, method: string, params: unknown[]): Promise<{ result?: unknown, error?: unknown }> {
  const rpc = clients[net] ??= createRpc(serverRpcUrls(net), 14, { retry429: false, rest: serverRest(net), maxWaitMs: 1000, timeoutMs: 3500 })
  const r = await rpc.raw(method, params)
  return r.error ? { error: r.error } : { result: r.result }
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req, Deno.env.get('ALLOWED_ORIGINS') ?? '')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, cors)
  const net = new URL(req.url).searchParams.get('network') as Net
  if (net !== 'mainnet' && net !== 'testnet') return json({ error: 'network must be mainnet or testnet' }, 400, cors)
  const ip = clientIp(req.headers)
  if (!limiter.allow(ip) || !(await allowHit(`rpc:ip:${ip}`, 60, IP_MAX))) return json({ error: 'Too many requests' }, 429, cors)
  const check = checkProxyRequest(await readJson(req))
  if (!check.ok) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: check.error } }, check.status, cors)
  const key = `${net}:${check.method}:${JSON.stringify(check.params)}`
  let reply = cache.get(key)
  if (!reply) {
    if (!(await allowHit('rpc:global', 60, GLOBAL_MAX))) return json({ error: 'Too many requests' }, 429, cors)
    try { reply = await forward(net, check.method, check.params) }
    // The proxy itself is fine; no upstream could answer this method. A JSON-RPC error (HTTP 200)
    // so the app doesn't take the proxy for down (it fails over on 5xx).
    catch { return json({ jsonrpc: '2.0', id: check.id, error: { code: -32001, message: 'No Nimiq RPC endpoint can answer this right now' } }, 200, cors) }
    // Only answers are cached, and only small ones.
    if (!reply.error && JSON.stringify(reply).length <= 32_000) cache.set(key, reply)
  }
  return json({ jsonrpc: '2.0', id: check.id, ...reply }, 200, cors)
})
