// A Map-backed localStorage for tests that simulate an app restart (same storage, new stores).
export function memoryStorage() {
  const m = new Map<string, string>()
  const s = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
  ;(globalThis as unknown as { localStorage: typeof s }).localStorage = s
  return s
}
