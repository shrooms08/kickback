// Touch repro for the lime Run-my-plan button (Android Chrome WebView emulation).
// Usage: node e2e/fab-touch.mjs [baseUrl]   (default http://localhost:5173/)
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:5173/'
const sleep = ms => new Promise(r => setTimeout(r, ms))
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
await context.addInitScript(() => {
  if (!sessionStorage.getItem('kb-e2e')) {
    sessionStorage.setItem('kb-e2e', '1')
    localStorage.clear()
    localStorage.setItem('kb:dryrun', JSON.stringify({ on: true, outcome: 'approve', baseBalanceLuna: 50000000, baseStaker: null, txs: [], kickbacks: [], releaseMs: 120000 }))
  }
  window.nimiqPay = { language: 'en', network: 'mainnet' }
  window.nimiq = {
    listAccounts: async () => ['NQ51 KVXF RMYV 9HPD CA8N 5X10 7SUY 2C29 MU2T'],
    getBalance: async () => 0,
  }
})
// The sandboxed browser may not resolve DNS: relay every non-local request
// (app host, Validators API, RPC) through Node so the app talks to the real services.
for (const host of [url => url.hostname !== 'localhost']) {
  await context.route(host, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': '*', 'access-control-allow-headers': '*' } })
    try {
      let r
      for (let attempt = 0; ; attempt++) {
        try { r = await fetch(req.url(), { method: req.method(), headers: req.method() === 'POST' ? { 'content-type': 'application/json' } : {}, body: req.method() === 'POST' ? req.postData() : undefined }); break }
        catch (e) { if (attempt >= 4) throw e; await sleep(800 * (attempt + 1)) }
      }
      const body = Buffer.from(await r.arrayBuffer())
      if (process.env.E2E_VERBOSE) console.log('relay', r.status, req.url().slice(0, 70))
      const headers = { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'access-control-allow-origin': '*' }
      for (const h of ['x-ratelimit-remaining', 'x-ratelimit-reset']) if (r.headers.get(h)) headers[h] = r.headers.get(h)
      await route.fulfill({ status: r.status, headers, body })
    }
    catch (e) { console.log('relay failed', req.url().slice(0, 80), e.cause?.code || e.message); await route.abort('failed') }
  })
}
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
page.on('pageerror', e => console.log('PAGE ERROR', e.message))

const hash = () => page.evaluate(() => location.hash)
const waitHash = async (h, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await hash() === h) return true; await sleep(100) } return false }
/** Tap the visible element on the current screen matching text. */
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
/** What is under the lime button's centre, and is the nav lock on? */
async function probeFab() {
  return page.evaluate(() => {
    const fab = document.querySelector('nav .fab')
    if (!fab) return { fab: false }
    const r = fab.getBoundingClientRect()
    const x = r.left + r.width / 2, y = r.top + r.height / 2
    const hit = document.elementFromPoint(x, y)
    const describe = el => el ? `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}` : 'null'
    return { fab: true, x: Math.round(x), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height), hit: describe(hit), isFab: !!hit && (hit === fab || fab.contains(hit)), guard: !!document.querySelector('.guard') }
  })
}
async function tapFabExpectRun(name) {
  const before = await probeFab()
  await page.locator('nav .fab').tap()
  const ok = await waitHash('#/run', 3000)
  const visible = ok && await page.locator('[data-kb-layer="run"]').isVisible()
  log(name, ok && visible, `hit=${before.hit} isFab=${before.isFab} guard=${before.guard} at ${before.x},${before.y} size ${before.w}x${before.h}`)
  if (ok) {
    await sleep(500)
    await page.locator('[data-kb-layer="run"] [aria-label="Close"]').tap()
    await waitHash('#/home', 5000)
    await sleep(500)
  }
  return ok
}

await page.goto(BASE)
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

// Plan: add a contact and save.
await page.locator('nav button', { hasText: 'Plan' }).tap()
await waitHash('#/plan')
await sleep(500)
await page.locator('[data-kb-layer="plan"] .bubble').first().tap()
await page.locator('.sheet input').first().waitFor()
await page.locator('.sheet input').nth(0).fill('Ada')
await page.locator('.sheet input').nth(1).fill('NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8')
await tapText('Add contact', '.sheet')
await sleep(900)
await tapText('Save plan', '[data-kb-layer="plan"]')
await sleep(400)

// Case B: tap the lime button while the "Plan saved" toast is showing.
const toastShown = await page.locator('.toast').isVisible()
await tapFabExpectRun(`lime button while a toast is showing (toast visible: ${toastShown})`)

// Diagnostics: add a 25 NIM fake kickback.
await page.locator('nav button', { hasText: 'Home' }).tap()
await waitHash('#/home')
await sleep(500)
for (let i = 0; i < 5; i++) { await page.locator('[data-kb-layer="home"] .logo-tap').tap(); await sleep(120) }
await page.locator('.sheet').waitFor()
await page.locator('.sheet input[aria-label="Fake kickback in NIM"]').fill('25')
await tapText('Add kickback', '.sheet')
await sleep(300)
await page.locator('.sheet [aria-label="Close"]').first().tap()
await sleep(700)
const ready = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value.account.readyLuna)
log('25 NIM ready to share', ready === 2500000, `readyLuna=${ready}`)

// Case C: dry-run strip showing, at rest.
const strip = await page.locator('.preview').textContent().catch(() => '')
await tapFabExpectRun(`lime button with dry-run strip ("${strip?.trim()}")`)

// Case A: right after another transition (tab switch) finished.
await page.locator('nav button', { hasText: 'Kickbacks' }).tap()
await waitHash('#/kickbacks')
await sleep(260)
await tapFabExpectRun('lime button right after a tab transition')

