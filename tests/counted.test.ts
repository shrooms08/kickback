import { describe, expect, it } from 'vitest'
import { EMPTY_COUNTED, readyLuna, rememberKickbacks, withRemembered } from '../src/lib/money'

// Audit 8: a kickback that was ready to share stays ready after it leaves the 30-day history.
const DAY = 864e5, now = 1_800_000_000_000, start = now - 100 * DAY
const k = (hash: string, daysAgo: number, luna: number, extra = {}) => ({ hash, at: now - daysAgo * DAY, luna, ...extra })

describe('remembered kickbacks', () => {
  it('a kickback seen 40 days ago still counts when the 30-day history no longer has it', () => {
    let c = rememberKickbacks(EMPTY_COUNTED, [k('a', 40, 300), k('b', 1, 200)], start, now - 10 * DAY)
    const later = [k('b', 1, 200)] // "a" fell out of the window
    c = rememberKickbacks(c, later, start, now)
    expect(readyLuna(later, start, [])).toBe(200)
    expect(readyLuna(withRemembered(later, c), start, [])).toBe(500)
  })
  it('only real wallet kickbacks after the plan started are remembered', () => {
    const c = rememberKickbacks(EMPTY_COUNTED, [k('old', 200, 1), k('r', 1, 2, { restaked: true }), k('d', 1, 4, { dry: true }), k('m', 1, 8, { manual: true }), k('ok', 1, 16)], start, now)
    expect(c.items.map(i => i.h)).toEqual(['ok'])
  })
  it('never counts one twice (seen again in history, from the server, or in the full scan)', () => {
    let c = rememberKickbacks(EMPTY_COUNTED, [k('a', 5, 300)], start, now)
    c = rememberKickbacks(c, [k('a', 5, 300)], start, now)
    expect(c.items).toHaveLength(1)
    expect(readyLuna(withRemembered([k('a', 5, 300)], c), start, [])).toBe(300)
  })
  it('folds kickbacks older than 60 days into a total, without double counting the full history', () => {
    let c = rememberKickbacks(EMPTY_COUNTED, [k('a', 70, 300), k('b', 65, 100), k('c', 2, 50)], start, now)
    expect(c.items.map(i => i.h)).toEqual(['c'])
    expect(c.foldedLuna).toBe(400)
    // The full scan still lists a and b: they must not count again.
    const full = [k('a', 70, 300), k('b', 65, 100), k('c', 2, 50)]
    expect(readyLuna(withRemembered(full, c), start, [])).toBe(450)
    expect(readyLuna(withRemembered([], c), start, [])).toBe(450)
    c = rememberKickbacks(c, full, start, now)
    expect(c.foldedLuna).toBe(400)
  })
  it('a new plan start ignores what was remembered before it', () => {
    const c = rememberKickbacks(EMPTY_COUNTED, [k('a', 10, 300)], start, now)
    expect(readyLuna(withRemembered([], c), now - DAY, [])).toBe(0)
  })
})

describe('plan store keeps them per wallet', () => {
  it('remembered kickbacks survive a restart', async () => {
    const { memoryStorage } = await import('./helpers/storage')
    const { createPinia, setActivePinia } = await import('pinia')
    memoryStorage()
    setActivePinia(createPinia())
    const { usePlan } = await import('../src/stores/plan')
    const ME = 'NQ51 KVXF RMYV 9HPD CA8N 5X10 7SUY 2C29 MU2T'
    let plan = usePlan()
    plan.loadFor(ME)
    plan.$patch({ planStartedAt: Date.now() - 50 * DAY })
    plan.rememberKickbacks([{ hash: 'a', at: Date.now() - 40 * DAY, luna: 300 }])
    setActivePinia(createPinia())
    plan = usePlan()
    plan.loadFor(ME)
    expect(plan.counted.items).toMatchObject([{ h: 'a', luna: 300 }])
  })
})
