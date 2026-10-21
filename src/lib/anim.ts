// WAAPI helpers. Everything here animates transform and opacity only, so it
// runs on the compositor and never re-renders Vue components per frame.

export const EASE = 'cubic-bezier(.2,.8,.2,1)'
export const EASE_PAGE = 'cubic-bezier(.32,.72,0,1)'

export type Running = [Animation, HTMLElement]

export function anim(list: Running[], el: HTMLElement | null | undefined, frames: Keyframe[], ms: number, easing = EASE_PAGE) {
  if (!el) return
  el.style.willChange = 'transform, opacity'
  list.push([el.animate(frames, { duration: ms, easing, fill: 'both' }), el])
}

export function settle(list: Running[]): Promise<void> {
  if (!list.length) return Promise.resolve()
  return Promise.all(list.map(([a]) => a.finished.catch(() => undefined))).then(() => undefined)
}

/** Drop finished animations once the resting inline styles match their end state. */
export function release(list: Running[]) {
  list.forEach(([a, el]) => {
    try { a.cancel() }
    catch { /* already gone */ }
    el.style.willChange = ''
  })
}

/** Follow one pointer until it lifts. */
export function track(move: (e: PointerEvent) => void, up: (e: PointerEvent) => void) {
  const fin = (e: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', fin)
    window.removeEventListener('pointercancel', fin)
    up(e)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', fin)
  window.addEventListener('pointercancel', fin)
}

export function reducedMotion(): boolean {
  return document.documentElement.getAttribute('data-kb-rm') === '1'
}

export function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3)
}

/** Error shake: 3 cycles of 6px, 300ms. */
export function shake(el: Element | null | undefined) {
  if (!el || reducedMotion()) return
  el.animate([0, -6, 6, -6, 6, -6, 6, 0].map(x => ({ transform: `translateX(${x}px)` })), { duration: 300, easing: 'ease-in-out' })
}

export function pulse(el: Element | null | undefined) {
  if (!el || reducedMotion()) return
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.16)' }, { transform: 'scale(1)' }], { duration: 340, easing: EASE })
}

export function bump(el: Element | null | undefined) {
  if (!el || reducedMotion()) return
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.01)' }, { transform: 'scale(1)' }], { duration: 280, easing: EASE })
}
