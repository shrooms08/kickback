import { describe, expect, it } from 'vitest'
import { shareCardText } from '../src/lib/shareCard'

const input = { earnedNim: 12.4, kickbacks: 14, streak: 12, code: 'KICK-7Q2M', link: 'https://kickback-ecru.vercel.app/?ref=KICK-7Q2M', slices: [{ pct: 30, label: 'Ada' }, { pct: 30, label: 'Restake' }, { pct: 40, label: 'Keep' }] }

describe('share card text', () => {
  it('shows NIM amounts only, never dollars', () => {
    const t = shareCardText(input)
    expect(JSON.stringify(t)).not.toContain('$')
    expect(t.amount).toBe('12.40 NIM')
  })
  it('carries the invite code and the link without https://', () => {
    const t = shareCardText(input)
    expect(t.code).toBe('KICK-7Q2M')
    expect(t.link).toBe('kickback-ecru.vercel.app/?ref=KICK-7Q2M')
  })
  it('says how many kickbacks and the streak', () => {
    const t = shareCardText(input)
    expect(t.sub).toBe('from 14 kickbacks')
    expect(t.streak).toBe('12 in a row')
    expect(shareCardText({ ...input, kickbacks: 1, streak: 0 }).sub).toBe('from 1 kickback')
    expect(shareCardText({ ...input, streak: 0 }).streak).toBe('')
  })
})
