// Generates the six Season Stack skins once, from the prototype's fixed seeds, as static CSS.
// Run: node scripts/gen-skins.mjs. The output (src/design/skins.css) is committed; the app never
// re-randomises a tile. Each skin is one seamless 48px tile in the hatch's three inks:
//   dark   = bg @ 16% (lime cards)    second = text @ 20% (blue cards)    light = text @ 20% (raised)
// Applying a skin = <html data-kb-skin="bounce">, which swaps the --kb-hatch-* inks everywhere.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const INK = { text: '#F2F4FF', bg: '#0B0D1C' }
const rng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
const f = v => v.toFixed(2)

// Spark: the app's hatch (same seed and maths as scripts/gen-hatch.mjs).
function hatchGeom() {
  const r = rng(20261021)
  const n = 5, R2 = Math.SQRT2
  let sp = Array.from({ length: n }, () => 5 + r() * 3)
  const k = (48 / R2) / sp.reduce((a, b) => a + b)
  sp = sp.map(v => v * k)
  let c = r() * 12
  const L = 48 * R2, lines = []
  for (let i = 0; i < n; i++) {
    c += sp[i] * R2
    const a = (45 + (r() * 6 - 3)) * Math.PI / 180, dx = Math.cos(a), dy = -Math.sin(a), nx = Math.sin(a), ny = Math.cos(a)
    const cx = c / 2, cy = c / 2
    const t0 = r() < 0.4 ? 0.06 + r() * 0.22 : r() * 0.03, t1 = r() < 0.4 ? 0.06 + r() * 0.22 : r() * 0.03
    const ph1 = r() * 6.28, ph2 = r() * 6.28, amp1 = 0.35 + r() * 0.35, amp2 = 0.15 + r() * 0.2
    const pts = []
    for (let j = 0; j <= 24; j++) {
      const t = t0 + (1 - t0 - t1) * j / 24, s = (t - 0.5) * L
      const w = amp1 * Math.sin(Math.PI * 2 * t + ph1) + amp2 * Math.sin(Math.PI * 5 * t + ph2)
      pts.push([cx + dx * s + nx * w, cy + dy * s + ny * w])
    }
    const chunks = [[0, 9], [8, 17], [16, 24]].map(([s0, s1]) => ({ w: 1 + r() * 1.2, d: 'M' + pts.slice(s0, s1 + 1).map(p => f(p[0]) + ' ' + f(p[1])).join('L') }))
    lines.push({ op: 0.7 + r() * 0.3, chunks })
  }
  return lines
}

// Bounce, Rally, Surge, Legend: the prototype's skinGeom (design/Kickback Prototype.html), same seeds.
function skinGeom(k) {
  const r = rng({ bounce: 7302, rally: 7303, surge: 7304, legend: 7305 }[k]), TAU = Math.PI * 2, g = []
  const chunked = (pts, cuts, wMin, wSpan) => cuts.map(([a, b]) => ({ w: wMin + r() * wSpan, d: 'M' + pts.slice(a, b + 1).map(q => f(q[0]) + ' ' + f(q[1])).join('L') }))
  if (k === 'bounce') {
    for (let i = 0; i < 16; i++) g.push({ dot: true, x: r() * 48, y: r() * 48, rx: 1.1 + r() * .9, ry: 1 + r() * .8, op: .75 + r() * .25 })
  }
  else if (k === 'rally') {
    for (let i = 0; i < 4; i++) {
      const y0 = 6 + i * 12 + (r() * 2 - 1), a = 1.6 + r() * .8, p1 = r() * TAU, p2 = r() * TAU, b = .3 + r() * .3, pts = []
      for (let x = 0; x <= 48; x += 2) pts.push([x, y0 + a * Math.sin(TAU * x / 24 + p1) + b * Math.sin(TAU * x / 16 + p2)])
      g.push({ op: .7 + r() * .3, chunks: chunked(pts, [[0, 9], [8, 17], [16, 24]], 1, 1.2) })
    }
  }
  else if (k === 'surge') {
    for (let i = 0; i < 4; i++) {
      const y0 = 6 + i * 12, a = 2.2 + r() * .6, jit = Array.from({ length: 8 }, () => r() * 1.2 - .6), pts = []
      for (let j = 0; j <= 8; j++) pts.push([j * 6, y0 + (j % 2 ? -a : a) + jit[j % 8]])
      g.push({ op: .7 + r() * .3, chunks: chunked(pts, [[0, 3], [3, 6], [6, 8]], 1.1, 1) })
    }
  }
  else if (k === 'legend') {
    for (let i = 0; i < 11; i++) {
      const x = r() * 48, y = r() * 48, ang = r() * TAU, L = 4 + r() * 4, bend = (r() * 2 - 1) * 4, dx = Math.cos(ang) * L / 2, dy = Math.sin(ang) * L / 2, nx = -Math.sin(ang) * bend, ny = Math.cos(ang) * bend
      g.push({ op: .7 + r() * .3, chunks: [{ w: 1.2 + r() * .9, d: `M${f(x - dx)} ${f(y - dy)}Q${f(x + nx)} ${f(y + ny)} ${f(x + dx)} ${f(y + dy)}` }] })
    }
  }
  return g
}

