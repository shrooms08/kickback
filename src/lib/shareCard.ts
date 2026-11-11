// The share card: a portrait 1080x1350 PNG drawn on a canvas. NIM amounts only (never dollars),
// the plan's Stack in the current skin, the streak, and the invite code and link.
import { nim2 } from './format'
import { K_PATHS } from '../components/klogo'
import type { Skin } from '../stores/season'

export interface ShareInput {
  earnedNim: number
  kickbacks: number
  streak: number
  code: string
  link: string
  /** The plan's visible slices, biggest first gets lime. */
  slices: Array<{ pct: number, label: string }>
}

export function shareCardText(i: ShareInput) {
  return {
    eyebrow: 'KICKBACK PAID ME',
    amount: `${nim2(i.earnedNim)} NIM`,
    sub: `from ${i.kickbacks} kickback${i.kickbacks === 1 ? '' : 's'}`,
    streak: i.streak > 0 ? `${i.streak} in a row` : '',
    code: i.code,
    link: i.link.replace(/^https?:\/\//, ''),
    cta: 'Stake once. Get your kickback twice a day.',
  }
}

const W = 1080, H = 1350
const C = { bg: '#0B0D1C', surface: '#161A30', raised: '#1F2440', lime: '#C8F04A', second: '#4C77F0', text: '#F2F4FF', text2: '#A3A9C9', line: 'rgba(242,244,255,.12)' }

function cssUrl(name: string): string | null {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const m = /^url\("(.+)"\)$/.exec(v)
  return m ? m[1] : null
}

/** Fonts and skin tiles get this long; then the card is drawn without them. */
export const CARD_WAIT_MS = 5000

/** Resolve with `p`, or reject after `ms` (the card never waits forever on a WebView). */
export function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const t = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}: no answer after ${ms / 1000} s`)), ms) })
  return Promise.race([p, t]).finally(() => clearTimeout(timer))
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('skin tile did not load'))
    img.src = src
  })
}

/**
 * A skin tile as something a pattern can use. WebKit (iPhone, Nimiq Pay) taints a canvas that
 * draws an SVG image directly, and toBlob then throws SecurityError; an ImageBitmap made from
 * the same SVG does not taint (checked in Playwright WebKit). Falls back to the image itself.
 */
async function loadTile(src: string): Promise<CanvasImageSource> {
  const img = await loadImage(src)
  if (typeof createImageBitmap !== 'function') return img
  try { return await createImageBitmap(img) }
  catch { return img }
}

export type CardIssue = (what: string, error: unknown) => void

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawK(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 300, size / 300)
  ctx.fillStyle = color
  for (const p of K_PATHS) {
    if (p.tag === 'path') ctx.fill(new Path2D(String((p.attrs as Record<string, unknown>).d)))
    else {
      const a = p.attrs as Record<string, number | string>
      roundRect(ctx, Number(a.x ?? 0), Number(a.y ?? 0), Number(a.width), Number(a.height), Number(a.rx ?? 0))
      ctx.fill()
    }
  }
  ctx.restore()
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((res, rej) => {
    // A tainted canvas throws SecurityError here (WebKit) instead of calling back.
    try { canvas.toBlob(b => (b ? res(b) : rej(new Error('toBlob returned no image'))), 'image/png') }
    catch (error) { rej(error) }
  })
}

/**
 * Render the card. Resolves to a PNG blob. Fonts and skin tiles wait at most 5 s each. If the
 * PNG can't be made (tainted canvas, toBlob failure), the card is drawn again with solid fills
 * only (no skin pattern tiles) and tried once more. `onIssue` hears about every problem.
 */
export async function renderShareCard(input: ShareInput, skin: Skin, onIssue: CardIssue = () => {}): Promise<Blob> {
  try { await within(Promise.resolve(document.fonts?.ready), CARD_WAIT_MS, 'document.fonts.ready') }
  catch (error) { onIssue('share card fonts (system font used)', error) }
  const tiles = await Promise.all(['dark', 'second', 'light'].map(async (k) => {
    const u = cssUrl(`--kb-skin-${skin}-${k}`)
    if (!u) return null
    try { return await within(loadTile(u), CARD_WAIT_MS, `skin tile ${skin}-${k}`) }
    catch (error) { onIssue(`share card skin tile ${skin}-${k}`, error); return null }
  }))
  try { return await toPng(drawCard(input, skin, tiles)) }
  catch (error) {
    onIssue('share card PNG with skin tiles (retrying with solid fills)', error)
    return await toPng(drawCard(input, skin, [null, null, null]))
  }
}

function drawCard(input: ShareInput, skin: Skin, tiles: Array<CanvasImageSource | null>): HTMLCanvasElement {
  const t = shareCardText(input)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2D context unavailable')
  const F = (w: number, px: number) => `${w} ${px}px Archivo, system-ui, sans-serif`

  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, H)
  // soft blobs
  const blob = (x: number, y: number, r: number, color: string) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r) }
  blob(920, 260, 420, 'rgba(76,119,240,.28)')
  blob(140, 900, 380, 'rgba(200,240,74,.12)')

  // header: K tile + wordmark
  ctx.fillStyle = C.lime
  roundRect(ctx, 88, 88, 96, 96, 22)
  ctx.fill()
  drawK(ctx, 110.5, 110.5, 51, C.bg)
  ctx.fillStyle = C.text
  ctx.font = F(800, 44)
  ctx.textBaseline = 'middle'
  ctx.fillText('Kickback', 212, 138)

  // headline
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#8BA6F6'
  ctx.font = F(700, 34)
  ctx.fillText(t.eyebrow.split('').join(String.fromCharCode(8202)), 88, 330)
  ctx.fillStyle = C.lime
  let size = 150
  ctx.font = F(900, size)
  while (ctx.measureText(t.amount).width > W - 176 && size > 70) { size -= 6; ctx.font = F(900, size) }
  ctx.fillText(t.amount, 88, 330 + size + 10)
  ctx.fillStyle = C.text2
  ctx.font = F(600, 40)
  ctx.fillText(t.sub, 88, 330 + size + 80)

  // the Stack, in the current skin
  const top = 700, cardH = 110, overlap = 16
  const fills = [C.lime, C.second, C.raised]
  const order = input.slices.map((s, i) => ({ ...s, i })).sort((a, b) => b.pct - a.pct)
  for (let r = order.length - 1; r >= 0; r--) {
    const s = order[r], y = top + r * (cardH - overlap), x = 88, w = W - 176
    ctx.save()
    roundRect(ctx, x, y, w, cardH, 30)
    ctx.fillStyle = fills[r]
    ctx.fill()
    ctx.clip()
    const tile = tiles[r]
    if (tile) {
      const pat = ctx.createPattern(tile, 'repeat')
      if (pat) {
        pat.setTransform?.(new DOMMatrix().scale(2.25))
        ctx.fillStyle = pat
        ctx.fillRect(x, y, w * Math.max(0, Math.min(100, s.pct)) / 100, cardH)
      }
    }
    if (skin === 'legend') { ctx.strokeStyle = 'rgba(200,240,74,.55)'; ctx.lineWidth = 3; roundRect(ctx, x + 1.5, y + 1.5, w - 3, cardH - 3, 29); ctx.stroke() }
    ctx.restore()
    ctx.fillStyle = r === 0 ? C.bg : C.text
    ctx.font = F(900, 46)
    ctx.textBaseline = 'middle'
    ctx.fillText(`${s.pct}%`, x + 36, y + cardH / 2 + (r < order.length - 1 ? -overlap / 2 : 0))
    ctx.font = F(700, 34)
    ctx.fillText(s.label, x + 170, y + cardH / 2 + (r < order.length - 1 ? -overlap / 2 : 0))
    ctx.textBaseline = 'alphabetic'
  }

  // streak + invite
  const by = 1100
  if (t.streak) {
    ctx.fillStyle = C.text
    ctx.font = F(800, 40)
    ctx.fillText(t.streak, 88, by)
    ctx.fillStyle = C.text2
    ctx.font = F(600, 30)
    ctx.fillText('kickbacks shared on time', 88, by + 44)
  }
  ctx.fillStyle = C.surface
  roundRect(ctx, 88, 1190, W - 176, 92, 46)
  ctx.fill()
  ctx.fillStyle = C.lime
  ctx.font = F(800, 36)
  ctx.textBaseline = 'middle'
  ctx.fillText(t.code, 128, 1236)
  ctx.fillStyle = C.text2
  ctx.font = F(600, 28)
  const lw = ctx.measureText(t.link).width
  ctx.fillText(t.link, W - 128 - lw, 1236)
  return canvas
}
