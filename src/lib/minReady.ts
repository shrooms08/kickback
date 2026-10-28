import { nim2 } from './format'

// "Run when ready reaches": the plan only runs once this much (Luna) is ready to share, so tiny
// kickbacks don't cost a fee each. 0.10 / 1 / 5 NIM; 0.10 by default.
export const MIN_READY_CHOICES = [10_000, 100_000, 500_000] as const
export const DEFAULT_MIN_READY = 10_000

/** "0.10", "1", "5": two decimals below 1 NIM, whole numbers above. */
export function minLabel(luna: number): string {
  return luna < 100_000 ? nim2(luna / 1e5) : String(luna / 1e5)
}

/** Home collecting bar: something is ready, but not yet the minimum. */
export function collecting(readyLuna: number, minLuna: number): { on: boolean, pct: number, have: string, need: string } {
  const on = readyLuna > 0 && readyLuna < minLuna
  return { on, pct: on ? Math.round(readyLuna / minLuna * 100) : 0, have: nim2(readyLuna / 1e5), need: minLabel(minLuna) }
}
