// Sign in with the wallet and sync through Supabase (testnet, dev build with .env.local).
// The fake Nimiq Pay signs with a freshly generated Ed25519 key, exactly like the host does, so
// auth-verify checks a real signature. Then: save a plan, wipe localStorage, reload, sign in
// again, and the plan must come back from the server. Last, a rejected signature leaves the app
// local-only with the "Sign in to back up your plan" banner.
// Usage: node e2e/signin-sync.mjs [baseUrl]   (default http://localhost:5173/)
import { randomBytes } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519.js'
import { blake2b } from '@noble/hashes/blake2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { createNimiqVerifier, signedMessageData } from '../supabase/functions/_shared/nimiqSignature.ts'
import { savePlanWithContact, setup, sleep } from './lib.mjs'

const BASE = process.argv[2] || 'http://localhost:5173/'
const hex = b => Buffer.from(b).toString('hex')
const priv = randomBytes(32)
const pub = ed25519.getPublicKey(priv)
const verifier = createNimiqVerifier({ sha256: d => sha256(d), blake2b256: d => blake2b(d, { dkLen: 32 }), ed25519Verify: (s, m, p) => ed25519.verify(s, m, p) })
const ADDRESS = verifier.addressOf(pub)
console.log('wallet', ADDRESS, '(generated key)')

let reject = false
const signed = []
const t = await setup(BASE, {
  address: ADDRESS,
  balanceLuna: 5_000_000,
  // What Nimiq Pay does: SHA-256 of "\x16Nimiq Signed Message:\n" + length + message, signed with Ed25519.
  signer: (message) => {
    signed.push(message)
    if (reject) return { error: { type: 'PERMISSION_DENIED', message: 'User rejected the request' } }
    return { publicKey: hex(pub), signature: hex(ed25519.sign(sha256(signedMessageData(message)), priv)) }
  },
})
const { page, log, waitHash, state, tapText, openDiagnostics, closeSheet } = t
const session = () => state(s => ({ status: s.session.status, signed: !!s.session.token, queue: s.session.queue.length, lastSyncAt: s.session.lastSyncAt, error: s.session.error }))
async function waitFor(fn, ms = 30000) { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(400) } return v }

async function connect() {
  await page.goto(BASE + '?net=test')
  await waitHash('#/welcome')
  await sleep(800)
  await tapText('Connect wallet')
  await waitHash('#/start')
}

// 1. Connect: the app asks for a nonce, the wallet signs, auth-verify returns a session.
await connect()
const s1 = await waitFor(async () => { const s = await session(); return s.status === 'signed' ? s : null })
log('sign-in after Connect wallet: real signature accepted', s1?.status === 'signed', JSON.stringify(s1 ?? await session()))
log('the wallet was asked to sign the Kickback sign-in message', signed.length === 1 && signed[0].startsWith(`Sign in to Kickback\nAddress: ${ADDRESS}\nNetwork: testnet\nNonce: `), JSON.stringify(signed[0]?.split('\n').slice(0, 3)))

// 2. Save a plan with a contact; it syncs.
await savePlanWithContact(t, [10, 55, 35])
const local = await state(s => ({ saved: s.plan.saved, rec: s.plan.savedRecipient, contacts: s.plan.contacts.map(c => [c.id, c.name, c.address]), started: s.plan.planStartedAt }))
const synced = await waitFor(async () => { const s = await session(); return s.queue === 0 && s.lastSyncAt > local.started ? s : null }, 20000)
log('plan and contact synced to Supabase (queue empty)', !!synced, JSON.stringify(await session()))
await openDiagnostics()
const diag = await page.locator('.sheet .lines').innerText()
log('Diagnostics: signed in, token expiry, last sync, queued writes, pool list source', /SIGNED IN\s+yes/i.test(diag) && /TOKEN EXPIRES/i.test(diag) && /LAST SYNC/i.test(diag) && /QUEUED WRITES\s+none/i.test(diag) && /POOL LIST SOURCE/i.test(diag))
await closeSheet()

// 3. Wipe local storage, reload, sign in again: the plan comes back from the server.
await page.evaluate(() => localStorage.clear())
await connect()
const s2 = await waitFor(async () => { const s = await session(); return s.status === 'signed' && s.lastSyncAt ? s : null })
log('after clearing localStorage: signed in again with a new nonce', s2?.status === 'signed' && signed.length === 2 && signed[1] !== signed[0], JSON.stringify(s2 ?? await session()))
const back = await waitFor(async () => { const p = await state(s => ({ saved: s.plan.saved, rec: s.plan.savedRecipient, contacts: s.plan.contacts.map(c => [c.id, c.name, c.address]), started: s.plan.planStartedAt })); return p.contacts.length ? p : null }, 15000)
log('the plan came back from Supabase (split, contact, recipient, start time)', JSON.stringify(back?.saved) === '[10,55,35]' && JSON.stringify(back?.contacts) === JSON.stringify(local.contacts) && back?.rec === local.rec && Math.abs((back?.started ?? 0) - local.started) < 1000,
  `local ${JSON.stringify(local)} server ${JSON.stringify(back)}`)

// 4. Rejecting the signature: local-only, banner on the Plan tab, nothing blocked.
await openDiagnostics()
await tapText('Sign out', '.sheet')
await sleep(300)
await closeSheet()
await page.evaluate(() => localStorage.clear())
reject = true
await connect()
const s3 = await waitFor(async () => { const s = await session(); return s.status === 'declined' ? s : null })
log('rejecting the signature: app keeps working, local only', s3?.status === 'declined' && (await page.locator('[data-kb-layer="homeEmpty"]').isVisible()), JSON.stringify(s3 ?? await session()))
await page.locator('nav button', { hasText: 'Plan' }).tap()
await waitHash('#/plan'); await sleep(500)
log('Plan tab shows "Sign in to back up your plan"', (await page.locator('[data-kb="signin-banner"]').innerText()).includes('Sign in to back up your plan'))
reject = false
await page.locator('[data-kb="signin-banner"] button').tap()
const s4 = await waitFor(async () => { const s = await session(); return s.status === 'signed' ? s : null })
const restored = await waitFor(async () => JSON.stringify(await state(s => s.plan.saved)) === '[10,55,35]', 10000)
log('the banner\'s Sign in button signs in and restores the plan', s4?.status === 'signed' && restored && !(await page.locator('[data-kb="signin-banner"]').count()),
  `${JSON.stringify(s4 ?? await session())} saved=${JSON.stringify(await state(s => s.plan.saved))} banner=${await page.locator('[data-kb="signin-banner"]').count()} signs=${signed.length}`)

// 5. The pool list comes from Supabase pool_stats (both networks) instead of the phone's own RPC reads.
const tnSource = await waitFor(async () => (await state(s => s.live.poolSource)) || null, 20000)
log('testnet pool list read from Supabase pool_stats', tnSource === 'supabase', String(tnSource))
await page.goto(BASE)
await waitHash('#/welcome'); await sleep(800); await tapText('Connect wallet'); await waitHash('#/start')
const mnSource = await waitFor(async () => (await state(s => s.live.poolSource)) || null, 20000)
const mnPools = (await waitFor(async () => { const n = await state(s => s.data.livePools.map(p => p.name)); return n.length ? n : null }, 20000)) || []
log('mainnet pool list read from Supabase pool_stats', mnSource === 'supabase' && mnPools.length > 0, `${mnSource}: ${mnPools.join(', ')}`)

await t.finish()
