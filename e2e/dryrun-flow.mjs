// Dry-run flow on a touch device: stake, plan, fake kickback, run, reopen.
// Usage: node e2e/dryrun-flow.mjs [baseUrl]   (default http://localhost:5173/)
import { connectAndStake, freshAddress, savePlanWithContact, setup, sleep } from './lib.mjs'

const BASE = process.argv[2] || 'http://localhost:5173/'
// An empty wallet with no history, like the on-device test wallet (0 NIM, never staked).
const ADDRESS = freshAddress()
console.log('wallet', ADDRESS)
const t = await setup(BASE, ADDRESS)
const { page, log, hash, waitHash, state, tapText, hold, openDiagnostics, closeSheet } = t

const text = async sel => ((await page.locator(sel).first().textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim()
const toast = async () => text('.toast .msg')
const home = sel => `[data-kb-layer="home"] ${sel}`
const run = sel => `[data-kb-layer="run"] ${sel}`
/** E2E_SHOTS=dir saves screenshots of the key states. */
const shot = name => process.env.E2E_SHOTS ? page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` }) : null

// 1. Dry run on, 500 NIM fake balance, stake 100 with Nimiq.Fun.
const pool = await connectAndStake(t, BASE, 'Nimiq.Fun')
log('staked with Nimiq.Fun', /Nimiq\.Fun/i.test(pool), `pool=${pool}`)

// 2. Home before any kickback: wallet, first-kickback countdown, earned line.
await sleep(1500)
log('Home shows Wallet 400.00 NIM after staking 100', (await text(home('[data-kb="wallet-amt"]'))) === '400.00 NIM', await text(home('[data-kb="wallet-amt"]')))
const h1 = await text(home('h1'))
const first = await state(s => ({ firstInH: s.account.firstInH, firstAt: s.account.firstAt, stakeAt: s.account.stakeAt, pending: s.account.firstPending }))
log('Home countdown is to the first kickback', /^First kickback in /i.test(h1), `"${h1}" ${JSON.stringify(first)}`)
log('first kickback is 12 to 26 h after the (fake) stake time', first.firstAt && first.stakeAt && (first.firstAt - first.stakeAt) / 3600e3 >= 11.9 && (first.firstAt - first.stakeAt) / 3600e3 <= 26,
  first.firstAt ? `${((first.firstAt - first.stakeAt) / 3600e3).toFixed(2)} h, due ${new Date(first.firstAt).toISOString()}` : 'no estimate')
const earnedNote = await text(home('[data-kb="earned-note"]'))
log('Earned so far reads "0.00 NIM, first one on the way"', earnedNote === '0.00 NIM, first one on the way', `"${earnedNote}"`)
if (earnedNote !== '0.00 NIM, first one on the way') console.log('earned debug', JSON.stringify(await page.evaluate(() => {
  const s = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value.account
  const b = [...document.querySelectorAll('[data-kb-layer="home"] .kb-eyebrow')].find(e => /Earned/.test(e.textContent))
  return { earnedCents: s.earnedCents, kbCount: s.kbCount, stakePending: s.stakePending, firstPending: s.firstPending, block: b?.parentElement?.innerText }
})))
await shot('1-home-first-kickback')
const dupes = await page.locator('[data-kb-layer="home"]').getByText(/lands in about/).count()
log('no duplicate "lands in about" sentence on Home', dupes === 0, `count=${dupes}`)

// 3. Plan 55% restake / 35% keep / 10% to a contact.
await savePlanWithContact(t, [10, 55, 35])
const saved = await state(s => ({ saved: s.plan.saved, started: s.plan.planStartedAt }))
log('plan saved 10/55/35 with a contact', JSON.stringify(saved.saved) === '[10,55,35]' && !!saved.started, JSON.stringify(saved))

// 4. Diagnostics: add a 25 NIM kickback.
await openDiagnostics()
await page.locator('.sheet input[aria-label="Fake kickback in NIM"]').fill('25')
await tapText('Add kickback', '.sheet')
await sleep(300)
const kbToast = await toast()
log('toast "Dry run: +25 NIM kickback"', kbToast === 'Dry run: +25 NIM kickback', `"${kbToast}"`)
await closeSheet()
await page.locator('nav button', { hasText: 'Home' }).tap(); await waitHash('#/home'); await sleep(1500)

// 5. Home: Wallet 425, Ready 25.
log('Home shows Wallet 425.00 NIM', (await text(home('[data-kb="wallet-amt"]'))) === '425.00 NIM', await text(home('[data-kb="wallet-amt"]')))
const ready = await state(s => s.account.readyLuna)
const readyTxt = await text(home('[data-kb="ready-amt"]'))
await page.locator(home('[data-kb="wallet-stat"]')).scrollIntoViewIfNeeded()
await shot('2-home-wallet-ready')
log('Home shows Ready to share 25.00', ready === 2500000 && /^25\.00/.test(readyTxt), `readyLuna=${ready} text="${readyTxt}"`)

// 6. Lime button opens Run my plan; hold 1.3 s; all 3 steps succeed.
await page.locator('nav .fab').tap()
log('lime button opens Run my plan', await waitHash('#/run', 3000))
await sleep(600)
const runH1 = await text(run('h1'))
log('Run my plan reviews 25.00 NIM (no Done heading)', /Ready to share 25\.00 NIM/i.test(runH1) && !(await page.locator(run('[data-kb="run-done"]')).count()), `"${runH1}"`)
await hold(run('.track'), 1300)
let res = {}
for (let i = 0; i < 80; i++) {
  res = await state(s => ({ phase: s.flow.runPhase, mode: s.flow.doneMode, steps: s.flow.steps.map(x => `${x.type}:${x.st}:${x.luna}`) }))
  if (res.phase === 'done') break
  await sleep(500)
}
log('all 3 steps succeed', res.phase === 'done' && res.mode === 'full' && res.steps.length === 3 && res.steps.every(x => x.includes(':approved:')), JSON.stringify(res))
await sleep(800)
log('Done shows right after the run', await page.locator(run('[data-kb="run-done"]')).isVisible())

// 7. Close, then Home: nothing ready, wallet down by the send + restake (keep stays).
await page.locator(run('button'), { hasText: 'Back to home' }).filter({ hasText: 'Back to home' }).first().tap()
await waitHash('#/home'); await sleep(1500)
const after = await state(s => ({ ready: s.account.readyLuna, staked: s.account.stakedNim }))
log('after the run: Ready 0, Wallet 408.75, Staked 113.75', after.ready === 0 && (await text(home('[data-kb="wallet-amt"]'))) === '408.75 NIM' && after.staked === 113.75,
  `${JSON.stringify(after)} wallet="${await text(home('[data-kb="wallet-amt"]'))}"`)

// 8. Reopen: the empty state, not Done.
async function expectEmpty(name) {
  await page.locator('nav .fab').tap()
  await waitHash('#/run', 3000); await sleep(700)
  const empty = await page.locator(run('[data-kb="run-empty"]')).isVisible()
  const done = await page.locator(run('[data-kb="run-done"]')).count()
  const line = await text(run('.empty-line'))
  const btns = await page.locator(run('.foot button')).allTextContents()
  const amounts = (await page.locator(run('.amt')).allTextContents()).map(s => s.trim()).filter(Boolean)
  const track = await page.locator(run('.track')).count()
  const pcts = await text(run('.stack, [class*=stack]'))
  await shot('3-run-empty')
  log(name, empty && !done && /^Your (next|first) kickback lands in about \d+h$/.test(line) && btns.join('|') === 'Edit plan|Close' && amounts.length === 0 && !track && /55%/.test(pcts),
    `empty=${empty} done=${done} line="${line}" buttons=${JSON.stringify(btns)} amounts=${JSON.stringify(amounts)} hold=${track}`)
}
await expectEmpty('reopen shows "Nothing to share yet", countdown, % only, Edit plan + Close')
await page.locator(run('.foot button'), { hasText: 'Close' }).filter({ hasText: 'Close' }).tap()
await waitHash('#/home', 5000); await sleep(800)

// 9. A finished run dismissed with the system back gesture also reopens empty.
await openDiagnostics()
await page.locator('.sheet input[aria-label="Fake kickback in NIM"]').fill('10')
await tapText('Add kickback', '.sheet')
await closeSheet()
await page.locator('nav button', { hasText: 'Home' }).tap(); await waitHash('#/home'); await sleep(800)
await page.locator('nav .fab').tap(); await waitHash('#/run', 3000); await sleep(600)
await hold(run('.track'), 1300)
for (let i = 0; i < 80 && (await state(s => s.flow.runPhase)) !== 'done'; i++) await sleep(500)
await sleep(600)
await page.evaluate(() => history.back())
await waitHash('#/home', 5000); await sleep(900)
await expectEmpty('after a run closed with back: reopen shows the empty state, not Done')
await page.locator(run('.foot button'), { hasText: 'Close' }).filter({ hasText: 'Close' }).tap()
await waitHash('#/home', 5000); await sleep(800)

// 10. Reset dry run keeps the plan; a new fake kickback is ready again (old dry shares are forgotten).
await openDiagnostics()
await tapText('Reset dry run', '.sheet')
await sleep(1500)
// Reset removes the fake stake: the app routes to Start, which can close the sheet.
if (!(await page.locator('.sheet').isVisible())) await openDiagnostics()
await page.locator('.sheet input[aria-label="Fake kickback in NIM"]').fill('25')
await tapText('Add kickback', '.sheet')
await sleep(400)
const afterReset = await state(s => ({ ready: s.account.readyLuna, ledger: s.plan.ledger.length }))
log('after Reset dry run, a new 25 NIM kickback is ready to share', afterReset.ready === 2500000, JSON.stringify(afterReset))
// Reset removes the fake stake, so the app may route to Start and close the sheet itself.
if (await page.locator('.sheet').isVisible()) await closeSheet().catch(() => {})

console.log('final route', await hash())
await t.finish()
