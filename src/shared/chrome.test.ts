import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHROME_COLORS, chromeColorsFor, nativeThemeSource } from './chrome'

// The native window background and caption buttons must match the page, or a light seam shows at startup and around the
// caption buttons.
const css = readFileSync(resolve(__dirname, '../renderer/src/styles/globals.css'), 'utf8')

function token(block: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)
  if (!match?.[1]) throw new Error(`no --${name} in the block`)
  return match[1].toLowerCase()
}

/** A theme's block of tokens, from its selector to the next one; a missing selector fails rather than slicing nothing. */
function themeBlock(start: string, end: string): string {
  const from = css.indexOf(start)
  const to = css.indexOf(end, from + 1)
  if (from < 0 || to < 0) throw new Error(`no block from ${start} to ${end}`)
  return css.slice(from, to)
}

const light = themeBlock(':root {', "[data-theme='dark'] {")
const dark = themeBlock("[data-theme='dark'] {", "[data-theme='jam'] {")
const jam = themeBlock("[data-theme='jam'] {", '@theme inline')

describe('CHROME_COLORS', () => {
  it('matches the light theme tokens', () => {
    expect(CHROME_COLORS.light.surface).toBe(token(light, 'background'))
    expect(CHROME_COLORS.light.symbol).toBe(token(light, 'foreground'))
  })

  it('matches the dark theme tokens', () => {
    expect(CHROME_COLORS.dark.surface).toBe(token(dark, 'background'))
    expect(CHROME_COLORS.dark.symbol).toBe(token(dark, 'foreground'))
  })

  it('matches the Jam theme tokens', () => {
    expect(CHROME_COLORS.jam.surface).toBe(token(jam, 'background'))
    expect(CHROME_COLORS.jam.symbol).toBe(token(jam, 'foreground'))
  })
})

describe('a theme on the native window', () => {
  it('gives the Jam theme its own colours whatever the system prefers', () => {
    expect(chromeColorsFor('jam', false)).toBe(CHROME_COLORS.jam)
    expect(chromeColorsFor('jam', true)).toBe(CHROME_COLORS.jam)
  })

  it('gives the other themes the light or dark colours the system resolved', () => {
    expect(chromeColorsFor('dark', true)).toBe(CHROME_COLORS.dark)
    expect(chromeColorsFor('system', true)).toBe(CHROME_COLORS.dark)
    expect(chromeColorsFor('system', false)).toBe(CHROME_COLORS.light)
    expect(chromeColorsFor('light', false)).toBe(CHROME_COLORS.light)
  })

  it("tells Electron's nativeTheme the Jam theme is dark, and passes the rest through", () => {
    expect(nativeThemeSource('jam')).toBe('dark')
    expect(nativeThemeSource('dark')).toBe('dark')
    expect(nativeThemeSource('light')).toBe('light')
    expect(nativeThemeSource('system')).toBe('system')
  })
})
