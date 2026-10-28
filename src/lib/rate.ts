// The Nimiq staking calculator, ported exactly from nimiq.com/staking (Calculator component,
// deployed bundle https://www.nimiq.com/_nuxt/CiCO_E35.js, read 2026-10-28). It is a fork of
// @nimiq/utils calculateStakingRewards
// (https://github.com/nimiq/nimiq-utils/blob/cbaa21306523742783c48be22192e47b2d9ce8d5/src/rewards-calculator/rewards-calculator.ts,
// constants in src/albatross-policy/constants.ts, supply in src/supply-calculator/pos.ts) with one
// difference we keep: the site uses today's daily emission, P(now) - P(now - 1 day), not the first
// day's. The only network input is the staked ratio (nimiq.com reads it from /api/staking-info).
// Per pool: the calculator's gain ratio times (1 - pool fee), auto-restake on (the site default).

const TOTAL_SUPPLY_LUNA = 21e14
const SUPPLY_DECAY = 0.9999999999960264 // per ms
const POS_DECAY_PER_DAY = 0.0003432600460362
const POS_GENESIS_MS = { main: Date.parse('2024-11-19T16:45:20.000Z'), test: Date.parse('2024-11-13T20:00:00.000Z') }
const POS_GENESIS_SUPPLY_NIM = { main: 12_893_109_654.06244, test: 12_030_755_339.52899 }
type Chain = keyof typeof POS_GENESIS_MS

/** x^n by squaring, as in the Rust policy code, so results match across platforms. */
function powi(x: number, n: number): number {
  if (n < 0) { x = 1 / x; n = -n }
  if (!n) return 1
  let y = 1
  while (n > 1) {
    if (n % 2) { y *= x; n -= 1 }
    x *= x
    n /= 2
  }
  return x * y
}

/** Protocol-modelled total supply (NIM) at a time (ms). */
export function posSupplyAt(ms: number, chain: Chain = 'main'): number {
  const g = POS_GENESIS_SUPPLY_NIM[chain]
  return (TOTAL_SUPPLY_LUNA - (TOTAL_SUPPLY_LUNA - g * 1e5) * powi(SUPPLY_DECAY, ms - POS_GENESIS_MS[chain])) / 1e5
}

/**
 * Nimiq staking calculator rate over `days` (365 = a year), after the pool fee.
 * @param stakedRatio staked NIM / supply, 0..1
 * @param fee pool fee, 0..1
 * @returns gain ratio, e.g. 0.0863 = 8.63%, or null for impossible inputs
 */
export function nimiqCalculatorRate(stakedRatio: number, fee = 0, opts: { days?: number, autoRestake?: boolean, now?: number, chain?: Chain } = {}): number | null {
  const { days = 365, autoRestake = true, now = Date.now(), chain = 'main' } = opts
  if (!(stakedRatio > 0 && stakedRatio <= 1) || !(fee >= 0 && fee <= 1)) return null
  const G = POS_GENESIS_SUPPLY_NIM[chain], k = POS_DECAY_PER_DAY
  const r = posSupplyAt(now, chain) - posSupplyAt(now - 86_400_000, chain)
  const d = Math.E ** (-k * days)
  const gain = autoRestake
    ? r / (k * stakedRatio * G) * (1 - d)
    : (1 / stakedRatio) * (Math.log(k * G / d + r / d - r) - k * days - Math.log(k * G))
  return gain * (1 - fee)
}

export const RATE_SOURCE = 'Nimiq staking calculator'
