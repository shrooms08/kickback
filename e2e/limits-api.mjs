// Persistent rate limits against the LOCAL stack only (it reads and seeds public.rate_limits
// through `docker exec … psql`): rpc-proxy per IP and its global upstream cap, auth-nonce per IP
// and per address.
// Limits are seeded as already full instead of looping up to them, so the test does not depend
// on the configured numbers and does not use up the budget other suites need. Every key the test
// touched is removed at the end.
// Usage: node e2e/limits-api.mjs   (needs `supabase start` + `supabase functions serve`)
import { execFileSync } from 'node:child_process'
import { freshAddress } from './lib.mjs'

const FN = 'http://127.0.0.1:54321/functions/v1'
const results = []
const log = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }
const sql = q => execFileSync('docker', ['exec', '-i', 'supabase_db_kickback', 'psql', '-U', 'postgres', '-d', 'postgres', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { input: q, encoding: 'utf8' }).trim()
async function call(fn, { method = 'POST', body, token, headers = {} } = {}) {
  const r = await fetch(`${FN}/${fn}`, { method, headers: { 'content-type': 'application/json', ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const lit = s => `'${String(s).replace(/'/g, "''")}'`
/** Mark a key as used up for the next minute. */
const fill = key => sql(`insert into public.rate_limits (key, window_start, hits, expires_at) values (${lit(key)}, now(), 1000000, now() + interval '1 minute')
  on conflict (key) do update set window_start = now(), hits = 1000000, expires_at = now() + interval '1 minute';`)
const touched = new Set()
const cleanup = () => { if (touched.size) sql(`delete from public.rate_limits where key in (${[...touched].map(lit).join(',')});`) }

try {
  // rpc-proxy: a refused method still counts against the caller, so nothing goes upstream here.
  const r0 = await call('rpc-proxy?network=testnet', { body: { method: 'sendRawTransaction', params: [] } })
  const ipKey = sql(`select key from public.rate_limits where key like 'rpc:ip:%' order by window_start desc limit 1;`)
  touched.add(ipKey)
  log('rpc-proxy counts each caller in Postgres (rate_limits row per IP)', r0.status === 403 && ipKey.startsWith('rpc:ip:'), `HTTP ${r0.status} key ${ipKey}`)
  fill(ipKey)
  const r1 = await call('rpc-proxy?network=testnet', { body: { method: 'getBlockNumber', params: [] } })
  log('rpc-proxy: an IP over its limit gets 429 (limit kept in Postgres, not per isolate)', r1.status === 429, `HTTP ${r1.status}`)
  sql(`delete from public.rate_limits where key = ${lit(ipKey)};`)

  // Global cap on calls that reach the upstream nodes: full -> refused before any RPC is made.
  touched.add('rpc:global')
  fill('rpc:global')
  const fresh = Math.floor(Math.random() * 1e6) + 1
  const r2 = await call('rpc-proxy?network=testnet', { body: { method: 'getBlockByNumber', params: [fresh, false] } })
  log('rpc-proxy: the global upstream cap refuses new upstream calls when full', r2.status === 429, `HTTP ${r2.status} ${JSON.stringify(r2.data).slice(0, 80)}`)
  sql(`delete from public.rate_limits where key = 'rpc:global';`)

  // auth-nonce: per address and per IP.
  const addr = freshAddress(), other = freshAddress()
  const n0 = await call('auth-nonce', { body: { address: addr, network: 'testnet' } })
  const addrKey = `nonce:addr:testnet:${addr}`
  touched.add(addrKey)
  log('auth-nonce counts each address in Postgres', n0.status === 200 && sql(`select hits from public.rate_limits where key = ${lit(addrKey)};`) === '1', `HTTP ${n0.status}`)
  const nonceIpKey = sql(`select key from public.rate_limits where key like 'nonce:ip:%' order by window_start desc limit 1;`)
  touched.add(nonceIpKey)
  log('auth-nonce counts each caller IP in Postgres', nonceIpKey.startsWith('nonce:ip:'), nonceIpKey)
  fill(addrKey)
  const n1 = await call('auth-nonce', { body: { address: addr, network: 'testnet' } })
  log('auth-nonce: an address over its limit gets 429', n1.status === 429, `HTTP ${n1.status}`)
  const n2 = await call('auth-nonce', { body: { address: other, network: 'testnet' } })
  log('auth-nonce: another address from the same IP still gets a nonce', n2.status === 200, `HTTP ${n2.status}`)
  touched.add(`nonce:addr:testnet:${other}`)
  fill(nonceIpKey)
  const n3 = await call('auth-nonce', { body: { address: freshAddress(), network: 'testnet' } })
  log('auth-nonce: an IP over its limit gets 429 for any address', n3.status === 429, `HTTP ${n3.status}`)
  sql(`delete from public.rate_limits where key = ${lit(nonceIpKey)};`)

  const fn = sql(`select has_function_privilege('anon', 'public.hit_rate_limit(text, integer, integer)', 'execute')::text || ',' || has_table_privilege('anon', 'public.rate_limits', 'select')::text;`)
  log('anon can neither call hit_rate_limit() nor read rate_limits', fn === 'false,false', fn)
}
finally {
  for (const k of sql(`select key from public.rate_limits where key like 'rpc:ip:%' or key like 'nonce:ip:%';`).split('\n').filter(Boolean)) touched.add(k)
  cleanup()
}

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
