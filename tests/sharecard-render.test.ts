import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// renderShareCard on a fake canvas: WebKit's tainted-canvas SecurityError leads to a redraw with
// solid fills only, and fonts or skin tiles that never load stop waiting after 5 s.
const input = { earnedNim: 1, kickbacks: 1, streak: 1, code: 'KICK-AAAA', link: 'https://x.test', slices: [{ pct: 60, label: 'Restake' }, { pct: 40, label: 'Keep' }] }

interface Fake { patterns: number, toBlobCalls: number }
function setup(opts: { taintFirst?: boolean, fontsHang?: boolean, tileHangs?: boolean }): Fake {
  const fake: Fake = { patterns: 0, toBlobCalls: 0 }
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(t, k) {
      if (k in t) return t[k]
      if (k === 'measureText') return () => ({ width: 10 })
      if (k === 'createRadialGradient') return () => ({ addColorStop() {} })
      if (k === 'createPattern') return () => { fake.patterns++; return { setTransform() {} } }
      return () => {}
    },
    set(t, k, v) { t[k as string] = v; return true },
  })
  const canvas = () => ({
    width: 0, height: 0,
    getContext: () => ctx,
    toBlob(cb: (b: Blob | null) => void) {
      fake.toBlobCalls++
      if (opts.taintFirst && fake.toBlobCalls === 1) throw Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' })
      cb(new Blob(['png'], { type: 'image/png' }))
    },
  })
  class FakeImage { onload?: () => void; onerror?: () => void; set src(_v: string) { if (!opts.tileHangs) queueMicrotask(() => this.onload?.()) } }
  vi.stubGlobal('document', { createElement: canvas, documentElement: {}, fonts: { ready: opts.fontsHang ? new Promise(() => {}) : Promise.resolve() } })
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => 'url("data:image/svg+xml,x")' }))
  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('Path2D', class {})
  vi.stubGlobal('DOMMatrix', class { scale() { return this } })
  return fake
}

beforeEach(() => vi.resetModules())
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('renderShareCard', () => {
  it('draws with the skin tiles when the canvas is fine', async () => {
    const fake = setup({})
    const { renderShareCard } = await import('../src/lib/shareCard')
    const issues: string[] = []
    const b = await renderShareCard(input, 'spark', w => issues.push(w))
    expect(b.size).toBeGreaterThan(0)
    expect(fake.patterns).toBeGreaterThan(0)
    expect(fake.toBlobCalls).toBe(1)
    expect(issues).toEqual([])
  })
  it('a tainted canvas (WebKit SecurityError) is drawn again with solid fills only, and reported', async () => {
    const fake = setup({ taintFirst: true })
    const { renderShareCard } = await import('../src/lib/shareCard')
    const issues: string[] = []
    const b = await renderShareCard(input, 'spark', w => issues.push(w))
    expect(b.size).toBeGreaterThan(0)
    expect(fake.toBlobCalls).toBe(2)
    const patternsFirstDraw = fake.patterns
    expect(patternsFirstDraw).toBe(2) // only the first draw used tiles (two slices)
    expect(issues.some(i => /retrying with solid fills/.test(i))).toBe(true)
  })
  it('fonts and tiles that never load stop waiting after 5 s; the card is still made', async () => {
    vi.useFakeTimers()
    const fake = setup({ fontsHang: true, tileHangs: true })
    const { renderShareCard, CARD_WAIT_MS } = await import('../src/lib/shareCard')
    expect(CARD_WAIT_MS).toBe(5000)
    const issues: string[] = []
    const p = renderShareCard(input, 'spark', w => issues.push(w))
    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(5000)
    const b = await p
    expect(b.size).toBeGreaterThan(0)
    expect(fake.patterns).toBe(0)
    expect(issues.some(i => /fonts/.test(i))).toBe(true)
    expect(issues.filter(i => /skin tile/.test(i))).toHaveLength(3)
  })
})
