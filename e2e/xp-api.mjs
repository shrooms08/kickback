// Season XP against the LOCAL stack only (it writes test rows straight into the local database
// through `docker exec … psql`): daily stake XP once a day however often the season is read,
// runs and shares capped at 2 per UTC day, a run only after a kickback, quests once a week,
// tiers and tier skins, xp-cron refuses calls without the cron secret, and with it snapshots only
// wallets with a plan or an active stake, going on from a cursor kept in the database.
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
// Audit 16: the secret is compared as SHA-256 digests (fixed length, no early exit on the secret's bytes).
log('cron_secret_ok() compares digests, not the secret itself', /digest\(/.test(sql(`select pg_get_functiondef('public.cron_secret_ok(text)'::regprocedure);`)))

// Runs: a plan, 3 kickbacks today, 3 verified runs (each after a kickback, sends + restakes), and
// 1 extra run with no kickback before it. Expect 2 counted runs (+400), 2 shares (+200), quests run3 and add done (+600).
const day0 = Date.now() - 3 * 3600e3
const iso = ms => new Date(ms).toISOString()
const cid = 'c1'
let q = `insert into public.contacts (id, address, network, name, contact_address) values ('${cid}', '${a.address}', 'testnet', 'Ada', 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8') on conflict do nothing;
insert into public.plans (address, network, slices, plan_started_at, first_seen_at) values ('${a.address}', 'testnet', '[{"type":"send","percent":50,"contact_id":"${cid}"},{"type":"restake","percent":50,"contact_id":null}]', '${iso(day0 - 3600e3)}', '${iso(day0 - 3600e3)}') on conflict (address, network) do update set plan_started_at = excluded.plan_started_at;\n`
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

// M2: a verified share can't be moved to another run (relabelling the same txs would earn again).
const vs = sql(`select id, amount_luna, tx_hash from public.shares where address = '${a.address}' and verified and slice_type = 'send' limit 1;`).split('|')
const relabel = await call('sync', { token: a.token, body: { share: { id: vs[0], amount_luna: Number(vs[1]), slice_type: 'send', tx_hash: vs[2], run_id: randomUUID() } } })
log('a verified share cannot be moved to another run', relabel.status === 409, `HTTP ${relabel.status}`)
const undo = await call('sync', { token: a.token, body: { share: { id: vs[0], amount_luna: Number(vs[1]), slice_type: 'send', tx_hash: vs[2], status: 'undone' } } })
log('a verified share cannot be toggled to undone and back', undo.status === 409, `HTTP ${undo.status}`)

// Invite XP (audit 11): only once the invitee kept 10+ NIM staked on each of the 7 days after the claim.
const inv = await signIn()
sql(`insert into public.referrals (invitee, network, inviter, code, had_stake_at_claim, credited_at) values ('${inv.address}', 'testnet', '${a.address}', 'KICK-TEST', false, now());`)
unthrottle(a.address)
const s5 = await season(a.token)
log('a credited invitee without a kept stake earns the inviter nothing yet', s5.data.xp === 3200, `xp ${s5.data.xp}`)
const days = n => Array.from({ length: n }, (_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10))
sql(days(3).map(d => `insert into public.stake_snapshots (address, network, day, active_luna) values ('${inv.address}', 'testnet', '${d}', 1000000) on conflict do nothing;`).join('\n'))
unthrottle(a.address)
const s6 = await season(a.token)
log('3 days of a 10 NIM stake are not enough (7 days after the claim needed)', s6.data.xp === 3200, `xp ${s6.data.xp}`)
sql(`update public.referrals set claimed_at = now() - interval '8 days' where invitee = '${inv.address}' and network = 'testnet';
${days(9).map(d => `insert into public.stake_snapshots (address, network, day, active_luna) values ('${inv.address}', 'testnet', '${d}', 1000000) on conflict do nothing;`).join('\n')}`)
unthrottle(a.address)
const s7 = await season(a.token)
log('a 10 NIM stake kept every day for the 7 days after the claim, still there today: inviter +500', s7.data.xp === 3700, `xp ${s7.data.xp}`)
unthrottle(a.address)
log('the invite XP is awarded once', (await season(a.token)).data.xp === 3700)
// A second invitee whose stake dropped below 10 NIM on one day of that week never counts.
const inv2 = await signIn()
sql(`insert into public.referrals (invitee, network, inviter, code, had_stake_at_claim, claimed_at, credited_at) values ('${inv2.address}', 'testnet', '${a.address}', 'KICK-TEST', false, now() - interval '8 days', now());
${days(9).map((d, i) => `insert into public.stake_snapshots (address, network, day, active_luna) values ('${inv2.address}', 'testnet', '${d}', ${i === 4 ? 5 : 1000000});`).join('\n')}`)
unthrottle(a.address)
const s8 = await season(a.token)
log('an invitee whose stake dipped below 10 NIM during the week earns nothing', s8.data.xp === 3700, `xp ${s8.data.xp}`)
// Review M1: the cap of 10 invites a season holds even for parallel season reads.
const capper = await signIn()
const inviteesSql = Array.from({ length: 12 }, () => `NQ00 M1${hex(randomBytes(6)).toUpperCase()}`).map(addr => `insert into public.users (address, network) values ('${addr}', 'testnet');
insert into public.referrals (invitee, network, inviter, code, had_stake_at_claim, claimed_at, credited_at) values ('${addr}', 'testnet', '${capper.address}', 'KICK-TEST', false, now() - interval '8 days', now());
${days(9).map(d => `insert into public.stake_snapshots (address, network, day, active_luna) values ('${addr}', 'testnet', '${d}', 1000000);`).join('\n')}`).join('\n')
// The wallet's chain scan is fresh, so the reads go straight to the (database only) award step together.
sql(`${inviteesSql}
insert into public.chain_scan (address, network, scanned_at) values ('${capper.address}', 'testnet', now()) on conflict (address, network) do update set scanned_at = now();`)
await Promise.all(Array.from({ length: 8 }, () => season(capper.token)))
await season(capper.token)
const capRows = sql(`select count(*) from public.xp_ledger where address = '${capper.address}' and network = 'testnet' and source = 'invite';`)
log('parallel season reads with 12 eligible invitees award exactly 10 invites', capRows === '10', `${capRows} invite rows`)
log('invite rows hold a slot (invite#1..10) and the invitee as proof', sql(`select count(*) from public.xp_ledger where source = 'invite' and (ref !~ '^invite#' or proof is null);`) === '0')
const slotOut = execFileSync('docker', ['exec', '-i', 'supabase_db_kickback', 'psql', '-U', 'postgres', '-d', 'postgres', '-q'], { input: `do $$ begin
  begin insert into public.xp_ledger (address, network, season, source, ref, proof, amount) values ('${capper.address}', 'testnet', 1, 'invite', 'invite#11', 'NQ00 EXTRA', 500); raise notice 'SLOT_ACCEPTED';
  exception when check_violation then raise notice 'SLOT_REFUSED'; end;
end $$;`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
log('ledger: an 11th invite slot is refused by the database', !slotOut.includes('ACCEPTED'))

// "Never staked before" also looks at what the server already saw (a past stake snapshot).
const old = await signIn()
sql(`insert into public.stake_snapshots (address, network, day, active_luna) values ('${old.address}', 'testnet', '${days(11)[10]}', 500000);`)
const oldClaim = await call('season', { token: old.token, body: { ref: s0.data.code } })
log('a wallet that staked before (unstaked now) claims a code: it does not count', oldClaim.status === 200 && oldClaim.data.counts === false, JSON.stringify(oldClaim.data))

// L2: a run's size counts only verified NIM (a made-up keep amount doesn't lift a 1 Luna run over the minimum).
const b2 = await signIn()
const kb = Date.now() - 2 * 3600e3
sql(`insert into public.contacts (id, address, network, name, contact_address) values ('c1', '${b2.address}', 'testnet', 'Ada', 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8');
insert into public.plans (address, network, slices, plan_started_at, first_seen_at) values ('${b2.address}', 'testnet', '[{"type":"send","percent":1,"contact_id":"c1"},{"type":"keep","percent":99,"contact_id":null}]', now() - interval '1 day', now() - interval '1 day');
insert into public.kickbacks_seen (address, network, hash, at, luna, from_address) values ('${b2.address}', 'testnet', '${hex(randomBytes(32))}', '${new Date(kb).toISOString()}', 300000, 'NQ00 POOL');
insert into public.shares (id, address, network, amount_luna, slice_type, tx_hash, status, run_id, verified, block_at) values ('${randomUUID()}', '${b2.address}', 'testnet', 1, 'send', '${hex(randomBytes(32))}', 'confirmed', '${randomUUID()}', true, '${new Date(kb + 600e3).toISOString()}');
insert into public.shares (id, address, network, amount_luna, slice_type, tx_hash, status, run_id) select '${randomUUID()}', '${b2.address}', 'testnet', 900000000, 'keep', null, 'confirmed', run_id from public.shares where address = '${b2.address}' limit 1;`)
const b2s = await season(b2.token)
const b2l = sql(`select string_agg(source, ',') from public.xp_ledger where address = '${b2.address}';`)
log('a 1 Luna run with a huge made-up keep share earns no run XP', !(b2l || '').includes('run'), `ledger ${b2l} xp ${b2s.data.xp}`)

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

// Review L4: when a share's tx, amount or type changes it counts as reported now (reported_at), and
// a run only earns when its tx's block time is within 24 hours of that report.
const rp = await signIn()
const rpShare = randomUUID()
sql(`insert into public.shares (id, address, network, amount_luna, slice_type, tx_hash, status) values ('${rpShare}', '${rp.address}', 'testnet', 100000, 'keep', null, 'confirmed');
update public.shares set created_at = now() - interval '30 days', reported_at = now() - interval '30 days' where id = '${rpShare}';
update public.shares set slice_type = 'restake', tx_hash = '${hex(randomBytes(32))}' where id = '${rpShare}';`)
log('changing a share\'s type and tx sets reported_at to now (created_at stays)', sql(`select (reported_at > now() - interval '1 minute' and created_at < now() - interval '29 days')::text from public.shares where id = '${rpShare}';`) === 'true')
const rk = Date.now() - 2 * 3600e3
sql(`insert into public.contacts (id, address, network, name, contact_address) values ('c1', '${rp.address}', 'testnet', 'Ada', 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8');
insert into public.plans (address, network, slices, plan_started_at, first_seen_at) values ('${rp.address}', 'testnet', '[{"type":"send","percent":100,"contact_id":"c1"}]', now() - interval '5 days', now() - interval '5 days');
insert into public.kickbacks_seen (address, network, hash, at, luna, from_address) values ('${rp.address}', 'testnet', '${hex(randomBytes(32))}', '${new Date(rk).toISOString()}', 300000, 'NQ00 POOL');
insert into public.shares (id, address, network, amount_luna, slice_type, tx_hash, status, run_id, verified, block_at, created_at, reported_at) values ('${randomUUID()}', '${rp.address}', 'testnet', 300000, 'send', '${hex(randomBytes(32))}', 'confirmed', '${randomUUID()}', true, '${new Date(rk + 600e3).toISOString()}', now() - interval '3 days', now() - interval '3 days');`)
await season(rp.token)
const rpl = sql(`select coalesce(string_agg(source, ','), '') from public.xp_ledger where address = '${rp.address}' and source in ('run', 'share');`)
log('a share reported 3 days before its tx\'s block earns no run or share XP', rpl === '', `ledger ${rpl}`)

// Audit 8: the season returns this wallet's kickbacks since its plan started (newest first), so the
// app can keep ones older than its own 30-day window.
const kw = await signIn()
const k1 = hex(randomBytes(32)), k2 = hex(randomBytes(32)), kOld = hex(randomBytes(32))
const kNoPlan = await season(kw.token)
log('no plan: no kickbacks returned', Array.isArray(kNoPlan.data.kickbacks) && kNoPlan.data.kickbacks.length === 0, JSON.stringify(kNoPlan.data.kickbacks))
sql(`insert into public.plans (address, network, slices, plan_started_at) values ('${kw.address}', 'testnet', '[{"type":"keep","percent":100,"contact_id":null}]', now() - interval '40 days');
insert into public.kickbacks_seen (address, network, hash, at, luna, from_address) values
  ('${kw.address}', 'testnet', '${k1}', now() - interval '35 days', 300000, 'NQ00 POOL'),
  ('${kw.address}', 'testnet', '${k2}', now() - interval '1 day', 120000, 'NQ00 POOL'),
  ('${kw.address}', 'testnet', '${kOld}', now() - interval '41 days', 50000, 'NQ00 POOL');`)
unthrottle(kw.address)
const kRes = (await season(kw.token)).data.kickbacks
log('kickbacks since the plan started come back newest first, older than 30 days included', JSON.stringify(kRes?.map(k => k.hash)) === JSON.stringify([k2, k1]) && kRes[0].luna === 120000 && typeof kRes[0].at === 'number' && Math.abs(kRes[1].at - (Date.now() - 35 * 864e5)) < 600e3, JSON.stringify(kRes))
log('a kickback from before the plan started is left out', !kRes?.some(k => k.hash === kOld))

// xp-cron (audit 10): only wallets with a plan or an active stake, from a persistent cursor.
// Every other local testnet wallet gets today's snapshot first, so the run only looks at these four.
const withPlan = await signIn(), withStake = await signIn(), idle = await signIn(), invitee = await signIn()
const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
sql(`insert into public.plans (address, network, slices) values ('${withPlan.address}', 'testnet', '[{"type":"keep","percent":100,"contact_id":null}]');
insert into public.stake_snapshots (address, network, day, active_luna) values ('${withStake.address}', 'testnet', '${yesterday}', 500000);
insert into public.referrals (invitee, network, inviter, code, had_stake_at_claim) values ('${invitee.address}', 'testnet', '${a.address}', 'KICK-TEST', false);
insert into public.stake_snapshots (address, network, day, active_luna) select address, network, '${today}', 0 from public.users where network = 'testnet' and address not in ('${withPlan.address}', '${withStake.address}', '${idle.address}', '${invitee.address}') on conflict do nothing;
insert into public.cron_cursors (name, cursor) values ('xp-testnet', 'NQ99 ZZZZ') on conflict (name) do update set cursor = excluded.cursor;`)
const cronSecret = sql(`select decrypted_secret from vault.decrypted_secrets where name = 'kickback_cron_secret';`)
const cron = await call('xp-cron?network=testnet', { headers: { 'x-cron-secret': cronSecret } })
const snapped = sql(`select string_agg(address, ',') from public.stake_snapshots where network = 'testnet' and day = '${today}' and address in ('${withPlan.address}', '${withStake.address}', '${idle.address}', '${invitee.address}');`)
log('xp-cron snapshots a wallet with a plan and one with an active stake', cron.status === 200 && snapped.includes(withPlan.address) && snapped.includes(withStake.address), `HTTP ${cron.status} ${JSON.stringify(cron.data)}`)
log('xp-cron skips a wallet with neither (no RPC spent on it)', !snapped.includes(idle.address))
log('xp-cron also snapshots a new invitee (its 7-day invite week needs daily snapshots)', snapped.includes(invitee.address))
log('xp-cron wraps its cursor at the end of the list and stores it', sql(`select cursor from public.cron_cursors where name = 'xp-testnet';`) === '')
const again = await call('xp-cron?network=testnet', { headers: { 'x-cron-secret': cronSecret } })
log('a second run the same day has nothing left to do', again.status === 200 && again.data.done === 0 && again.data.failed === 0, JSON.stringify(again.data))

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
