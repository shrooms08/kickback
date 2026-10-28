import { describe, expect, it } from 'vitest'
import { refFromUrl } from '../src/lib/ref'

describe('?ref= invite codes', () => {
  it('reads a valid code, any case', () => {
    expect(refFromUrl('?ref=KICK-7Q2M')).toBe('KICK-7Q2M')
    expect(refFromUrl('?mock=1&ref=kick-7q2m')).toBe('KICK-7Q2M')
  })
  it('ignores anything that is not a code', () => {
    expect(refFromUrl('')).toBeNull()
    expect(refFromUrl('?ref=')).toBeNull()
    expect(refFromUrl('?ref=<script>')).toBeNull()
    expect(refFromUrl('?ref=KICK-0O1I')).toBeNull()
  })
})
