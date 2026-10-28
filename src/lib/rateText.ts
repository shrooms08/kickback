/** "about 8.6% a year" (one decimal), or '' when the rate is unknown. */
export function rateText(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return ''
  return `about ${(Math.round(rate * 1000) / 10).toFixed(1)}% a year`
}
