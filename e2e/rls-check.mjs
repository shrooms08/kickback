// RLS check: with only the public anon key, private tables can't be read and nothing can be
// written; pool_stats is readable. Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env.local.
// Usage: node e2e/rls-check.mjs
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
const results = []
const log = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }
async function rest(method, path, body) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  let data; try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data }
}
const short = d => JSON.stringify(d).slice(0, 110)

for (const t of ['plans', 'contacts', 'shares', 'users', 'events', 'auth_nonces', 'pool_probes']) {
  const r = await rest('GET', `${t}?select=*&limit=5`)
  log(`anon cannot read ${t}`, r.status >= 400 || (Array.isArray(r.data) && r.data.length === 0), `HTTP ${r.status} ${short(r.data)}`)
}
const pools = await rest('GET', 'pool_stats?select=network,name&limit=50')
log('anon can read pool_stats (public)', pools.status === 200 && Array.isArray(pools.data) && pools.data.length > 0, `HTTP ${pools.status}, ${pools.data.length} rows`)

const addr = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const writes = [
  ['insert a user', 'POST', 'users', { address: addr, network: 'mainnet' }],
  ['insert a plan', 'POST', 'plans', { address: addr, network: 'mainnet', slices: [] }],
  ['insert a contact', 'POST', 'contacts', { id: 'x', address: addr, network: 'mainnet', name: 'x', contact_address: addr }],
  ['insert a share', 'POST', 'shares', { id: '0b6f1c1e-2f6a-4b7e-9a3c-5d2e1f0a9b8c', address: addr, network: 'mainnet', amount_luna: 1, slice_type: 'keep' }],
  ['insert an event', 'POST', 'events', { network: 'mainnet', kind: 'connect' }],
  ['insert pool stats', 'POST', 'pool_stats', { network: 'mainnet', validator_address: addr }],
  ['update pool stats', 'PATCH', 'pool_stats?network=eq.mainnet', { name: 'hacked' }],
  ['delete pool stats', 'DELETE', 'pool_stats?network=eq.mainnet', null],
  ['update another user\'s plan', 'PATCH', 'plans?network=eq.testnet', { slices: [] }],
]
for (const [name, method, path, body] of writes) {
  const r = await rest(method, path, body)
  log(`anon cannot ${name}`, r.status >= 400 || (Array.isArray(r.data) && r.data.length === 0), `HTTP ${r.status} ${short(r.data)}`)
}
for (const fn of ['kickback_stats', 'cron_secret_ok']) {
  const r = await rest('POST', `rpc/${fn}`, fn === 'cron_secret_ok' ? { p: 'guess' } : {})
  log(`anon cannot call ${fn}()`, r.status >= 400, `HTTP ${r.status} ${short(r.data)}`)
}
const after = await rest('GET', 'pool_stats?select=name&name=eq.hacked')
log('pool_stats unchanged after the write attempts', Array.isArray(after.data) && after.data.length === 0)

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
