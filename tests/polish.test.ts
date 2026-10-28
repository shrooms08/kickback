import { describe, expect, it } from 'vitest'
import { usd } from '../src/lib/usd'
import { buildIcs, reminderTimes } from '../src/lib/ics'
import { compoundExtra } from '../src/lib/compound'

describe('usd: never a dollar amount below $0.01', () => {
  it('returns empty below one cent', () => {
    expect(usd(0.0001, 0.0015)).toBe('')
    expect(usd(6, 0.0015)).toBe('')
    expect(usd(0, 1)).toBe('')
  })
  it('rounds to cents at or above one cent', () => {
    expect(usd(1, 0.0157)).toBe('$0.02')
    expect(usd(10, 0.001)).toBe('$0.01')
    expect(usd(31480.55, 0.0013)).toBe('$40.92')
  })
  it('never prints $0.00 for values that would round down', () => {
    expect(usd(1, 0.0049)).toBe('')
  })
})

describe('reminder times follow the payout schedule', () => {
  const next = Date.UTC(2026, 9, 28, 21, 4)
  it('next kickback only: one time', () => {
    expect(reminderTimes(next, 12, 'next')).toEqual([next])
  })
  it('every kickback for 2 weeks at 12h: 28 times, 12h apart', () => {
    const t = reminderTimes(next, 12, 'two')
    expect(t).toHaveLength(28)
    expect(t[1] - t[0]).toBe(12 * 3600e3)
    expect(t[27]).toBeLessThan(next + 14 * 24 * 3600e3)
  })
  it('falls back to 12h when the interval is unknown', () => {
    expect(reminderTimes(next, null, 'two')).toHaveLength(28)
  })
})

describe('.ics file', () => {
  const at = Date.UTC(2026, 9, 28, 21, 4, 0)
  const ics = buildIcs([{ start: at, title: 'Kickback lands', desc: 'Open Kickback to run your plan.' }], 'seed1')
  it('is a VCALENDAR with CRLF lines', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
    expect(ics.split('\r\n').every(l => !l.includes('\n'))).toBe(true)
  })
  it('starts at the exact UTC time', () => {
    expect(ics).toContain('DTSTART:20261028T210400Z')
    expect(ics).toContain('DTEND:20261028T211400Z')
  })
  it('alarms at event time', () => {
    expect(ics).toContain('BEGIN:VALARM')
    expect(ics).toContain('TRIGGER:PT0M')
    expect(ics).toContain('ACTION:DISPLAY')
  })
  it('one VEVENT per reminder with unique UIDs', () => {
    const many = buildIcs(reminderTimes(at, 12, 'two').map(start => ({ start, title: 't', desc: 'd' })), 'seed2')
    expect(many.match(/BEGIN:VEVENT/g)).toHaveLength(28)
    const uids = many.match(/^UID:.*$/gm)!
    expect(new Set(uids).size).toBe(28)
  })
  it('escapes commas and semicolons in text', () => {
    expect(buildIcs([{ start: at, title: 'a,b;c', desc: 'x' }], 's')).toContain('SUMMARY:a\\,b\\;c')
  })
})

describe('compounding line', () => {
  it('restaking 30% of a 28,646 NIM stake at 7.9% adds about 27 NIM a year', () => {
    expect(compoundExtra(28646, 0.079, 30, 730)).toBeCloseTo(27.1, 0)
  })
  it('no restake adds nothing', () => {
    expect(compoundExtra(28646, 0.079, 0, 730)).toBe(0)
  })
  it('more restake adds more', () => {
    expect(compoundExtra(1000, 0.079, 100, 730)).toBeGreaterThan(compoundExtra(1000, 0.079, 50, 730))
  })
  it('no stake or no rate adds nothing', () => {
    expect(compoundExtra(0, 0.079, 30, 730)).toBe(0)
    expect(compoundExtra(1000, 0, 30, 730)).toBe(0)
  })
})

import { nimiqCalculatorRate, posSupplyAt } from '../src/lib/rate'

describe('Nimiq staking calculator (nimiq.com/staking port)', () => {
  const now = Date.parse('2026-10-28T15:00:00Z')
  it('daily emission today is about 2.18M NIM', () => {
    expect(posSupplyAt(now) - posSupplyAt(now - 86_400_000)).toBeCloseTo(2_183_101, -3)
  })
  it('matches nimiq.com: 67.3% staked, 365 days, restake, no fee ≈ 8.63%', () => {
    expect(nimiqCalculatorRate(0.6729765, 0, { now })! * 100).toBeCloseTo(8.63, 1)
  })
  it('subtracts the pool fee', () => {
    expect(nimiqCalculatorRate(0.6729765, 0.1, { now })! * 100).toBeCloseTo(7.77, 1)
  })
  it('rejects nonsense inputs', () => {
    expect(nimiqCalculatorRate(0, 0, { now })).toBeNull()
    expect(nimiqCalculatorRate(1.2, 0, { now })).toBeNull()
    expect(nimiqCalculatorRate(0.6, -0.1, { now })).toBeNull()
  })
})

import { rateText } from '../src/lib/rateText'
describe('rate line', () => {
  it('one decimal, "about … a year"', () => {
    expect(rateText(0.08634)).toBe('about 8.6% a year')
    expect(rateText(0.0777)).toBe('about 7.8% a year')
  })
  it('empty when unknown', () => {
    expect(rateText(null)).toBe('')
    expect(rateText(0)).toBe('')
  })
})
