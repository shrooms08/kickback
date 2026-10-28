// Tier badge frames and the 7-segment streak ring, ported from the prototype (SVG data URIs).
const LIME = '#C8F04A', TEXT3 = '#5D6380', BG = '#0B0D1C'
const KPATH = "<rect width='100' height='100' rx='4'/><rect y='200' width='100' height='100' rx='4'/><path d='M100 104Q100 100 104 100L137 100A63 63 0 0 0 200 37L200 4Q200 0 204 0L296 0Q300 0 300 4L300 39A161 161 0 0 1 139 200L104 200Q100 200 100 196Z'/><path d='M200 296L200 204Q200 200 204 200.1A100 100 0 0 1 299.9 296Q300 300 296 300L204 300Q200 300 200 296Z'/>"
const svgUri = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
const memo = new Map<string, string>()

/** Badge for tier i (0 Spark .. 5 Legend): circle, rounded square, hexagon, shield, diamond, star. */
export function badgeUri(i: number, on: boolean): string {
  const key = `b${i}${on}`
  if (memo.has(key)) return memo.get(key)!
  const ink = on ? LIME : TEXT3, S = `fill='none' stroke='${ink}' stroke-width='2.5' stroke-linejoin='round'`
  const star = Array.from({ length: 16 }, (_, j) => { const a = -Math.PI / 2 + j * Math.PI / 8, R = j % 2 ? 11.5 : 18; return (j ? 'L' : 'M') + (20 + R * Math.cos(a)).toFixed(2) + ' ' + (20 + R * Math.sin(a)).toFixed(2) }).join('') + 'Z'
  const frames = [
    `<circle cx='20' cy='20' r='16.5' ${S}/>`,
    `<rect x='4' y='4' width='32' height='32' rx='9' ${S}/>`,
    `<path d='M20 3.5L34.3 11.75V28.25L20 36.5L5.7 28.25V11.75Z' ${S}/>`,
    `<path d='M20 3.5L33.5 8V19C33.5 27.5 27.8 33.6 20 36.5C12.2 33.6 6.5 27.5 6.5 19V8Z' ${S}/>`,
    `<path d='M20 2.5L37.5 20L20 37.5L2.5 20Z' ${S}/><path d='M20 8L32 20L20 32L8 20Z' fill='none' stroke='${ink}' stroke-width='1.2' opacity='.6' stroke-linejoin='round'/>`,
    `<path d='${star}' fill='${ink}'/>`,
  ]
  const mark = i === 5 ? BG : ink
  const uri = svgUri(`<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'>${frames[i] ?? frames[0]}<g transform='translate(14.5 14.5) scale(.0367)' fill='${mark}'>${KPATH}</g></svg>`)
  memo.set(key, uri)
  return uri
}

/** 7-segment ring, `filled` segments lime: progress to the next 7 in a row. */
export function ringUri(filled: number, total = 7): string {
  const key = `r${filled}/${total}`
  if (memo.has(key)) return memo.get(key)!
  const R = 8.5, gap = 0.34
  let d = ''
  for (let i = 0; i < total; i++) {
    const a0 = -Math.PI / 2 + i * 2 * Math.PI / total + gap / 2, a1 = -Math.PI / 2 + (i + 1) * 2 * Math.PI / total - gap / 2
    d += `<path d='M${(11 + R * Math.cos(a0)).toFixed(2)} ${(11 + R * Math.sin(a0)).toFixed(2)}A${R} ${R} 0 0 1 ${(11 + R * Math.cos(a1)).toFixed(2)} ${(11 + R * Math.sin(a1)).toFixed(2)}' stroke='${i < filled ? LIME : TEXT3}' stroke-width='3' fill='none' stroke-linecap='round'/>`
  }
  const uri = svgUri(`<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'>${d}</svg>`)
  memo.set(key, uri)
  return uri
}

/** Ring fill for a streak: 0 shows empty, every 7th shows full. */
export const ringFill = (n: number) => (n > 0 && n % 7 === 0 ? 7 : n % 7)
