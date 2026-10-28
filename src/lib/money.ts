// Money maths. Everything is an integer number of Luna (1 NIM = 100,000 Luna).
// No floats ever touch an amount that gets sent.

export const LUNA = 100_000
/** New stakers must stake at least 100 NIM (Policy::MINIMUM_STAKE). */
export const MIN_STAKE_LUNA = 100 * LUNA
/**
 * Kept back in the wallet for fees. Nimiq Pay sends with fee 0 when it can,
 * but a busy mempool can need a small fee; 0.01 NIM covers several transactions.
 */
export const FEE_RESERVE_LUNA = 1_000

export function toLuna(nim: number): number {
  return Math.round(nim * LUNA)
}

/** Parse what the user typed ("1,234.5") into Luna; invalid input gives 0. Max 5 decimals. */
export function parseNimInput(text: string): number {
  const clean = text.replace(/[,\s]/g, '')
  if (!/^\d*(\.\d{0,5})?$/.test(clean) || clean === '' || clean === '.') return 0
  const [i, d = ''] = clean.split('.')
  return Number(i || '0') * LUNA + Number((d + '00000').slice(0, 5))
}

/**
 * Split `total` Luna by integer percentages (summing to 100). Every slice is
 * floored and the rounding remainder goes to the last slice, so the parts
 * always add up to exactly `total`.
 */
export function splitLuna(total: number, pcts: readonly number[]): number[] {
  if (!Number.isInteger(total) || total < 0) throw new Error('total must be a non-negative integer of Luna')
  const sum = pcts.reduce((a, b) => a + b, 0)
  if (!pcts.length) return []
  if (sum <= 0) return pcts.map((_, i) => (i === pcts.length - 1 ? total : 0))
  const parts = pcts.map(p => Math.floor(total * p / sum))
  const used = parts.reduce((a, b) => a + b, 0)
  parts[parts.length - 1] += total - used
  return parts
}

/** What can be spent from the wallet after keeping the fee reserve. */
export function spendable(balanceLuna: number, reserve = FEE_RESERVE_LUNA): number {
  return Math.max(0, balanceLuna - reserve)
}

/** "Max" on the stake screen. */
export function maxStake(balanceLuna: number): number {
  return spendable(balanceLuna)
}

export type StakeCheck = 'ok' | 'zero' | 'below-min' | 'over-balance' | 'balance-below-min'

/** Validate a stake amount. New stakers need 100 NIM; adding to an existing stake only needs > 0. */
export function checkStake(amountLuna: number, balanceLuna: number, isNewStaker: boolean): StakeCheck {
  const max = maxStake(balanceLuna)
  const min = isNewStaker ? MIN_STAKE_LUNA : 1
  // The wallet can't reach the minimum at all: say that first, whatever was typed.
  if (isNewStaker && max < MIN_STAKE_LUNA) return 'balance-below-min'
  if (amountLuna === 0) return 'zero'
  if (amountLuna < min) return 'below-min'
  if (amountLuna > max) return 'over-balance'
  return 'ok'
}

/**
 * How much a plan run shares: what's ready, capped by what the wallet can
 * actually spend. `capped` explains a lower amount to the user.
 */
export function runAmount(readyLuna: number, balanceLuna: number): { amount: number, capped: boolean } {
  const can = spendable(balanceLuna)
  const amount = Math.max(0, Math.min(readyLuna, can))
  return { amount, capped: amount < readyLuna }
}

// ---------- ready-to-share ledger ----------

/** `dry`: a dry-run fake. `manual`: a testnet test kickback marked in Diagnostics. Both count once a plan exists. */
export interface KickbackLike { at: number, luna: number, restaked?: boolean, dry?: boolean, manual?: boolean }
/** One shared (or kept) amount. `dry` entries come from dry-run runs and never count against real kickbacks. */
export interface LedgerEntry {
  luna: number
  at: number
  hash?: string
  dry?: boolean
  /** Stable id (uuid): the server's shares row id, so uploads are idempotent. */
  id?: string
  sliceType?: 'send' | 'restake' | 'keep'
  /** The plan run this share belongs to (uuid). */
  runId?: string
}

/**
 * Ready to share = kickbacks that landed in the wallet after the plan started,
 * minus everything already shared (ledger) and everything in flight. Kickbacks
 * paid straight into stake (AddStake) never reach the wallet, so they don't count.
 * Dry-run kickbacks count as soon as a plan exists, whenever they were added.
 * Pass only the ledger entries of the same mode (dry or real) as the kickbacks.
 */
export function readyLuna(kickbacks: readonly KickbackLike[], planStartedAt: number | null, ledger: readonly LedgerEntry[], inFlightLuna = 0): number {
  if (planStartedAt == null) return 0
  const received = kickbacks.filter(k => !k.restaked && (k.dry || k.manual || k.at >= planStartedAt)).reduce((a, k) => a + k.luna, 0)
  const done = ledger.reduce((a, e) => a + e.luna, 0)
  return Math.max(0, received - done - inFlightLuna)
}

/** The ledger entries of one mode: dry run or real. */
export function ledgerFor(ledger: readonly LedgerEntry[], dry: boolean): LedgerEntry[] {
  return ledger.filter(e => !!e.dry === dry)
}
