import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const skins = readFileSync('src/design/skins.css', 'utf8')
const hatch = readFileSync('src/design/hatch.css', 'utf8')
const v = (css: string, name: string) => new RegExp(`${name}:\\s*(url\\("[^"]+"\\))`).exec(css)?.[1]

describe('Stack skins (generated)', () => {
  it('Spark is exactly the app hatch', () => {
    expect(v(skins, '--kb-skin-spark-light')).toBe(v(hatch, '--kb-hatch-light'))
    expect(v(skins, '--kb-skin-spark-dark')).toBe(v(hatch, '--kb-hatch-dark'))
  })
  it('every other skin has its own tile and swaps all three inks', () => {
    for (const k of ['kick', 'bounce', 'rally', 'surge', 'legend']) {
      expect(v(skins, `--kb-skin-${k}-light`)).toBeTruthy()
      expect(v(skins, `--kb-skin-${k}-light`)).not.toBe(v(skins, '--kb-skin-spark-light'))
      expect(skins).toContain(`:root[data-kb-skin="${k}"] { --kb-hatch-dark: var(--kb-skin-${k}-dark); --kb-hatch-second: var(--kb-skin-${k}-second); --kb-hatch-light: var(--kb-skin-${k}-light); }`)
    }
  })
  it('Legend glows', () => {
    expect(skins).toContain(':root[data-kb-skin="legend"] .stack .card')
  })
})