function body(list, color, alpha) {
  return list.map(l => l.dot
    ? `<ellipse cx='${f(l.x)}' cy='${f(l.y)}' rx='${f(l.rx)}' ry='${f(l.ry)}' fill='${color}' stroke='none' opacity='${Math.min(1, l.op * alpha * 1.5).toFixed(3)}'/>`
    : `<g opacity='${(l.op * alpha).toFixed(3)}'>${l.chunks.map(c => `<path d='${c.d}' stroke-width='${c.w.toFixed(2)}'/>`).join('')}</g>`).join('')
}

function skinSvg(k, color, alpha) {
  const inner = k === 'spark' ? body(hatchGeom(), color, alpha)
    : k === 'kick' ? body(hatchGeom(), color, alpha) + `<g transform='matrix(-1 0 0 1 48 0)'>${body(hatchGeom(), color, alpha)}</g>`
      : body(skinGeom(k), color, alpha)
  let uses = ''
  ;[-48, 0, 48].forEach(x => [-48, 0, 48].forEach(y => { uses += `<use href='#h' xlink:href='#h' x='${x}' y='${y}'/>` }))
  return `<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' width='48' height='48' viewBox='0 0 48 48'><defs><g id='h' fill='none' stroke='${color}' stroke-linecap='round' stroke-linejoin='round'>${inner}</g></defs>${uses}</svg>`
}
const uri = (k, color, alpha) => `url("data:image/svg+xml,${encodeURIComponent(skinSvg(k, color, alpha))}")`

const SKINS = ['spark', 'kick', 'bounce', 'rally', 'surge', 'legend']
let css = `/* GENERATED by scripts/gen-skins.mjs. Do not edit by hand.
   Season 1 Stack skins: one fixed seamless 48px tile each (prototype seeds), in the hatch inks.
   Spark is the default hatch. <html data-kb-skin="..."> swaps the --kb-hatch-* inks app-wide. */
:root {
`
for (const k of SKINS) css += `  --kb-skin-${k}-dark: ${uri(k, INK.bg, 0.16)};\n  --kb-skin-${k}-second: ${uri(k, INK.text, 0.2)};\n  --kb-skin-${k}-light: ${uri(k, INK.text, 0.2)};\n`
css += '}\n'
for (const k of SKINS.slice(1)) css += `:root[data-kb-skin="${k}"] { --kb-hatch-dark: var(--kb-skin-${k}-dark); --kb-hatch-second: var(--kb-skin-${k}-second); --kb-hatch-light: var(--kb-skin-${k}-light); }\n`
css += `/* Legend: a soft lime glow on Stack cards. */
:root { --kb-legend-glow: inset 0 0 0 1px rgba(200, 240, 74, .55), 0 0 18px rgba(200, 240, 74, .22); }
:root[data-kb-skin="legend"] .stack .card { box-shadow: var(--kb-legend-glow); }
`
writeFileSync(join(here, '..', 'src', 'design', 'skins.css'), css)
console.log('wrote src/design/skins.css')
