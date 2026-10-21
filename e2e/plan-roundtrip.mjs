// Plan round trip through Supabase (testnet, real signatures from a generated key).
// Reproduces the on-device bug: contacts exist but no recipient was saved yet (app restarted
// after adding a contact), the editor shows the first contact, the user saves send 10 /
// restake 30 / keep 60. The plan must reach the database exactly, and come back exactly after
// Sign out + Sign in, and after clearing localStorage.
// Usage: node e2e/plan-roundtrip.mjs [baseUrl]   (default http://localhost:5173/)
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519.js'
import { blake2b } from '@noble/hashes/blake2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { createNimiqVerifier, signedMessageData } from '../supabase/functions/_shared/nimiqSignature.ts'
import { setup, sleep } from './lib.mjs'

const BASE = process.argv[2] || 'http://localhost:5173/'
const FN = 'https://dhjcilstkumeglweddev.supabase.co/functions/v1'
const hex = b => Buffer.from(b).toString('hex')
const priv = randomBytes(32), pub = ed25519.getPublicKey(priv)
const verifier = createNimiqVerifier({ sha256: d => sha256(d), blake2b256: d => blake2b(d, { dkLen: 32 }), ed25519Verify: (s, m, p) => ed25519.verify(s, m, p) })
const ADDRESS = verifier.addressOf(pub)
console.log('wallet', ADDRESS, '(generated key)')

