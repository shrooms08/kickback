import { easeOutCubic, reducedMotion } from './anim'

/**
 * Last value each count-up showed, by id. Lives for the whole session, so a
 * number only animates on first load or when its value really changes, never
 * just because a tab was switched and the screen remounted.
 */
const shown = new Map<string, number>()

export function lastShown(id: string): number | undefined {
  return shown.get(id)
}

export function markShown(id: string, value: number) {
  shown.set(id, value)
}

/**
 * Tween a number by writing straight into text nodes. No reactive state
 * changes per frame, so nothing else re-renders. Returns a cancel function.
 */
export function tweenText(from: number, to: number, ms: number, write: (v: number) => void, delay = 0): () => void {
  if (reducedMotion() || ms <= 0 || from === to) {
    write(to)
    return () => {}
  }
  let raf = 0
  const t0 = performance.now() + delay
  write(from)
  const tick = (now: number) => {
    const k = Math.max(0, Math.min(1, (now - t0) / ms))
    write(from + (to - from) * easeOutCubic(k))
    if (k < 1) raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}
