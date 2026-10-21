// The Stack maths, ported from the prototype. A plan is three slices that
// always add up to 100: [send, restake, keep].

export type Split = [number, number, number]

/** Rank 0 = biggest slice. Ties keep slice order. */
export function ranksOf(p: readonly number[]): number[] {
  const order = [0, 1, 2].sort((x, y) => p[y] - p[x] || x - y)
  const r: number[] = []
  order.forEach((idx, k) => { r[idx] = k })
  return r
}

/** Set slice i to v and share the rest between the other two in proportion. */
export function rebalance(i: number, v: number, base: readonly number[]): Split {
  v = Math.max(0, Math.min(100, v))
  const o = [0, 1, 2].filter(j => j !== i)
  const rem = 100 - v
  const sum = base[o[0]] + base[o[1]]
  const a = sum > 0 ? Math.round(rem * base[o[0]] / sum) : Math.round(rem / 2)
  const r = base.slice() as Split
  r[i] = v; r[o[0]] = a; r[o[1]] = rem - a
  return r
}

/** Same as rebalance, but every slice lands on a multiple of 5. */
export function snap5(i: number, v: number, base: readonly number[]): Split {
  v = Math.max(0, Math.min(100, Math.round(v / 5) * 5))
  const o = [0, 1, 2].filter(j => j !== i)
  const rem = 100 - v
  const sum = base[o[0]] + base[o[1]]
  const a = sum > 0 ? Math.round(rem * base[o[0]] / sum / 5) * 5 : Math.round(rem / 10) * 5
  const r = base.slice() as Split
  r[i] = v; r[o[0]] = a; r[o[1]] = rem - a
  return r
}

/** Splits an amount (in cents of NIM) so the three parts always add up exactly. Returns NIM. */
export function splitCents(totalCents: number, p: readonly number[]): Split {
  const a = Math.round(totalCents * p[0] / 100)
  const b = Math.round(totalCents * p[1] / 100)
  return [a / 100, b / 100, (totalCents - a - b) / 100]
}

export function sameSplit(a: readonly number[], b: readonly number[]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}