const t = await setup(BASE, {
  address: ADDRESS,
  balanceLuna: 5_000_000,
  signer: m => ({ publicKey: hex(pub), signature: hex(ed25519.sign(sha256(signedMessageData(m)), priv)) }),
})
const { page, log, waitHash, state, tapText, openDiagnostics, closeSheet } = t
async function waitFor(fn, ms = 30000) { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(400) } return v }
const session = () => state(s => ({ status: s.session.status, queue: s.session.queue.length, lastSyncAt: s.session.lastSyncAt, planError: s.session.planError ?? '' }))
const localPlan = () => state(s => ({ saved: s.plan.saved, rec: s.plan.savedRecipient, contacts: s.plan.contacts.map(c => c.id) }))
async function connect() {
  await page.goto(BASE + '?net=test')
  await waitHash('#/welcome'); await sleep(800)
  await tapText('Connect wallet')
  await waitHash('#/start')
}
async function serverPlan() {
  const token = await page.evaluate(() => { const e = Object.entries(localStorage).find(([k]) => k.startsWith('kb:t:session:')); return e ? JSON.parse(e[1]).token : null })
  const r = await fetch(`${FN}/sync`, { headers: { authorization: `Bearer ${token}` } })
  return (await r.json()).plan
}
/** The row as stored, read with the database password when it is on this machine. */
function dbRow() {
  const pass = `${homedir()}/.kickback-supabase-db.pass`
  if (!existsSync(pass)) return null
  const out = execFileSync('supabase', ['db', 'query', '--linked', `select slices, plan_started_at from public.plans where network = 'testnet' and address = '${ADDRESS}'`], { env: { ...process.env, SUPABASE_DB_PASSWORD: readFileSync(pass, 'utf8').trim() }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const rows = JSON.parse(out.slice(out.indexOf('{'))).rows
  return rows[0] ?? 'no row'
}
const EXPECT = (cid) => [{ type: 'send', percent: 10, contact_id: cid }, { type: 'restake', percent: 30, contact_id: null }, { type: 'keep', percent: 60, contact_id: null }]

// 1. Sign in, add a contact, restart the app before ever saving a plan with it.
await connect()
log('signed in', (await waitFor(async () => (await session()).status === 'signed')) === true)
await page.locator('nav button', { hasText: 'Plan' }).tap()
await waitHash('#/plan'); await sleep(500)
await page.locator('[data-kb-layer="plan"] .bubble').first().tap()
await page.locator('.sheet input').first().waitFor()
await page.locator('.sheet input').nth(0).fill('Minos')
await page.locator('.sheet input').nth(1).fill('NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8')
await tapText('Add contact', '.sheet')
await sleep(1500)
await connect() // reload: same localStorage, same session
await waitFor(async () => (await session()).status === 'signed')
const cid = (await localPlan()).contacts[0]

// 2. The editor shows Minos as the recipient; save send 10 / restake 30 / keep 60.
await page.locator('nav button', { hasText: 'Plan' }).tap()
await waitHash('#/plan'); await sleep(500)
const shown = await page.locator('[data-kb-layer="plan"] .sending').innerText().catch(() => '')
await page.evaluate(() => { document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value.plan.pct = [10, 30, 60] })
await sleep(200)
await tapText('Save plan', '[data-kb-layer="plan"]')
const saved = await localPlan()
log('saved locally: send 10 to Minos / restake 30 / keep 60', JSON.stringify(saved.saved) === '[10,30,60]' && saved.rec === cid, `shown "${shown}" ${JSON.stringify(saved)}`)
await waitFor(async () => { const s = await session(); return s.queue === 0 && s.lastSyncAt > 0 }, 15000)
await sleep(1500)
const sp = await serverPlan()
log('the server stores exactly that plan (send keeps its contact)', JSON.stringify(sp?.slices) === JSON.stringify(EXPECT(cid)), JSON.stringify(sp?.slices))
const row = dbRow()
// jsonb stores keys in its own order: compare field by field.
const canon = sl => JSON.stringify((sl || []).map(x => ({ type: x.type, percent: x.percent, contact_id: x.contact_id })))
if (row) log('database row: slices exactly as saved', row !== 'no row' && canon(row.slices) === canon(EXPECT(cid)), JSON.stringify(row))

// 3. Sign out (local plan untouched), sign in again: identical.
await openDiagnostics()
await tapText('Sign out', '.sheet')
await sleep(500)
const afterOut = await localPlan()
log('Sign out does not change the local plan', JSON.stringify(afterOut) === JSON.stringify(saved), JSON.stringify(afterOut))
await tapText('Sign in', '.sheet')
await waitFor(async () => { const s = await session(); return s.status === 'signed' && s.queue === 0 })
await sleep(1500)
await closeSheet()
const afterIn = await localPlan()
log('after Sign out + Sign in the plan is identical', JSON.stringify(afterIn) === JSON.stringify(saved), JSON.stringify(afterIn))

// 4. Clear localStorage, reload, sign in: identical, from the server.
await page.evaluate(() => localStorage.clear())
await connect()
await waitFor(async () => (await session()).status === 'signed')
const back = await waitFor(async () => { const p = await localPlan(); return p.contacts.length ? p : null }, 15000)
log('after clearing localStorage the plan comes back identical', JSON.stringify(back) === JSON.stringify(saved), JSON.stringify(back))
const sp2 = await serverPlan()
log('server row unchanged by the round trips', JSON.stringify(sp2?.slices) === JSON.stringify(EXPECT(cid)), JSON.stringify(sp2?.slices))

// 5. The server holds a broken plan (what the old bug stored) while this phone has a good one:
// signing in keeps the phone's plan and re-sends it instead of applying the broken copy.
const token = await page.evaluate(() => { const e = Object.entries(localStorage).find(([k]) => k.startsWith('kb:t:session:')); return e ? JSON.parse(e[1]).token : null })
const broken = [{ type: 'send', percent: 0, contact_id: null }, { type: 'restake', percent: 30, contact_id: null }, { type: 'keep', percent: 70, contact_id: null }]
const put = await fetch(`${FN}/sync`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ plan: { slices: broken, plan_started_at: new Date().toISOString() } }) })
log('(setup) server now holds send 0 / restake 30 / keep 70', put.status === 200)
await openDiagnostics()
await tapText('Sign out', '.sheet'); await sleep(400)
await tapText('Sign in', '.sheet')
await waitFor(async () => { const s = await session(); return s.status === 'signed' && s.queue === 0 })
await sleep(1500)
await closeSheet()
log('sign-in keeps the good local plan over the broken server copy', JSON.stringify(await localPlan()) === JSON.stringify(saved), JSON.stringify(await localPlan()))
const repaired = await waitFor(async () => { const p = await serverPlan(); return JSON.stringify(p?.slices) === JSON.stringify(EXPECT(cid)) ? p : null }, 10000)
log('and re-uploads it: the server row is correct again', !!repaired, JSON.stringify((await serverPlan())?.slices))

// 6. An invalid local plan is never sent or repaired: banner with Retry, error in Diagnostics.
await page.evaluate(() => { const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value.plan; p.savedRecipient = 'c-not-saved' })
await sleep(1500)
await page.locator('nav button', { hasText: 'Plan' }).tap(); await waitHash('#/plan'); await sleep(500)
const banner = await page.locator('.banner').innerText().catch(() => '')
log('banner: "Couldn\'t back up your plan. It\'s still saved on this phone." with Retry', banner.includes('Couldn\'t back up your plan. It\'s still saved on this phone.') && banner.includes('Retry'), JSON.stringify(banner))
log('the server keeps the last good plan', JSON.stringify((await serverPlan())?.slices) === JSON.stringify(EXPECT(cid)))
await openDiagnostics()
const diag = await page.locator('.sheet .lines').innerText()
log('Diagnostics logs the reason', /PLAN BACKUP\s+FAILED/i.test(diag) && diag.includes('points at a contact that is not saved'))
await closeSheet()
await page.evaluate(id => { const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value.plan; p.savedRecipient = id }, cid)
await page.locator('.banner button', { hasText: 'Retry' }).tap()
const cleared = await waitFor(async () => !(await page.locator('.banner').count()) && (await session()).planError === '', 10000)
log('Retry after fixing it backs the plan up and clears the banner', !!cleared)

await t.finish()
