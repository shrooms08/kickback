// Touch-and-hold through Stake and Run my plan (dev server, ?mock=1) at 393x852 and 360x740:
// the pinned Hold buttons work by real touch, Run reaches Done, and Done's pinned bar shows Share.
// Usage: node e2e/touch-holds.mjs [baseUrl]   (default http://localhost:5173/)
import { chromium } from 'playwright'
const BASE = process.argv[2] || 'http://localhost:5173/'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const b = await chromium.launch()
let ok = true
for (const [w, h] of [[393, 852], [360, 740]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page)
  const errs = []; page.on('pageerror', e => errs.push(e.message))
  const hold = async (sel, ms) => { const box = await page.locator(sel).first().boundingBox(); const x = box.x + box.width / 2, y = box.y + box.height / 2; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(ms); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
  const hash = () => page.evaluate(() => location.hash)
  await page.goto(BASE + '?mock=1#/stake'); await sleep(1500)
  await page.locator('[data-kb-layer="stake"] .chip', { hasText: /^100$/ }).tap(); await sleep(300)
  await hold('[data-kb-layer="stake"] .track', 1400); await sleep(1500)
  const h1 = await hash(); console.log(w, 'stake hold ->', h1); if (!/approve|success/.test(h1)) ok = false
  await page.goto('about:blank'); await page.goto(BASE + '?mock=1#/home'); await sleep(1500)
  await page.locator('button', { hasText: 'Share now' }).tap(); await sleep(1200)
  await hold('[data-kb-layer="run"] .track', 1400); await sleep(9000)
  console.log(w, 'phase', JSON.stringify(await page.evaluate(() => { const s = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value.flow; return { p: s.runPhase, steps: s.steps.map(x => x.st) } })))
  const done = await page.locator('[data-kb="run-done"]').count(), share = await page.locator('[data-kb="done-share"]').isVisible().catch(() => false)
  const bar = await page.locator('[data-kb-layer="run"] [data-kb="action-bar"]').boundingBox()
  console.log(w, 'run hold -> done', done, 'share visible', share, 'bar bottom', Math.round(bar.y + bar.height), '<=', h, errs.length ? 'ERRORS ' + errs.join('; ') : '')
  if (!done || !share || bar.y + bar.height > h + 1 || errs.length) ok = false
  await ctx.close()
}
await b.close(); console.log(ok ? 'PASS touch holds' : 'FAIL'); process.exit(ok ? 0 : 1)
