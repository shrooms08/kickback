import { nim2 } from './format'

/** A dollar line for a NIM amount, or '' when it is below $0.01 (never show "$0.00"). */
export function usd(nim: number, price: number): string {
  const v = nim * price
  return v >= 0.01 - 1e-12 ? '$' + nim2(v) : ''
}
