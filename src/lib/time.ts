import { ref } from 'vue'

const H = 3600e3, DAY = 24 * H

/** Shared clock for countdowns; ticks every 30s. */
export const now = ref(Date.now())
let ticking = 0
export function startClock() {
  if (ticking) return
  ticking = window.setInterval(() => { now.value = Date.now() }, 30_000)
}

const hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
const md = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const wmd = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export const hhmm = (t: number) => hm.format(t)
export const monthDay = (t: number) => md.format(t)

export function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** "Today", "Yesterday", "Mon, Oct 19" */
export function dayLabel(t: number, ref = Date.now()): string {
  const diff = Math.round((startOfDay(ref) - startOfDay(t)) / DAY)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return wmd.format(t)
}

/** "Today 12:04", "Yesterday 12:03", "Oct 19 · 12:04" */
export function whenLabel(t: number, ref = Date.now()): string {
  const d = dayLabel(t, ref)
  if (d === 'Today' || d === 'Yesterday') return `${d} ${hhmm(t)}`
  return `${monthDay(t)} · ${hhmm(t)}`
}

/** "09:04" today, otherwise "yesterday 21:04" / "tomorrow 14:16" / "Oct 19 21:04". */
export function clockOrDay(t: number, ref = Date.now()): string {
  const d = dayLabel(t, ref)
  if (d === 'Today') return hhmm(t)
  if (d === 'Yesterday') return `yesterday ${hhmm(t)}`
  if (Math.round((startOfDay(t) - startOfDay(ref)) / DAY) === 1) return `tomorrow ${hhmm(t)}`
  return `${monthDay(t)} ${hhmm(t)}`
}

/** "3h 12m", "12m", "2d 4h" */
export function duration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60e3))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** "just now", "12 min", "4h", "2 days" (no "ago"). */
export function span(ms: number): string {
  const m = Math.round(ms / 60e3)
  if (m < 2) return 'just now'
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)} days`
}

export function ago(t: number, ref = Date.now()): string {
  const s = span(ref - t)
  return s === 'just now' ? s : `${s} ago`
}
