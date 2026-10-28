// Season + polish UI (dev server, ?mock=1) at 390x844 and 360x740: streak chip opens Season,
// skins apply app-wide, cosmetic footer, share card, Remind me, Choose wallet, collecting state,
// pinned action bars on screen (Run, Run waiting, Stake, Stop earning), no "$0.00" anywhere,
// unlock moment. Screenshots go to E2E_SHOTS when set.
// Usage: node e2e/season-ui.mjs [baseUrl]   (default http://localhost:5173/)
import { chromium } from 'playwright'
const OUT = process.env.E2E_SHOTS || '', BASE = (process.argv[2] || 'http://localhost:5173/') + '?mock=1'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const browser = await chromium.launch()
const errors = []
const fails = []
for (const [w, h] of [[390, 844], [360, 740]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${w}: ${e.message}`))
  const pinia = fn => page.evaluate(`(${fn})(document.querySelector('#app').__vue_app__.config.globalProperties.$pinia)`)
  const shot = async (name) => { await sleep(700); if (OUT) await page.screenshot({ path: `${OUT}/${w}-${name}.png` }) }
  const barVisible = async (name, sel = '[data-kb="action-bar"]') => {
    const box = await page.locator(sel).filter({ visible: true }).last().boundingBox().catch(() => null)
    const ok = !!box && box.y + box.height <= h + 1 && box.y >= 0
    if (!ok) fails.push(`${w}x${h} ${name}: action bar not on screen ${JSON.stringify(box)}`)
  }
  const noZeroDollars = async (name) => { const t = await page.evaluate(() => document.body.innerText); if (/\$0\.00/.test(t)) fails.push(`${w} ${name}: shows $0.00`) }
  await page.goto(BASE + '#/home'); await sleep(1500)
  await shot('home'); await noZeroDollars('home')
  if (!(await page.locator('[data-kb="streak-pill"]').isVisible())) fails.push(`${w}: no streak pill`)
  const hb = await page.locator('[data-kb="addr-pill"]').boundingBox(); if (!hb || hb.x + hb.width > w - 10) fails.push(`${w}: header overflows ${JSON.stringify(hb)}`)
  // Stage B: the chip carries the tier badge and XP.
  if (!(await page.locator('[data-kb="season-chip"]').isVisible())) fails.push(`${w}: no tier badge in the Home chip`)
  if (!(await page.locator('[data-kb="streak-pill"]').innerText()).includes('2,340')) fails.push(`${w}: chip has no XP`)
  await page.locator('[data-kb="streak-pill"]').tap(); await sleep(900)
  await shot('season')
  for (const k of ['tier-hero', 'quests', 'ladder', 'xp-ways', 'streak-count']) if (!(await page.locator(`[data-kb="${k}"]`).count())) fails.push(`${w}: Season has no ${k}`)
  const hero = await page.locator('[data-kb="tier-hero"]').innerText()
  if (!/KICK\s*III/i.test(hero) || !hero.includes('660 XP to Bounce')) fails.push(`${w}: tier hero text ${JSON.stringify(hero.slice(0, 80))}`)
  if (!(await page.locator('[data-kb="quests"]').innerText()).includes('Resets Monday')) fails.push(`${w}: quests reset line`); await page.locator('[data-kb="cosmetic"]').scrollIntoViewIfNeeded(); await shot('season-bottom')
  if (!(await page.locator('[data-kb="cosmetic"]').innerText()).includes('Cosmetic only. Milestones and skins are not money and never become tokens.')) fails.push('footer copy')
  await page.locator('[data-kb-skin-card="bounce"] button').tap(); await sleep(400)
  const attr = await page.evaluate(() => document.documentElement.getAttribute('data-kb-skin'))
  if (attr !== 'bounce') fails.push(`${w}: apply skin -> ${attr}`)
  await page.locator('[data-kb="season-share"]').scrollIntoViewIfNeeded(); await page.locator('[data-kb="season-share"]').tap(); await sleep(1800); await shot('share')
  await page.locator('.sheet [aria-label="Close"]').tap(); await sleep(600)
  await page.goto(BASE + '#/home'); await sleep(1200)
  await page.locator('[data-kb="bell"]').tap(); await sleep(700); await shot('remind')
  await page.locator('.sheet [aria-label="Close"]').tap(); await sleep(600)
  await page.locator('[data-kb="wallet-switch"]').tap(); await sleep(700); await shot('wallets')
  await page.locator('.sheet [aria-label="Close"]').tap(); await sleep(600)
  // Run my plan (review)
  await page.locator('button', { hasText: 'Share now' }).tap(); await sleep(1000); await shot('run'); await barVisible('run')
  await page.goto(BASE + '#/home'); await sleep(1000)
  // collecting: tiny ready
  await pinia(p => { p.state.value.account.readyCents = 6 }); await sleep(400); await shot('home-collecting')
  if (!(await page.locator('[data-kb="collecting"]').isVisible())) fails.push(`${w}: no collecting bar`)
  await page.locator('button', { hasText: 'Share now' }).tap(); await sleep(1000); await shot('run-collecting'); await barVisible('run-collecting')
  await page.goto(BASE + '#/stake'); await sleep(1200); await shot('stake'); await barVisible('stake')
  await page.goto(BASE + '#/plan'); await sleep(1200); await shot('plan'); await page.locator('[data-kb="min-ready"]').scrollIntoViewIfNeeded(); await shot('plan-min')
  await page.goto(BASE + '#/pool'); await sleep(1200)
  await pinia(p => { p._s.get('ui').openSheet('stop') }); await sleep(800); await shot('stop'); await barVisible('stop')
  await pinia(p => { p._s.get('ui').closeSheet() }); await sleep(600)
  await pinia(p => { p._s.get('season').celebrate = 'legend' }); await sleep(1500); await shot('unlock')
  await pinia(p => { const s = p._s.get('season'); s.celebrate = null }); await sleep(400)
  await pinia(p => { const s = p._s.get('season'); s.celebrateTier = 'Bounce'; s.celebrate = 'bounce' }); await sleep(1500); await shot('tierup')
  if (!(await page.locator('[data-kb="unlock"]').innerText()).includes('You reached Bounce')) fails.push(`${w}: tier-up says who you reached`)
  await ctx.close()
}
await browser.close()
for (const e of errors) console.log('FAIL  page error', e)
for (const f of fails) console.log('FAIL ', f)
const bad = errors.length + fails.length
console.log(bad ? `\n${bad} failed` : '\nPASS  all season UI and layout checks (390x844 and 360x740)')
process.exit(bad ? 1 : 0)
