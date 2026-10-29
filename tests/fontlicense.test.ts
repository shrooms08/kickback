import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The bundled Archivo fonts ship with their SIL Open Font License, as the licence requires.
describe('font licence', () => {
  it('OFL.txt sits next to the Archivo font files with Archivo\'s copyright line', () => {
    const dir = new URL('../src/design/fonts/', import.meta.url)
    expect(readdirSync(dir).some(f => f.startsWith('archivo'))).toBe(true)
    const ofl = readFileSync(new URL('OFL.txt', dir), 'utf8')
    expect(ofl.split('\n')[0]).toBe('Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo)')
    expect(ofl).toContain('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007')
  })
})
