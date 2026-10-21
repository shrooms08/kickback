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

/** Longest duration in a list of running animations (ms). */
export function longest(list: Running[]): number {
  return list.reduce((m, [a]) => Math.max(m, Number(a.effect?.getTiming().duration) || 0), 0)
}

/**
 * Settle, but never wait longer than the longest animation + 150 ms. WAAPI
 * `finished` can stall in a WebView (paused tab, detached element, a host
 * overlay) and a stuck promise must never keep the app locked.
 */
export function settleWithin(list: Running[], extra = 150): Promise<'finished' | 'timeout'> {
  if (!list.length) return Promise.resolve('finished')
  return Promise.race([
    settle(list).then(() => 'finished' as const),
    new Promise<'timeout'>(r => setTimeout(() => r('timeout'), longest(list) + extra)),
  ])
}

/** Drop finished animations once the resting inline styles match their end state. */
export function release(list: Running[]) {
  list.forEach(([a, el]) => {
    try { a.cancel() }
    catch { /* already gone */ }
    el.style.willChange = ''
  })
}

/**
 * Follow one pointer (by pointerId) until it lifts or is cancelled. Events
 * from other pointers are ignored, so a gesture can never eat another tap.
 * If a *new* touch starts while this one is still open (its end never came,
 * e.g. the host took it for the system back gesture), `abandon` runs instead
 * of `up`. Returns a function that stops tracking without calling either.
 */
export function track(pointerId: number, move: (e: PointerEvent) => void, up: (e: PointerEvent) => void, abandon?: () => void): () => void {
  const mine = (e: PointerEvent) => e.pointerId === pointerId
  const onMove = (e: PointerEvent) => { if (mine(e)) move(e) }
  const fin = (e: PointerEvent) => { if (!mine(e)) return; stop(); up(e) }
  const other = (e: PointerEvent) => { if (mine(e)) return; stop(); abandon?.() }
  const stop = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', fin)
    window.removeEventListener('pointercancel', fin)
    window.removeEventListener('pointerdown', other, true)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', fin)
  window.addEventListener('pointercancel', fin)
  window.addEventListener('pointerdown', other, true)
  return stop
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
