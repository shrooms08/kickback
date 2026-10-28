// Season XP against the LOCAL stack only (it writes test rows straight into the local database
// through `docker exec … psql`): daily stake XP once a day however often the season is read,
// runs and shares capped at 2 per UTC day, a run only after a kickback, quests once a week,
// tiers and tier skins, xp-cron refuses calls without the cron secret.
// Usage: node e2e/xp-api.mjs   (needs `supabase start` + `supabase functions serve`)
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519.js'
import { blake2b } from '@noble/hashes/blake2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { createNimiqVerifier, signedMessageData } from '../supabase/functions/_shared/nimiqSignature.ts'
import { signInMessage } from '../supabase/functions/_shared/signin.ts'

const FN = 'http://127.0.0.1:54321/functions/v1'
const results = []
const log = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }
const hex = b => Buffer.from(b).toString('hex')
const v = createNimiqVerifier({ sha256: d => sha256(d), blake2b256: d => blake2b(d, { dkLen: 32 }), ed25519Verify: (s, m, p) => ed25519.verify(s, m, p) })
const network = 'testnet'
const sql = q => execFileSync('docker', ['exec', '-i', 'supabase_db_kickback', 'psql', '-U', 'postgres', '-d', 'postgres', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { input: q, encoding: 'utf8' }).trim()
async function call(fn, { method = 'POST', body, token, headers = {} } = {}) {
  const r = await fetch(`${FN}/${fn}`, { method, headers: { 'content-type': 'application/json', ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
async function signIn() {
  const priv = randomBytes(32), pub = ed25519.getPublicKey(priv), address = v.addressOf(pub)
  const n = (await call('auth-nonce', { body: { address, network } })).data
  const msg = signInMessage({ address, network, nonce: n.nonce, issuedAt: n.issuedAt })
  const r = await call('auth-verify', { body: { address, network, nonce: n.nonce, publicKey: hex(pub), signature: hex(ed25519.sign(sha256(signedMessageData(msg)), priv)) } })
  return { address, token: r.data.token }
}
const season = t => call('season', { method: 'GET', token: t })
// The season function reads the chain at most once a minute per wallet; clear that so each read awards.
const unthrottle = a => sql(`update public.chain_scan set scanned_at = now() - interval '2 minutes' where address = '${a}' and network = 'testnet';`)

const a = await signIn()
const s0 = await season(a.token)
log('a new wallet: 0 XP, Spark I, Season 1', s0.status === 200 && s0.data.xp === 0 && s0.data.tier?.name === 'Spark' && s0.data.tier?.roman === 'I' && s0.data.season?.id === 1, JSON.stringify({ xp: s0.data.xp, tier: s0.data.tier?.name, season: s0.data.season }))
log('three weekly quests at 0', s0.data.quests?.length === 3 && s0.data.quests.every(q => q.p === 0 && !q.done), JSON.stringify(s0.data.quests))
log('six tiers with thresholds', JSON.stringify(s0.data.tiers?.map(t => t.at)) === '[0,1000,3000,8000,20000,50000]')

// Daily stake: today's snapshot says 1,600 NIM active (cap) -> 2,000 XP, once.
const today = new Date().toISOString().slice(0, 10)
sql(`delete from public.stake_snapshots where address = '${a.address}' and network = 'testnet'; insert into public.stake_snapshots (address, network, day, active_luna) values ('${a.address}', 'testnet', '${today}', 160000000);`)
unthrottle(a.address)
const s1 = await season(a.token)
log('1,600 NIM staked today: +2,000 XP (capped)', s1.data.xp === 2000, `xp ${s1.data.xp}`)
unthrottle(a.address)
await season(a.token); unthrottle(a.address)
const s2 = await season(a.token)
log('reading the season again the same day adds nothing', s2.data.xp === 2000, `xp ${s2.data.xp}`)
log('xp-cron without the secret is refused', (await call('xp-cron?network=testnet', {})).status === 403)
log('xp-cron with a wrong secret is refused', (await call('xp-cron?network=testnet', { headers: { 'x-cron-secret': 'nope' } })).status === 403)

// Runs: a plan, 3 kickbacks today, 3 verified runs (each after a kickback, sends + restakes), and
// 1 extra run with no kickback before it. Expect 2 counted runs (+400), 2 shares (+200), quests run3 and add done (+600).
const day0 = Date.now() - 3 * 3600e3
const iso = ms => new Date(ms).toISOString()
const cid = 'c1'
let q = `insert into public.contacts (id, address, network, name, contact_address) values ('${cid}', '${a.address}', 'testnet', 'Ada', 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8') on conflict do nothing;
insert into public.plans (address, network, slices, plan_started_at) values ('${a.address}', 'testnet', '[{"type":"send","percent":50,"contact_id":"${cid}"},{"type":"restake","percent":50,"contact_id":null}]', '${iso(day0 - 3600e3)}') on conflict (address, network) do update set plan_started_at = excluded.plan_started_at;\n`
for (let i = 0; i < 3; i++) {
  const k = day0 + i * 40 * 60e3, r = k + 10 * 60e3, run = randomUUID()
  q += `insert into public.kickbacks_seen (address, network, hash, at, luna, from_address) values ('${a.address}', 'testnet', '${hex(randomBytes(32))}', '${iso(k)}', 300000, 'NQ00 POOL');
insert into public.shares (id, address, network, amount_luna, slice_type, tx_hash, status, run_id, verified, block_at) values ('${randomUUID()}', '${a.address}', 'testnet', 150000, 'send', '${hex(randomBytes(32))}', 'confirmed', '${run}', true, '${iso(r)}'), ('${randomUUID()}', '${a.address}', 'testnet', 150000, 'restake', '${hex(randomBytes(32))}', 'confirmed', '${run}', true, '${iso(r + 1000)}');\n`
}
q += `insert into public.shares (id, address, network, amount_luna, slice_type, tx_hash, status, run_id, verified, block_at) values ('${randomUUID()}', '${a.address}', 'testnet', 150000, 'send', '${hex(randomBytes(32))}', 'confirmed', '${randomUUID()}', true, '${iso(day0 + 2 * 40 * 60e3 + 20 * 60e3)}');`
sql(q)
unthrottle(a.address)
const s3 = await season(a.token)
const ledger = sql(`select source || ':' || ref from public.xp_ledger where address = '${a.address}' and network = 'testnet' order by id;`).split('\n')
const runRows = ledger.filter(l => l.startsWith('run:')), shareRows = ledger.filter(l => l.startsWith('share:'))
log('runs: at most 2 counted per UTC day (+200 each)', runRows.length === 2, ledger.join(' '))
log('shares with a send: at most 2 per UTC day (+100 each)', shareRows.length === 2)
log('quest "Run your plan 3 times" done once (+300)', ledger.filter(l => l.startsWith('quest:run3')).length === 1 && s3.data.quests?.find(x => x.key === 'run3')?.done === true)
log('quest "Add someone to your plan" done (contact saved and used this week, +300)', ledger.filter(l => l.startsWith('quest:add')).length === 1)
log('total = 2,000 + 400 + 200 + 300 + 300 = 3,200 XP: Bounce I', s3.data.xp === 3200 && s3.data.tier?.name === 'Bounce' && s3.data.tier?.roman === 'I', `xp ${s3.data.xp} ${s3.data.tier?.name} ${s3.data.tier?.roman}`)
log('reaching Bounce unlocks the Kick and Bounce skins (not Rally)', s3.data.unlocked?.includes('kick') && s3.data.unlocked?.includes('bounce') && !s3.data.unlocked?.includes('rally'), JSON.stringify(s3.data.unlocked))
unthrottle(a.address)
const s4 = await season(a.token)
log('reading again awards nothing twice', s4.data.xp === 3200, `xp ${s4.data.xp}`)

// The ledger refuses double counting even if the code tried.
const dup = sql(`do $$ begin
  begin insert into public.xp_ledger (address, network, season, source, ref, amount) values ('${a.address}', 'testnet', 1, 'stake', '${today}', 2000); raise notice 'DUP_ACCEPTED';
  exception when unique_violation then raise notice 'DUP_REFUSED'; end;
end $$;`)
const dupOut = execFileSync('docker', ['exec', '-i', 'supabase_db_kickback', 'psql', '-U', 'postgres', '-d', 'postgres', '-q'], { input: `do $$ begin
  begin insert into public.xp_ledger (address, network, season, source, ref, amount) values ('${a.address}', 'testnet', 1, 'stake', '${today}', 2000); raise notice 'DUP_ACCEPTED';
  exception when unique_violation then raise notice 'DUP_REFUSED'; end;
end $$;`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
void dup
const proofOut = execFileSync('docker', ['exec', '-i', 'supabase_db_kickback', 'psql', '-U', 'postgres', '-d', 'postgres', '-q'], { input: `do $$ declare p text; begin
  select proof into p from public.xp_ledger where address = '${a.address}' and source = 'run' limit 1;
  begin insert into public.xp_ledger (address, network, season, source, ref, proof, amount) values ('${a.address}', 'testnet', 1, 'run', '2099-01-01#1', p, 200); raise notice 'PROOF_ACCEPTED';
  exception when unique_violation then raise notice 'PROOF_REFUSED'; end;
end $$;`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
log('ledger: a second stake row for the same day is refused', !dupOut.includes('ACCEPTED'))
log('ledger: the same run can never earn twice (proof unique)', !proofOut.includes('ACCEPTED'))

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
