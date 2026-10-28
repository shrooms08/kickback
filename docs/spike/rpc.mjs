// Minimal read-only JSON-RPC helper for rpc.nimiqwatch.com.
// Paces requests and backs off on HTTP 429 using x-ratelimit-reset (unix seconds).
// The scripts write raw responses to ./data, created here and not committed.
import { mkdirSync } from 'node:fs'
mkdirSync('data', { recursive: true })
export const RPC = process.env.RPC || 'https://rpc.nimiqwatch.com'
export const stats = { calls: 0, throttled: 0, limits: [] }
const sleep = ms => new Promise(r => setTimeout(r, ms))
export async function rpc(method, params = []) {
  for (let attempt = 0; attempt < 20; attempt++) {
    stats.calls++
    const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.vercel.app' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    const remaining = res.headers.get('x-ratelimit-remaining'), reset = Number(res.headers.get('x-ratelimit-reset'))
    stats.limits.push({ status: res.status, remaining, resetIn: reset ? reset - Math.floor(Date.now() / 1000) : null })
    if (res.status === 429) { stats.throttled++; await sleep(Math.max(1000, reset * 1000 - Date.now() + 1000)); continue }
    const j = await res.json()
    if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`)
    if (remaining !== null && Number(remaining) <= 1 && reset) await sleep(Math.max(0, reset * 1000 - Date.now() + 500))
    return j.result.data
  }
  throw new Error(`${method}: gave up after repeated 429s`)
}
