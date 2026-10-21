import { pulse, reducedMotion } from './anim'
import { K_PATHS } from '../components/klogo'

// One-off effects drawn in a fixed overlay: the coin that drops onto
// "Ready to share" when a kickback lands, the burst around it, and the coin
// that flies from a Stack slice to its destination during Run my plan.
// Plain DOM + WAAPI, removed when done.

let layer: HTMLElement | null = null
export function bindFxLayer(el: HTMLElement | null) { layer = el }

interface Pt { x: number, y: number }

export function pointOf(el: Element, fx = 0.5, fy = 0.5): Pt {
  const L = layer!.getBoundingClientRect(), r = el.getBoundingClientRect()
  return { x: r.left - L.left + r.width * fx, y: r.top - L.top + r.height * fy }
}

function coinEl(size: number) {
  const d = document.createElement('div')
  d.style.cssText = `position:absolute;width:${size}px;height:${size}px;border-radius:50%;background:var(--kb-lime);display:grid;place-items:center;box-shadow:inset 0 1px 0 rgba(255,255,255,.6),0 6px 16px rgba(0,0,0,.45)`
  const s = Math.round(size * 0.5)
  d.innerHTML = `<svg width="${s}" height="${s}" viewBox="0 0 300 300" style="fill:var(--kb-bg)">${K_PATHS.map(p => p.svg).join('')}</svg>`
  return d
}

export function fxCoin(p0: Pt, p1: Pt, done?: () => void, kind: 'drop' | 'fly' = 'fly') {
  if (!layer || reducedMotion()) { done?.(); return }
  const c = coinEl(28)
  c.style.left = (p0.x - 14) + 'px'
  c.style.top = (p0.y - 14) + 'px'
  layer.appendChild(c)
  const dx = p1.x - p0.x, dy = p1.y - p0.y
  const frames: Keyframe[] = kind === 'drop'
    ? [{ transform: 'translateY(0) scale(.7)', opacity: 0 }, { transform: `translateY(${dy * 0.2}px) scale(1)`, opacity: 1, offset: 0.2 }, { transform: `translateY(${dy}px) scale(1)`, opacity: 1, offset: 0.82 }, { transform: `translateY(${dy}px) scale(.4)`, opacity: 0 }]
    : [{ transform: 'translate(0,0) scale(.6)', opacity: 0 }, { transform: `translate(${dx * 0.15}px,${dy * 0.15 - 20}px) scale(1)`, opacity: 1, offset: 0.2 }, { transform: `translate(${dx * 0.65}px,${dy * 0.65 - 34}px) scale(1)`, opacity: 1, offset: 0.65 }, { transform: `translate(${dx}px,${dy}px) scale(.5)`, opacity: 0.3 }]
  const a = c.animate(frames, { duration: kind === 'drop' ? 620 : 700, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' })
  a.onfinish = () => { c.remove(); done?.() }
}

export function burst(p: Pt) {
  if (!layer || reducedMotion()) return
  for (let i = 0; i < 12; i++) {
    const d = document.createElement('div')
    const a = i / 12 * Math.PI * 2 + 0.2, dist = 26 + (i % 3) * 10, sz = i % 4 === 0 ? 7 : 5
    d.style.cssText = `position:absolute;left:${p.x - sz / 2}px;top:${p.y - sz / 2}px;width:${sz}px;height:${sz}px;border-radius:50%;background:${i % 2 ? 'var(--kb-accent)' : 'var(--kb-lime)'}`
    layer.appendChild(d)
    d.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(a) * dist}px,${Math.sin(a) * dist}px) scale(.3)`, opacity: 0 }], { duration: 560 + (i % 3) * 60, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).onfinish = () => d.remove()
  }
}

/** A coin flies from a Run my plan slice to its destination bubble. */
export function fxStep(type: 'send' | 'restake') {
  if (!layer) return
  const from = document.querySelector(`[data-kb-run-slice="${type === 'send' ? 0 : 1}"]`)
  const to = document.querySelector(`[data-kb-dest="${type}"]`)
  if (!from || !to) return
  fxCoin(pointOf(from, 0.82, 0.45), pointOf(to), () => pulse(to))
}

/** The coin drop onto "Ready to share", then a burst. */
export function fxArrival(land: () => void) {
  const amt = document.querySelector('[data-kb="ready-amt"]')
  if (!amt || !layer || reducedMotion()) { land(); return }
  const to = pointOf(amt, 0.25, 0.5)
  fxCoin({ x: to.x, y: to.y - 160 }, to, () => {
    land()
    burst(pointOf(amt, 0.3, 0.5))
    pulse(amt)
  }, 'drop')
}
