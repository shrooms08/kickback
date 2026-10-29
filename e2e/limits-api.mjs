// Persistent rate limits against the LOCAL stack only (it reads and seeds public.rate_limits
// through `docker exec … psql`): rpc-proxy per IP and its global upstream cap, auth-nonce per IP
// and per address, auth-verify per IP, sync events per IP (no session) and per wallet, season reads,
// invite claims and share reports per wallet and IP, and the shared budget for the chain reads that
// season and sync make for users (one chain scan a minute per wallet, however many reads).
// Limits are seeded as already full instead of looping up to them, so the test does not depend
// on the configured numbers and does not use up the budget other suites need. Every key the test
// touched is removed at the end.
// Usage: node e2e/limits-api.mjs   (needs `supabase start` + `supabase functions serve`)
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519.js'
import { blake2b } from '@noble/hashes/blake2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { createNimiqVerifier, signedMessageData } from '../supabase/functions/_shared/nimiqSignature.ts'
import { signInMessage } from '../supabase/functions/_shared/signin.ts'
import { freshAddress } from './lib.mjs'

const FN = 'http://127.0.0.1:54321/functions/v1'
const results = []
const log = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }
const sql = q => execFileSync('docker', ['exec', '-i', 'supabase_db_kickback', 'psql', '-U', 'postgres', '-d', 'postgres', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { input: q, encoding: 'utf8' }).trim()
async function call(fn, { method = 'POST', body, token, headers = {} } = {}) {
  const r = await fetch(`${FN}/${fn}`, { method, headers: { 'content-type': 'application/json', ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const hex = b => Buffer.from(b).toString('hex')
const v = createNimiqVerifier({ sha256: d => sha256(d), blake2b256: d => blake2b(d, { dkLen: 32 }), ed25519Verify: (s, m, p) => ed25519.verify(s, m, p) })
async function signIn(network = 'testnet') {
  const priv = randomBytes(32), pub = ed25519.getPublicKey(priv), address = v.addressOf(pub)
  const n = (await call('auth-nonce', { body: { address, network } })).data
  const msg = signInMessage({ address, network, nonce: n.nonce, issuedAt: n.issuedAt })
  const r = await call('auth-verify', { body: { address, network, nonce: n.nonce, publicKey: hex(pub), signature: hex(ed25519.sign(sha256(signedMessageData(msg)), priv)) } })
  return { address: r.data.address, token: r.data.token }
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

  // auth-nonce: per caller IP, and per address from each IP (so nobody can lock out an address).
  const addr = freshAddress(), other = freshAddress()
  const n0 = await call('auth-nonce', { body: { address: addr, network: 'testnet' } })
  const nonceIpKey = sql(`select key from public.rate_limits where key like 'nonce:ip:%' order by window_start desc limit 1;`)
  touched.add(nonceIpKey)
  log('auth-nonce counts each caller IP in Postgres', n0.status === 200 && nonceIpKey.startsWith('nonce:ip:'), nonceIpKey)
  const myIp = nonceIpKey.slice('nonce:ip:'.length)
  const addrKey = `nonce:addr:testnet:${addr}:${myIp}`
  touched.add(addrKey)
  log('auth-nonce counts each address per caller IP in Postgres', sql(`select hits from public.rate_limits where key = ${lit(addrKey)};`) === '1', addrKey)
  fill(addrKey)
  const n1 = await call('auth-nonce', { body: { address: addr, network: 'testnet' } })
  log('auth-nonce: an address over its limit from this IP gets 429', n1.status === 429, `HTTP ${n1.status}`)
  const n2 = await call('auth-nonce', { body: { address: other, network: 'testnet' } })
  log('auth-nonce: another address from the same IP still gets a nonce', n2.status === 200, `HTTP ${n2.status}`)
  touched.add(`nonce:addr:testnet:${other}:${myIp}`)
  // Review M2: someone else (another IP; locally the gateway passes cf-connecting-ip through)
  // asks for nonces for the owner's address until refused. The owner can still sign in.
  const victim = freshAddress(), attacker = '198.51.100.7'
  let refused = 0
  for (let i = 0; i < 40 && !refused; i++) if ((await call('auth-nonce', { body: { address: victim, network: 'testnet' }, headers: { 'cf-connecting-ip': attacker } })).status === 429) refused = i + 1
  touched.add(`nonce:ip:${attacker}`)
  for (const k of sql(`select key from public.rate_limits where key like ${lit(`nonce:addr:testnet:${victim}%`)};`).split('\n').filter(Boolean)) touched.add(k)
  const owner = await call('auth-nonce', { body: { address: victim, network: 'testnet' } })
  log('another IP hammering an address does not lock its owner out', refused > 0 && owner.status === 200, `attacker refused after ${refused}, owner HTTP ${owner.status}`)
  for (const k of sql(`select key from public.rate_limits where key like ${lit(`nonce:addr:testnet:${victim}%`)};`).split('\n').filter(Boolean)) touched.add(k)
  touched.add('nonce:global')
  fill('nonce:global')
  const ng = await call('auth-nonce', { body: { address: freshAddress(), network: 'testnet' } })
  log('auth-nonce: the global cap refuses new nonces when full', ng.status === 429, `HTTP ${ng.status}`)
  sql(`delete from public.rate_limits where key = 'nonce:global';`)
  fill(nonceIpKey)
  const n3 = await call('auth-nonce', { body: { address: freshAddress(), network: 'testnet' } })
  log('auth-nonce: an IP over its limit gets 429 for any address', n3.status === 429, `HTTP ${n3.status}`)
  sql(`delete from public.rate_limits where key = ${lit(nonceIpKey)};`)

  // auth-verify: per IP (a nonce is burned on each try, but every try costs a database write).
  const w = await signIn()
  const verifyIpKey = sql(`select key from public.rate_limits where key like 'verify:ip:%' order by window_start desc limit 1;`)
  touched.add(verifyIpKey)
  log('auth-verify counts each caller IP in Postgres', !!w.token && verifyIpKey.startsWith('verify:ip:'), verifyIpKey)
  fill(verifyIpKey)
  const vx = await call('auth-verify', { body: { address: freshAddress(), network: 'testnet', nonce: 'x', publicKey: '00', signature: '00' } })
  log('auth-verify: an IP over its limit gets 429', vx.status === 429, `HTTP ${vx.status}`)
  sql(`delete from public.rate_limits where key = ${lit(verifyIpKey)};`)

  // sync events: anonymous ones per IP (hard), signed-in ones per wallet.
  const e0 = await call('sync', { body: { event: { kind: 'connect' }, network: 'testnet' } })
  const anonKey = sql(`select key from public.rate_limits where key like 'events:anon:%' order by window_start desc limit 1;`)
  touched.add(anonKey)
  log('an anonymous event is counted per IP in Postgres', e0.status === 200 && anonKey.startsWith('events:anon:'), `HTTP ${e0.status} ${anonKey}`)
  fill(anonKey)
  const e1 = await call('sync', { body: { event: { kind: 'connect' }, network: 'testnet' } })
  log('anonymous events over the IP limit get 429', e1.status === 429, `HTTP ${e1.status}`)
  const e2 = await call('sync', { token: w.token, body: { event: { kind: 'connect' } } })
  log('a signed-in event is not held up by the anonymous limit', e2.status === 200, `HTTP ${e2.status}`)
  const walletKey = `events:addr:testnet:${w.address}`
  touched.add(walletKey)
  log('signed-in events are counted per wallet', sql(`select hits from public.rate_limits where key = ${lit(walletKey)};`) === '1')
  fill(walletKey)
  const e3 = await call('sync', { token: w.token, body: { event: { kind: 'connect' } } })
  log('signed-in events over the wallet limit get 429', e3.status === 429, `HTTP ${e3.status}`)

  // Review M3: season reads, invite claims and share reports are limited per wallet and per IP.
  const m = await signIn()
  const mIp = myIp
  const today = new Date().toISOString().slice(0, 10)
  const hits = key => Number(sql(`select coalesce((select hits from public.rate_limits where key = ${lit(key)}), 0);`))
  const share = () => ({ share: { id: crypto.randomUUID(), amount_luna: 100000, slice_type: 'send', tx_hash: hex(randomBytes(32)), run_id: crypto.randomUUID() } })
  const cases = [
    ['season read', `season:addr:testnet:${m.address}`, () => call('season', { method: 'GET', token: m.token })],
    ['season read', `season:ip:${mIp}`, () => call('season', { method: 'GET', token: m.token })],
    ['share report', `shares:addr:testnet:${m.address}`, () => call('sync', { token: m.token, body: share() })],
    ['share report', `shares:ip:${mIp}`, () => call('sync', { token: m.token, body: share() })],
    ['invite claim', `ref:addr:testnet:${m.address}`, () => call('season', { token: m.token, body: { ref: 'KICK-2222' } })],
    ['invite claim', `ref:ip:${mIp}`, () => call('season', { token: m.token, body: { ref: 'KICK-2222' } })],
  ]
  for (const [what, key, req] of cases) {
    touched.add(key)
    fill(key)
    const r = await req()
    log(`${what} over the ${key.split(':')[1] === 'ip' ? 'IP' : 'wallet'} limit gets 429`, r.status === 429, `HTTP ${r.status} ${key}`)
    sql(`delete from public.rate_limits where key = ${lit(key)};`)
  }

  // One chain scan a minute per wallet, claimed atomically: parallel reads don't each read the chain.
  touched.add('rpc:server')
  sql(`insert into public.stake_snapshots (address, network, day, active_luna) values ('${m.address}', 'testnet', '${today}', 0) on conflict do nothing;`)
  const unthrottle = a => sql(`update public.chain_scan set scanned_at = now() - interval '2 minutes' where address = '${a}' and network = 'testnet';`)
  unthrottle(m.address); sql(`delete from public.rate_limits where key = 'rpc:server';`)
  await call('season', { method: 'GET', token: m.token })
  const one = hits('rpc:server')
  unthrottle(m.address); sql(`delete from public.rate_limits where key = 'rpc:server';`)
  await Promise.all(Array.from({ length: 5 }, () => call('season', { method: 'GET', token: m.token })))
  const five = hits('rpc:server')
  log('season chain reads count against the shared server budget', one > 0, `${one} calls`)
  log('5 parallel season reads read the chain once', five === one, `one read ${one}, five parallel ${five}`)

  // Parallel invite claims from one wallet: one is recorded, the chain is read once.
  const code = (await call('season', { method: 'GET', token: m.token })).data.code
  const claimer = await signIn()
  sql(`delete from public.rate_limits where key = 'rpc:server';`)
  const claims = await Promise.all(Array.from({ length: 3 }, () => call('season', { token: claimer.token, body: { ref: code } })))
  const st = claims.map(c => c.status).sort().join(',')
  log('3 parallel claims: one recorded, the others refused', st === '200,409,409', st)
  log('3 parallel claims read the chain once (staker + one history page)', hits('rpc:server') === 2, `${hits('rpc:server')} calls`)

  // The shared budget used up: season answers from the stored state (chainOk false), no chain reads.
  fill('rpc:server')
  unthrottle(m.address)
  const busy = await call('season', { method: 'GET', token: m.token })
  log('server chain budget used up: season still answers, chainOk false', busy.status === 200 && busy.data.chainOk === false, `HTTP ${busy.status} chainOk ${busy.data.chainOk}`)
  sql(`delete from public.rate_limits where key = 'rpc:server';`)

  const fn = sql(`select has_function_privilege('anon', 'public.hit_rate_limit(text, integer, integer)', 'execute')::text || ',' || has_table_privilege('anon', 'public.rate_limits', 'select')::text;`)
  log('anon can neither call hit_rate_limit() nor read rate_limits', fn === 'false,false', fn)
}
finally {
  for (const k of sql(`select key from public.rate_limits where key like 'rpc:ip:%' or key like 'nonce:ip:%' or key like 'verify:ip:%' or key like 'events:anon:%' or key like 'season:ip:%' or key like 'shares:ip:%' or key like 'ref:ip:%';`).split('\n').filter(Boolean)) touched.add(k)
  cleanup()
}

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
