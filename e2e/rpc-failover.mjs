// Mainnet RPC failover on a touch device inside a fake Nimiq Pay (real mainnet data, dry run off,
// read only: nothing is sent). Route interception makes endpoints fail on purpose:
//  A. JSON-RPC primary answers 503            -> the REST fallback serves Home (staker, kickbacks)
//  B. REST fallback down too                  -> the rpc-proxy serves it (PROXY_TARGET, default the local stack)
//  C. everything down, cached data on phone   -> Home from cache + "Network data is delayed" banner, no error screen
//  D. everything down, nothing cached, SDK ok -> degraded Home (not staked view) + banner, staking blocked
// Usage: node e2e/rpc-failover.mjs [baseUrl]   (default http://localhost:5173/)
//        PROXY_TARGET=https://<ref>.supabase.co/functions/v1/rpc-proxy to use a deployed proxy.
import { setup, sleep } from './lib.mjs'

const BASE = process.argv[2] || 'http://localhost:5173/'
const PROXY_TARGET = process.env.PROXY_TARGET || 'http://127.0.0.1:54321/functions/v1/rpc-proxy'
// A real mainnet staker with Nimiq.Fun (one of the app's probe stakers).
const ADDRESS = 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8'
const all = []

async function scenario(name, { blockRest = false, blockProxy = false, keep = null }, run) {
  const t = keep ?? await setup(BASE, { address: ADDRESS, balanceLuna: 500_000_000 })
  const { page, context, log } = t
  if (!keep) await context.addInitScript(() => { localStorage.setItem('kb:dryrun', JSON.stringify({ on: false })) })
  await context.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})
  await context.route(u => u.hostname !== 'localhost', async (route) => {
    const req = route.request(), url = new URL(req.url())
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': '*', 'access-control-allow-headers': '*' } })
    const isProxy = url.pathname.endsWith('/functions/v1/rpc-proxy')
    if (url.hostname === 'rpc.nimiqwatch.com') return route.fulfill({ status: 503, body: 'Site not available', headers: { 'access-control-allow-origin': '*' } })
    if (blockRest && url.hostname === 'v2.nimiqwatch.com') return route.abort('failed')
    if (isProxy && blockProxy) return route.abort('failed')
    const target = isProxy ? `${PROXY_TARGET}${url.search}` : req.url()
    try {
      const h = req.headers(), headers = {}
      for (const k of ['content-type', 'authorization', 'apikey']) if (h[k]) headers[k] = h[k]
      const r = await fetch(target, { method: req.method(), headers, body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postData() })
      await route.fulfill({ status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json', 'access-control-allow-origin': '*' }, body: Buffer.from(await r.arrayBuffer()) })
    }
    catch { await route.abort('failed') }
  })
  await run(t, log)
  return t
}

const state = (t, fn) => t.state(fn)
async function connect(t) {
  await t.page.goto(BASE)
  await t.waitHash('#/welcome'); await sleep(800)
  await t.tapText('Connect wallet')
  for (let i = 0; i < 60; i++) { const h = await t.hash(); if (h !== '#/connecting' && h !== '#/welcome') return h; await sleep(500) }
  return t.hash()
}
async function diagActive(t) {
  await t.openDiagnostics()
  const d = await t.page.locator('.sheet .lines').innerText()
  await t.closeSheet()
  return /RPC ACTIVE\s+([^\n]+)/i.exec(d)?.[1] ?? ''
}
const bannerText = t => t.page.locator('.banner').innerText().catch(() => '')

// A
const tA = await scenario('A', {}, async (t, log) => {
  const h = await connect(t)
  log('A: primary 503 -> Home loads (staked wallet)', h === '#/home', h)
  for (let i = 0; i < 40 && !(await state(t, s => s.account.stakedNim > 0)); i++) await sleep(500)
  const s = await state(t, s => ({ staked: s.account.staked, stakedNim: s.account.stakedNim, pool: s.account.pool, kb: s.data.kickbacks.length }))
  log('A: stake read through the REST fallback', s.staked && s.stakedNim === 32_000_000, JSON.stringify(s))
  for (let i = 0; i < 40 && !(await state(t, s => s.data.kickbacks.length > 0)); i++) await sleep(500)
  log('A: kickbacks found (reward address from pool data or probes)', (await state(t, s => s.data.kickbacks.length)) > 0)
  const active = await diagActive(t)
  log('A: Diagnostics shows the REST fallback as active', /v2\.nimiqwatch\.com/.test(active), active)
  log('A: no error screen, no delayed banner', !(await t.page.locator('[data-kb-layer="error"]').count()) && !/delayed/i.test(await bannerText(t)))
})
all.push(...tA.results); await tA.browser.close()

// B
const tB = await scenario('B', { blockRest: true }, async (t, log) => {
  const h = await connect(t)
  log('B: primary and REST down -> Home loads through the rpc-proxy', h === '#/home', h)
  for (let i = 0; i < 40 && !(await state(t, s => s.account.stakedNim > 0)); i++) await sleep(500)
  log('B: stake read through the proxy', (await state(t, s => s.account.stakedNim)) === 32_000_000)
  const active = await diagActive(t)
  log('B: Diagnostics shows the rpc-proxy as active', /rpc-proxy/.test(active), active)
})
all.push(...tB.results)

// C: same phone (cache from B), now everything fails, reload.
await scenario('C', { blockRest: true, blockProxy: true, keep: tB }, async (t, log) => {
  await t.page.reload(); await sleep(800)
  const h = await connect(t)
  log('C: everything down with a cache -> Home, not the error screen', h === '#/home', h)
  // The app refreshes every 30 s while delayed / 2 min otherwise: force that refresh now.
  await t.page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('live').refresh({ force: true }))
  await sleep(2500)
  const b = await bannerText(t)
  log('C: banner "Network data is delayed" with Retry', /Network data is delayed/.test(b) && /Retry/.test(b), JSON.stringify(b))
  log('C: cached stake still shown', (await state(t, s => s.account.stakedNim)) === 32_000_000)
})
all.push(...tB.results.slice(all.length - tA.results.length)); await tB.browser.close()

// D: new phone, nothing cached, everything down; Nimiq Pay's getBalance still answers.
const tD = await scenario('D', { blockRest: true, blockProxy: true }, async (t, log) => {
  const h = await connect(t)
  log('D: nothing cached, everything down, SDK ok -> degraded Home, not the error screen', h === '#/start', h)
  await sleep(1500)
  log('D: banner "Network data is delayed"', /Network data is delayed/.test(await bannerText(t)), JSON.stringify(await bannerText(t)))
  log('D: wallet balance from Nimiq Pay (SDK)', (await state(t, s => s.wallet.balanceSource)) === 'sdk')
  await t.tapText('Start earning')
  await t.waitHash('#/pools', 5000)
  const reason = await state(t, s => s.account.chainUnknown)
  log('D: staking waits until the stake can be read', reason === true)
})
all.push(...tD.results); await tD.browser.close()

const ok = all.filter(r => r.ok).length
console.log(`\n${ok}/${all.length} passed`)
process.exit(ok === all.length ? 0 : 1)
