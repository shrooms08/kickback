// Shared Playwright setup for the touch tests: Android Chrome WebView
// emulation inside a fake Nimiq Pay, dry run on with a 500 NIM fake balance.
import { randomBytes } from 'node:crypto'
import { chromium } from 'playwright'

export const sleep = ms => new Promise(r => setTimeout(r, ms))

/** A valid, never-used Nimiq address (random 20 bytes + IBAN checksum): an empty wallet with no history. */
export function freshAddress() {
  const ALPHA = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
  let bits = 0, val = 0, body = ''
  for (const b of randomBytes(20)) { val = ((val << 8) | b) & 0xFFFF; bits += 8; while (bits >= 5) { body += ALPHA[(val >>> (bits - 5)) & 31]; bits -= 5 } }
  const num = (body + 'NQ00').split('').map(c => /\d/.test(c) ? c : String(c.charCodeAt(0) - 55)).join('')
  let r = 0
  for (const c of num) r = (r * 10 + +c) % 97
  return ('NQ' + String(98 - r).padStart(2, '0') + body).replace(/(.{4})/g, '$1 ').trim()
}

/** The wallet the fake Nimiq Pay reports (default: a real mainnet address with history). */
export async function setup(base, address = 'NQ51 KVXF RMYV 9HPD CA8N 5X10 7SUY 2C29 MU2T') {
  const results = []
  const log = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 16; Seeker Build/BP2A.250605.031; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/155.0.7290.88 Mobile Safari/537.36',
  })
  // Pretend to be inside Nimiq Pay, with dry run on and an empty cache.
  await context.addInitScript((address) => {
    if (!sessionStorage.getItem('kb-e2e')) {
      sessionStorage.setItem('kb-e2e', '1')
      localStorage.clear()
      localStorage.setItem('kb:dryrun', JSON.stringify({ on: true, outcome: 'approve', baseBalanceLuna: 50000000, baseStaker: null, txs: [], kickbacks: [], releaseMs: 120000 }))
    }
    window.nimiqPay = { language: 'en', network: 'mainnet' }
    window.nimiq = {
      listAccounts: async () => [address],
      getBalance: async () => 0,
    }
  }, address)
  // The sandboxed browser may not resolve DNS: relay every non-local request
  // (app host, Validators API, RPC) through Node so the app talks to the real services.
  await context.route(url => url.hostname !== 'localhost', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': '*', 'access-control-allow-headers': '*' } })
    try {
      let r
      for (let attempt = 0; ; attempt++) {
        try { r = await fetch(req.url(), { method: req.method(), headers: req.method() === 'POST' ? { 'content-type': 'application/json' } : {}, body: req.method() === 'POST' ? req.postData() : undefined }); break }
        catch (e) { if (attempt >= 8) throw e; await sleep(800 * (attempt + 1)) }
      }
      const body = Buffer.from(await r.arrayBuffer())
      if (process.env.E2E_VERBOSE) console.log('relay', r.status, req.url().slice(0, 70))
      const headers = { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'access-control-allow-origin': '*' }
      for (const h of ['x-ratelimit-remaining', 'x-ratelimit-reset']) if (r.headers.get(h)) headers[h] = r.headers.get(h)
      await route.fulfill({ status: r.status, headers, body })
    }
    catch (e) { console.log('relay failed', req.url().slice(0, 80), e.cause?.code || e.message); await route.abort('failed') }
  })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  page.on('pageerror', e => console.log('PAGE ERROR', e.message))

  const hash = () => page.evaluate(() => location.hash)
  const waitHash = async (h, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await hash() === h) return true; await sleep(100) } return false }
  /** Pinia state, read in the page. */
  const state = fn => page.evaluate(`(${fn})(document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value)`)
  /** Tap the visible button on the current screen matching text. */
  async function tapText(text, scope = '') {
    const loc = page.locator(`${scope} button:visible, ${scope} [role=button]:visible`).filter({ hasText: text }).first()
    await loc.waitFor({ state: 'visible', timeout: 10000 })
    await loc.tap()
  }
  /** Real touch-and-hold through CDP touch events. */
  async function hold(selector, ms) {
    await page.locator(selector).first().scrollIntoViewIfNeeded()
    await sleep(300)
    const box = await page.locator(selector).first().boundingBox()
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await sleep(ms)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  async function openDiagnostics() {
    await page.locator('nav button', { hasText: 'Home' }).tap().catch(() => {})
    await sleep(500)
    for (let i = 0; i < 5; i++) { await page.locator('[data-kb-layer="home"] .logo-tap, [data-kb-layer="homeEmpty"] .logo-tap').first().tap(); await sleep(120) }
    await page.locator('.sheet').waitFor()
  }
  async function closeSheet() {
    await page.locator('.sheet [aria-label="Close"]').first().tap()
    await sleep(700)
  }
  async function finish() {
    console.log(`\n${results.filter(r => r.ok).length}/${results.length} passed`)
    await browser.close()
    process.exit(results.every(r => r.ok) ? 0 : 1)
  }
  return { browser, page, cdp, log, results, hash, waitHash, state, tapText, hold, openDiagnostics, closeSheet, finish }
}