// Right after closing a sheet.
for (let i = 0; i < 5; i++) { await page.locator('[data-kb-layer="kickbacks"], [data-kb-layer="home"]').first().isVisible(); await sleep(10) }
await page.locator('nav button', { hasText: 'Home' }).tap(); await waitHash('#/home'); await sleep(300)
await page.locator('[data-kb-layer="home"] .bubble').first().tap() // Add -> opens add sheet on plan
await page.locator('.sheet').waitFor()
await page.locator('.sheet [aria-label="Close"]').first().tap()
await sleep(400)
await tapFabExpectRun('lime button right after closing a sheet')

// Home "Share now" opens the same screen.
await page.locator('nav button', { hasText: 'Home' }).tap(); await waitHash('#/home'); await sleep(400)
await page.locator('[data-kb-layer="home"] .share').tap()
log('Share now opens Run my plan', await waitHash('#/run', 3000))
await sleep(600)

// Hold to run my plan with a 1.3 s touch-and-hold.
if (await hash() !== '#/run') { await page.locator('nav .fab').tap(); await waitHash('#/run', 3000) }
await sleep(500)
const runState = await page.evaluate(() => {
  const s = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value
  const t = document.querySelector('[data-kb-layer="run"] .track')
  window.__holdEvents = []
  if (t) for (const ev of ['pointerdown', 'pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture', 'touchstart', 'touchend', 'touchcancel']) t.addEventListener(ev, e => window.__holdEvents.push(`${Math.round(performance.now())} ${ev}${e.pointerType ? ':' + e.pointerType : ''}`), true)
  return { phase: s.flow.runPhase, reason: document.querySelector('[data-kb-layer="run"] .kb-reason')?.textContent || null, track: !!t, locked: !!document.querySelector('[data-kb-layer="run"] .locked'), amount: s.flow.runAmountLuna, ready: s.account.readyLuna }
})
console.log('run review state', JSON.stringify(runState))
await hold('[data-kb-layer="run"] .track', 1300)
await sleep(800)
console.log('hold events', JSON.stringify(await page.evaluate(() => window.__holdEvents)))
let phase = ''
for (let i = 0; i < 60; i++) { phase = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value.flow.runPhase); if (phase === 'done') break; await sleep(500) }
log('Hold to run my plan (1.3 s touch) completes the run', phase === 'done', `runPhase=${phase}`)

// Repeat the plain tap a few times for flakiness.
await page.locator('[data-kb-layer="run"] [aria-label="Close"]').tap(); await waitHash('#/home'); await sleep(600)
let okCount = 0
for (let i = 0; i < 5; i++) if (await tapFabExpectRun(`lime button repeat ${i + 1}`)) okCount++

// Case D: an edge-swipe touch the host takes: pointerdown on the left edge, then
// no pointerup/pointercancel ever arrives (Android back gesture). Then tap back + lime.
await page.locator('[data-kb-layer="run"] [aria-label="Close"]').tap().catch(() => {}); await waitHash('#/home', 5000); await sleep(600)
await page.locator('[data-kb-layer="home"] button', { hasText: /^$/ }).first().isVisible().catch(() => {})
await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/pools'))
await waitHash('#/pools'); await sleep(800)
const edgeLocked = await page.evaluate(() => {
  const edge = document.querySelector('.edge')
  if (!edge) return 'no edge zone'
  edge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 6, clientY: 400, pointerId: 77, pointerType: 'touch', isPrimary: true }))
  return 'pointerdown sent, no pointerup'
})
await sleep(200)
await page.locator('[data-kb-layer="pools"] [aria-label="Back"]').tap()
await sleep(300)
let back = await hash()
for (let i = 0; i < 40 && !(await page.locator('[data-kb-layer="home"]').isVisible() && !(await page.locator('[data-kb-layer="pools"]').isVisible())); i++) await sleep(250)
const homeShown = await page.locator('[data-kb-layer="home"]').isVisible() && !(await page.locator('[data-kb-layer="pools"]').isVisible())
if (!homeShown || process.env.E2E_VERBOSE) console.log('after D', JSON.stringify(await page.evaluate(async () => {
  const { navlog } = await import('/src/lib/navlog.ts').catch(() => ({ navlog: null }))
  const s = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value
  return { hash: location.hash, nav: { screen: s.nav.screen, busy: s.nav.busy, gestureUnder: s.nav.gestureUnder, base: s.nav.base, leaving: s.nav.leaving }, lock: navlog && { locked: navlog.locked, reason: navlog.lockReason }, events: navlog && navlog.events.slice(-6).map(e => e.what), taps: navlog && navlog.taps.slice(-3).map(t => `${t.type} ${t.x},${t.y} ${t.hit}`) }
})))
log(`D. abandoned edge gesture (${edgeLocked}): back still works`, homeShown, `route=${back}`)
if (homeShown) await tapFabExpectRun('D. lime button after an abandoned edge gesture')

// Case E: a WebView where WAAPI "finished" never resolves.
await page.evaluate(() => {
  const orig = Element.prototype.animate
  window.__origAnimate = orig
  Element.prototype.animate = function (...args) {
    const a = orig.apply(this, args)
    Object.defineProperty(a, 'finished', { value: new Promise(() => {}) })
    return a
  }
})
await tapFabExpectRun('E. lime button when animations never report finished')
await tapFabExpectRun('E. lime button again (lock released each time)')
await page.evaluate(() => { Element.prototype.animate = window.__origAnimate })

console.log(`\n${results.filter(r => r.ok).length}/${results.length} passed`)
await browser.close()
process.exit(results.every(r => r.ok) ? 0 : 1)
