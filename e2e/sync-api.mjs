// Edge Function test for sync (deployed project, testnet, a freshly generated wallet key):
// a plan whose send slice names one of the user's contacts is stored with that contact_id,
// exactly; one naming a missing contact (or none) is rejected and the stored plan is unchanged.
// Usage: node e2e/sync-api.mjs
import { randomBytes } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519.js'
import { blake2b } from '@noble/hashes/blake2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { createNimiqVerifier, signedMessageData } from '../supabase/functions/_shared/nimiqSignature.ts'
import { signInMessage } from '../supabase/functions/_shared/signin.ts'

const FN = 'https://dhjcilstkumeglweddev.supabase.co/functions/v1'
const results = []
const log = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }
const hex = b => Buffer.from(b).toString('hex')
const priv = randomBytes(32), pub = ed25519.getPublicKey(priv)
const v = createNimiqVerifier({ sha256: d => sha256(d), blake2b256: d => blake2b(d, { dkLen: 32 }), ed25519Verify: (s, m, p) => ed25519.verify(s, m, p) })
const address = v.addressOf(pub), network = 'testnet'
async function call(fn, { method = 'POST', body, token } = {}) {
  const r = await fetch(`${FN}/${fn}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json() }
}

const n = (await call('auth-nonce', { body: { address, network } })).data
const msg = signInMessage({ address, network, nonce: n.nonce, issuedAt: n.issuedAt })
const { token } = (await call('auth-verify', { body: { address, network, nonce: n.nonce, publicKey: hex(pub), signature: hex(ed25519.sign(sha256(signedMessageData(msg)), priv)) } })).data
log('signed in with a generated key', !!token)

const contact = { id: 'c1792614452339', name: 'Minos', contact_address: 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8' }
const good = [{ type: 'send', percent: 10, contact_id: contact.id }, { type: 'restake', percent: 30, contact_id: null }, { type: 'keep', percent: 60, contact_id: null }]
const started = '2026-10-21T21:47:24.000Z'
const ok = await call('sync', { method: 'PUT', token, body: { contacts: [contact], plan: { slices: good, plan_started_at: started } } })
log('plan with send to an owned contact is accepted', ok.status === 200, `HTTP ${ok.status}`)
log('stored exactly: send keeps its contact_id and 10%', JSON.stringify(ok.data.plan?.slices) === JSON.stringify(good), JSON.stringify(ok.data.plan?.slices))
const got = (await call('sync', { method: 'GET', token })).data
log('GET returns the same slices and start time', JSON.stringify(got.plan?.slices) === JSON.stringify(good) && Date.parse(got.plan?.plan_started_at) === Date.parse(started))

const missing = await call('sync', { method: 'PUT', token, body: { plan: { slices: [{ ...good[0], contact_id: 'c-not-saved' }, good[1], good[2]], plan_started_at: started } } })
log('send to a contact the user does not have is rejected', missing.status === 400 && /not saved/.test(missing.data.error), `HTTP ${missing.status} ${missing.data.error}`)
const none = await call('sync', { method: 'PUT', token, body: { plan: { slices: [{ ...good[0], contact_id: null }, good[1], good[2]], plan_started_at: started } } })
log('send 10% with no contact is rejected (not turned into send 0 / keep 70)', none.status === 400 && /needs one of your contacts/.test(none.data.error), `HTTP ${none.status} ${none.data.error}`)
const after = (await call('sync', { method: 'GET', token })).data
log('the stored plan is unchanged by the rejected saves', JSON.stringify(after.plan?.slices) === JSON.stringify(good), JSON.stringify(after.plan?.slices))

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
