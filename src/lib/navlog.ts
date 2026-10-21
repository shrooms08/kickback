import { reactive } from 'vue'

// What the Diagnostics sheet shows about navigation: whether the transition
// lock is held (and since when), the last taps with what was under the finger,
// and the last navigation events. Small and always on, so "Copy all" from a
// phone explains a dead tap.

export interface TapEntry { t: number, x: number, y: number, type: string, hit: string }
export interface NavEntry { t: number, what: string }

export const navlog = reactive({
  locked: false,
  lockedAt: 0,
  lockReason: '',
  /** When the lock is force-released if nothing releases it first. */
  lockDeadline: 0,
  taps: [] as TapEntry[],
  events: [] as NavEntry[],
})

export function logNav(what: string) {
  navlog.events.push({ t: Date.now(), what })
  if (navlog.events.length > 10) navlog.events.splice(0, navlog.events.length - 10)
}

export function describeEl(el: Element | null): string {
  if (!el) return 'nothing'
  const parts: string[] = []
  let e: Element | null = el
  for (let i = 0; e && i < 3; i++, e = e.parentElement) {
    const cls = typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
    const label = e.getAttribute('aria-label') ? `[${e.getAttribute('aria-label')}]` : ''
    const layer = e.getAttribute('data-kb-layer') ? `{${e.getAttribute('data-kb-layer')}}` : ''
    parts.push(`${e.tagName.toLowerCase()}${cls}${label}${layer}`)
  }
  return parts.join(' < ')
}

/** Record every pointerdown/click (capture phase) with what elementFromPoint returns there. */
export function startTapLog() {
  const record = (type: string) => (e: Event) => {
    const p = e as PointerEvent
    if (typeof p.clientX !== 'number') return
    navlog.taps.push({ t: Date.now(), x: Math.round(p.clientX), y: Math.round(p.clientY), type: type + (p.pointerType ? ':' + p.pointerType : ''), hit: describeEl(document.elementFromPoint(p.clientX, p.clientY)) })
    if (navlog.taps.length > 15) navlog.taps.splice(0, navlog.taps.length - 15)
  }
  window.addEventListener('pointerdown', record('down'), { capture: true, passive: true })
  window.addEventListener('click', record('click'), { capture: true, passive: true })
}
