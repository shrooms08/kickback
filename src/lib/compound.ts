/**
 * How much more the plan earns in a year by restaking part of every kickback, on top of the
 * rewards the stake would earn anyway. Each of the n payouts pays i = apy / n of the stake and
 * restakes r of it, so the stake grows by (1 + i r) per payout. Rewards over the year are
 * (S_n - S) / r; without restaking they are S * apy.
 */
export function compoundExtra(stakeNim: number, apyNet: number, restakePct: number, perYear: number): number {
  const r = restakePct / 100
  if (!(stakeNim > 0) || !(apyNet > 0) || !(r > 0) || !(perYear > 0)) return 0
  const i = apyNet / perYear
  const grown = stakeNim * (1 + i * r) ** perYear
  return Math.max(0, (grown - stakeNim) / r - stakeNim * apyNet)
}
