// Tiny two-level cache: memory plus localStorage, every entry timestamped.
// localStorage can be missing or full inside a WebView, so every access is guarded.

export interface Entry<T> { t: number, v: T }

const PREFIX = 'kb:c:'
const mem = new Map<string, Entry<unknown>>()

export function cacheGet<T>(key: string): Entry<T> | null {
  const m = mem.get(key)
  if (m) return m as Entry<T>
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const e = JSON.parse(raw) as Entry<T>
    mem.set(key, e)
    return e
  }
  catch {
    return null
  }
}

export function cacheSet<T>(key: string, v: T, t = Date.now()): Entry<T> {
  const e = { t, v }
  mem.set(key, e)
  try { localStorage.setItem(PREFIX + key, JSON.stringify(e)) }
  catch {
    // Quota full: drop the oldest entries once and try again.
    pruneCache(0.5)
    try { localStorage.setItem(PREFIX + key, JSON.stringify(e)) }
    catch { /* memory only */ }
  }
  return e
}

export function ageMs(e: Entry<unknown> | null): number {
  return e ? Date.now() - e.t : Number.POSITIVE_INFINITY
}

/** Remove entries older than 3 days, or (when `fraction` is given) the oldest share of all entries. */
export function pruneCache(fraction?: number) {
  try {
    const entries: Array<[string, number]> = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(PREFIX)) continue
      try { entries.push([k, (JSON.parse(localStorage.getItem(k) || '{}') as Entry<unknown>).t || 0]) }
      catch { entries.push([k, 0]) }
    }
    entries.sort((a, b) => a[1] - b[1])
    const cutoff = Date.now() - 3 * 24 * 3600e3
    const drop = fraction ? entries.slice(0, Math.ceil(entries.length * fraction)) : entries.filter(([, t]) => t < cutoff)
    drop.forEach(([k]) => { localStorage.removeItem(k); mem.delete(k.slice(PREFIX.length)) })
  }
  catch { /* storage unavailable */ }
}

/** Small persisted settings (not cache entries). */
export function prefGet(key: string): string | null {
  try { return localStorage.getItem('kb:' + key) }
  catch { return null }
}
export function prefSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem('kb:' + key)
    else localStorage.setItem('kb:' + key, value)
  }
  catch { /* ignore */ }
}
