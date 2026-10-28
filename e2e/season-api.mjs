// Edge Function test for season + sync verification (testnet, freshly generated wallet keys).
// Client claims never count: a share with a made-up tx hash stays unverified and unlocks nothing,
// a skin that isn't unlocked can't be applied, your own invite code and a second inviter are
// refused, and public stats only show verified, signed-in numbers.
// Usage: node e2e/season-api.mjs [functionsBaseUrl]   (default: production)
import { randomBytes, randomUUID } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519.js'
import { blake2b } from '@noble/hashes/blake2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { createNimiqVerifier, signedMessageData } from '../supabase/functions/_shared/nimiqSignature.ts'
import { signInMessage } from '../supabase/functions/_shared/signin.ts'

const FN = process.argv[2] || 'https://dhjcilstkumeglweddev.supabase.co/functions/v1'
const results = []
const log = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }
const hex = b => Buffer.from(b).toString('hex')
const v = createNimiqVerifier({ sha256: d => sha256(d), blake2b256: d => blake2b(d, { dkLen: 32 }), ed25519Verify: (s, m, p) => ed25519.verify(s, m, p) })
const network = 'testnet'
async function call(fn, { method = 'POST', body, token } = {}) {
  const r = await fetch(`${FN}/${fn}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
async function signIn() {
  const priv = randomBytes(32), pub = ed25519.getPublicKey(priv), address = v.addressOf(pub)
  const n = (await call('auth-nonce', { body: { address, network } })).data
  const msg = signInMessage({ address, network, nonce: n.nonce, issuedAt: n.issuedAt })
  const r = await call('auth-verify', { body: { address, network, nonce: n.nonce, publicKey: hex(pub), signature: hex(ed25519.sign(sha256(signedMessageData(msg)), priv)) } })
  return { address, token: r.data.token }
}

const a = await signIn()
log('wallet A signed in', !!a.token)
const s0 = await call('season', { method: 'GET', token: a.token })
log('season GET works for a new wallet', s0.status === 200, `HTTP ${s0.status} ${s0.data.error ?? ''}`)
log('A gets an invite code', /^KICK-[2-9A-HJ-NP-Z]{4}$/.test(s0.data.code ?? ''), s0.data.code)
log('nothing unlocked but Spark, no milestones', JSON.stringify(s0.data.unlocked) === '["spark"]' && s0.data.milestones?.length === 0, JSON.stringify(s0.data.unlocked))
log('streak starts at 0 with a saver', s0.data.streak?.current === 0 && s0.data.streak?.savers === 1)
log('code is stable across reads', (await call('season', { method: 'GET', token: a.token })).data.code === s0.data.code)
log('no session: 401', (await call('season', { method: 'GET' })).status === 401)

// A spoofed share: a send with a made-up tx hash.
const contact = { id: 'c1', name: 'Ada', contact_address: 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8' }
await call('sync', { method: 'PUT', token: a.token, body: { contacts: [contact] } })
const fake = await call('sync', { token: a.token, body: { share: { id: randomUUID(), amount_luna: 10_000_000, slice_type: 'send', tx_hash: hex(randomBytes(32)), run_id: randomUUID() } } })
log('a share with a made-up tx hash is stored but not verified', fake.status === 200 && fake.data.verified === false, JSON.stringify(fake.data))
const s1 = await call('season', { method: 'GET', token: a.token })
log('the spoofed share unlocks nothing (no first share, still Spark only)', s1.data.milestones?.length === 0 && JSON.stringify(s1.data.unlocked) === '["spark"]', JSON.stringify(s1.data.milestones))
const fakeStake = await call('sync', { token: a.token, body: { event: { kind: 'stake', amount_luna: 10_000_000, tx_hash: hex(randomBytes(32)) } } })
log('a stake event with a made-up tx hash is not verified', fakeStake.status === 200 && fakeStake.data.verified === false, JSON.stringify(fakeStake.data))

log('applying a locked skin is refused', (await call('season', { token: a.token, body: { skin: 'legend' } })).status === 400)
log('an unknown skin is refused', (await call('season', { token: a.token, body: { skin: 'gold' } })).status === 400)
const sp = await call('season', { token: a.token, body: { skin: 'spark' } })
log('Spark can always be applied', sp.status === 200 && sp.data.skin === 'spark')

log('claiming your own invite code is refused', (await call('season', { token: a.token, body: { ref: s0.data.code } })).status === 400)
log('a malformed code is refused', (await call('season', { token: a.token, body: { ref: 'KICK-0000' } })).status === 400)

const b = await signIn()
const claim = await call('season', { token: b.token, body: { ref: s0.data.code } })
log('wallet B (no stake) claims A\'s code: it can count', claim.status === 200 && claim.data.counts === true, JSON.stringify(claim.data))
log('a second claim by B is refused (one inviter per wallet)', (await call('season', { token: b.token, body: { ref: s0.data.code } })).status === 409)
const c = await signIn()
const cCode = (await call('season', { method: 'GET', token: c.token })).data.code
log('B cannot switch to another inviter either', (await call('season', { token: b.token, body: { ref: cCode } })).status === 409)
const s2 = await call('season', { method: 'GET', token: a.token })
log('A sees 1 joined, 0 staked (B has no stake on chain)', s2.data.invites?.claimed === 1 && s2.data.invites?.staked === 0, JSON.stringify(s2.data.invites))
log('no invite milestone without a confirmed stake', !s2.data.milestones?.some(m => m.key === 'invited_staker'))

const st = await call('stats', { method: 'GET' })
const flat = JSON.stringify(st.data)
log('public stats: no anonymous counts, verified numbers only', st.status === 200 && !flat.includes('anonymous') && flat.includes('signed_in_users') && flat.includes('runs_done'), flat.slice(0, 120))

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
