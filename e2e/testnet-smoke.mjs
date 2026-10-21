// Testnet smoke test (dev build, ?net=test): strip, testnet pool list, test kickback,
// and that none of it leaks into mainnet.
// Usage: node e2e/testnet-smoke.mjs [baseUrl]   (default http://localhost:5173/)
import { freshAddress, savePlanWithContact, setup, sleep } from './lib.mjs'

const BASE = process.argv[2] || 'http://localhost:5173/'
const ADDRESS = freshAddress()
console.log('wallet', ADDRESS)
// The fake Nimiq Pay reports 50 NIM, so a test kickback has real (fake-host) NIM behind it.
const t = await setup(BASE, { address: ADDRESS, balanceLuna: 5_000_000 })
const { page, log, requests, waitHash, state, tapText, openDiagnostics, closeSheet } = t
const text = async sel => ((await page.locator(sel).first().textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim()
const diagText = () => page.locator('.sheet .lines').innerText()

async function connect(url) {
  await page.goto(url)
  await waitHash('#/welcome')
  await sleep(800)
  await tapText('Connect wallet')
  await waitHash('#/start')
  await sleep(1500)
}

// ---------- testnet ----------
await connect(BASE + '?net=test')
log('testnet strip shows "Testnet: test NIM only"', (await text('[data-kb="testnet-strip"]')) === 'Testnet: test NIM only', await text('[data-kb="testnet-strip"]'))
const stripColor = await page.locator('[data-kb="testnet-strip"]').evaluate(el => getComputedStyle(el).color)
log('strip uses the third (magenta) colour', stripColor === 'rgb(198, 76, 240)', stripColor)
log('no dry-run strip on testnet (dry run is off there)', !(await page.locator('.preview.dry').count()))

await openDiagnostics()
const d1 = await diagText()
log('Diagnostics shows testnet, its RPC and API URLs', /NETWORK\s+testnet/i.test(d1) && d1.includes('https://rpc.testnet.nimiqwatch.com') && d1.includes('https://validators-api-test.je-cf9.workers.dev'))
log('test kickback control shows on testnet', await page.locator('[data-kb="test-kickback"]').isVisible())
await page.locator('.sheet input[aria-label="Test kickback in NIM"]').fill('1')
await tapText('Mark test kickback', '.sheet')
await sleep(800)
const toast1 = await text('.toast .msg')
const s1 = await state(s => ({ marked: s.plan.marked.length, ready: s.account.readyLuna }))
log('marking 1 NIM before a plan: saved, not ready yet', toast1 === 'Marked. It will be ready to share once you save a plan' && s1.marked === 1 && s1.ready === 0, `"${toast1}" ${JSON.stringify(s1)}`)
await closeSheet()

await savePlanWithContact(t)
await sleep(800)
const s2 = await state(s => ({ ready: s.account.readyLuna, started: s.plan.planStartedAt }))
log('after saving a plan the test kickback is ready to share (1 NIM)', s2.ready === 100000, JSON.stringify(s2))

await openDiagnostics()
await page.locator('.sheet input[aria-label="Test kickback in NIM"]').fill('100')
await tapText('Mark test kickback', '.sheet')
await sleep(800)
const err = await text('.sheet [data-kb="test-kickback"] .perr')
log('cannot mark more than the wallet holds minus the fee reserve', /^At most 48\.99 NIM/.test(err), `"${err}"`)
await closeSheet()

// Pool list from testnet.
await page.locator('nav button', { hasText: 'Home' }).tap().catch(() => {})
await waitHash('#/start'); await sleep(600)
await tapText('Start earning')
await waitHash('#/pools')
let pools = []
for (let i = 0; i < 120; i++) {
  pools = await state(s => s.data.livePools.map(p => ({ name: p.name, badge: p.badge, type: p.payoutType, pays: p.pays })))
  if (pools.length) break
  await sleep(500)
}
await sleep(600)
log('pool list loads from testnet (every active validator)', pools.length >= 5 && pools.some(p => p.name === 'Puddle'), `${pools.length}: ${pools.map(p => `${p.name} (${p.type})`).join(', ')}`)
log('every pool is labelled "Testnet validator"', pools.length > 0 && pools.every(p => p.badge === 'Testnet validator') && (await page.locator('[data-kb-layer="pools"] .badge', { hasText: 'Testnet validator' }).count()) > 0)
const isRpc = r => r.startsWith('POST') && r.includes('nimiqwatch.com')
const rpcHosts = [...new Set(requests.filter(isRpc).map(r => r.split(' ')[1].replace(/\/$/, '')))]
const apiHosts = [...new Set(requests.filter(r => r.includes('validators-api')).map(r => new URL(r.split(' ')[1]).host))]
log('testnet session only called testnet services', rpcHosts.every(h => h === 'https://rpc.testnet.nimiqwatch.com') && apiHosts.every(h => h === 'validators-api-test.je-cf9.workers.dev'), `rpc ${JSON.stringify(rpcHosts)} api ${JSON.stringify(apiHosts)}`)
const keys = await page.evaluate(() => Object.keys(localStorage))
const own = ADDRESS.replace(/\s/g, '')
log('testnet data is stored under the testnet namespace', keys.includes(`kb:t:plan:${own}`) && !keys.includes(`kb:plan:${own}`), keys.filter(k => k.includes(own)).join(', '))

// ---------- mainnet, same browser storage ----------
requests.length = 0
await connect(BASE)
log('mainnet: no testnet strip', !(await page.locator('[data-kb="testnet-strip"]').count()))
await openDiagnostics()
const d2 = await diagText()
log('mainnet: no test kickback control, mainnet URLs', !(await page.locator('[data-kb="test-kickback"]').count()) && /NETWORK\s+mainnet/i.test(d2) && d2.includes('https://rpc.nimiqwatch.com'))
const s3 = await state(s => ({ marked: s.plan.marked.length, ready: s.account.readyLuna, started: s.plan.planStartedAt, contacts: s.plan.contacts.length }))
log('mainnet: the testnet plan, contact and test kickback do not appear', s3.marked === 0 && s3.ready === 0 && s3.started == null && s3.contacts === 0, JSON.stringify(s3))
await closeSheet()
const mainRpc = [...new Set(requests.filter(isRpc).map(r => r.split(' ')[1].replace(/\/$/, '')))]
log('mainnet session only called the mainnet RPC', mainRpc.length > 0 && mainRpc.every(h => h === 'https://rpc.nimiqwatch.com'), JSON.stringify(mainRpc))

// ---------- back to testnet: its data is still there ----------
await connect(BASE + '?net=test')
const s4 = await state(s => ({ marked: s.plan.marked.length, ready: s.account.readyLuna }))
log('back on testnet: the test kickback is still ready', s4.marked === 1 && s4.ready === 100000, JSON.stringify(s4))

await t.finish()