/** Connect, pick a pool (Nimiq.Fun when offered), stake 100 NIM in dry run, reach Home. */
export async function connectAndStake(t, base, pool = 'Nimiq.Fun') {
  const { page, log, waitHash, tapText, hold, state } = t
  await page.goto(base)
  await waitHash('#/welcome')
  await sleep(800)
  await tapText('Connect wallet')
  await waitHash('#/start')
  await sleep(1500)
  await tapText('Start earning')
  await waitHash('#/pools')
  // Wait for the live pool list (Validators API + probes) to fill in and enable the button.
  for (let i = 0; i < 120; i++) {
    const st = await page.evaluate(() => { const b = document.querySelector('[data-kb-layer="pools"] button.kb-btn-primary'); const s = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value; return { enabled: !!b && !b.disabled, text: b?.textContent, pools: s.data.livePools.length, state: s.data.poolsState, err: s.live.lastError } })
    if (st.enabled && /Nimiq|Obsidian/.test(st.text)) break
    if (i % 20 === 19) console.log('waiting for pools', JSON.stringify(st))
    await sleep(500)
  }
  await sleep(400)
  const card = page.locator('[data-kb-layer="pools"] .card').filter({ hasText: pool }).first()
  if (await card.count()) { await card.tap(); await sleep(300) }
  const picked = await state(s => s.data.livePools.find(p => p.id === s.flow.poolPick)?.name || s.flow.poolPick)
  await page.locator('[data-kb-layer="pools"] button.kb-btn-primary').tap()
  await waitHash('#/stake')
  await sleep(500)
  await page.locator('[data-kb-layer="stake"] .chip', { hasText: /^100$/ }).tap()
  await sleep(300)
  await hold('[data-kb-layer="stake"] .track', 1400)
  log('stake hold opens Approve', await waitHash('#/approve', 4000))
  log('stake reaches Success', await waitHash('#/success', 8000))
  await sleep(4000)
  await tapText('Set up my plan')
  await waitHash('#/home')
  await sleep(1000)
  return picked
}

/** Plan tab: add a contact, optionally set the split, save. */
export async function savePlanWithContact(t, pct) {
  const { page, waitHash, tapText } = t
  await page.locator('nav button', { hasText: 'Plan' }).tap()
  await waitHash('#/plan')
  await sleep(500)
  await page.locator('[data-kb-layer="plan"] .bubble').first().tap()
  await page.locator('.sheet input').first().waitFor()
  await page.locator('.sheet input').nth(0).fill('Ada')
  await page.locator('.sheet input').nth(1).fill('NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8')
  await tapText('Add contact', '.sheet')
  await sleep(900)
  // The split is set on the editor's working copy (dragging cards is not what these tests cover).
  if (pct) await page.evaluate(p => { document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value.plan.pct = p }, pct)
  await sleep(200)
  await tapText('Save plan', '[data-kb-layer="plan"]')
  await sleep(400)
}
