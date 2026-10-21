// Touch repro for the lime Run-my-plan button (Android Chrome WebView emulation).
// Usage: node e2e/fab-touch.mjs [baseUrl]   (default http://localhost:5173/)
import { connectAndStake, savePlanWithContact, setup, sleep } from './lib.mjs'

const BASE = process.argv[2] || 'http://localhost:5173/'
const t = await setup(BASE)
const { page, log, hash, waitHash, tapText, hold } = t

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

await connectAndStake(t, BASE)
await savePlanWithContact(t)

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

await t.finish()
