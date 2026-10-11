import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The Jam theme promises text that reads on every one of its surfaces: each ink, composited over each surface as the
// browser composites it (in sRGB), reaches WCAG AA, 4.5:1. ZCode's own themes keep ZCode's measured, quieter inks and
// are not held to it here.
const css = readFileSync(resolve(__dirname, 'globals.css'), 'utf8')
const from = css.indexOf("[data-theme='jam'] {")
const jam = css.slice(from, css.indexOf('}', from))

type Rgb = [number, number, number]

function hex(value: string): Rgb {
  const h = value.replace('#', '')
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255) as Rgb
}

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(jam)
  if (!match?.[1]) throw new Error(`no --${name} in the Jam theme`)
  return match[1].trim()
}

/** A token as a colour and an opacity: a hex, or the foreground mixed with transparent at a percentage. */
function ink(name: string): { rgb: Rgb; alpha: number } {
  const value = token(name)
  if (value.startsWith('#')) return { rgb: hex(value), alpha: 1 }
  const mix = /color-mix\(in oklab, var\(--foreground\) (\d+)%, transparent\)/.exec(value)
  if (!mix?.[1]) throw new Error(`--${name} is neither a hex nor the foreground at a percentage: ${value}`)
  return { rgb: hex(token('foreground')), alpha: Number(mix[1]) / 100 }
}

const over = (top: { rgb: Rgb; alpha: number }, below: Rgb): Rgb =>
  top.rgb.map((channel, i) => top.alpha * channel + (1 - top.alpha) * below[i]!) as Rgb

/** A state tint, `rgb(r g b / a)`, as a colour and an opacity. */
function tint(name: string): { rgb: Rgb; alpha: number } {
  const match = /rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(token(name))
  if (!match) throw new Error(`--${name} is not an rgb() tint: ${token(name)}`)
  const [r, g, b, a] = match.slice(1).map(Number) as [number, number, number, number]
  return { rgb: [r / 255, g / 255, b / 255], alpha: a }
}

/** Every surface text sits on: the opaque ones, and each hover or state tint over the surfaces it lies on. */
function surfaces(): [string, Rgb][] {
  const opaque = SURFACES.map((name): [string, Rgb] => [name, hex(token(name))])
  const tinted = ['hover', 'surface', 'surface-hover'].flatMap((state) =>
    ['canvas', 'background', 'card'].map((name): [string, Rgb] => [
      `${state} over ${name}`,
      over(tint(state), hex(token(name))),
    ]),
  )
  return [...opaque, ...tinted]
}

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].toSorted((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

const SURFACES = ['canvas', 'background', 'panel', 'card', 'strip', 'popover', 'input', 'secondary', 'selected']

describe('the contrast check itself', () => {
  it('measures white on black at 21:1 and fails a pair below 4.5:1', () => {
    expect(contrast(hex('#ffffff'), hex('#000000'))).toBeCloseTo(21, 5)
    expect(contrast(hex('#666666'), hex('#000000'))).toBeLessThan(4.5)
  })

  it('composites an ink at half strength halfway to the surface', () => {
    expect(over({ rgb: [1, 1, 1], alpha: 0.5 }, [0, 0, 0])).toEqual([0.5, 0.5, 0.5])
  })
})

describe('the Jam theme', () => {
  it.each(['foreground', 'foreground-subtle', 'foreground-subtlest'])('%s reads at 4.5:1 on every surface', (name) => {
    for (const [surface, below] of surfaces()) {
      expect(contrast(over(ink(name), below), below), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the button text and the links at 4.5:1', () => {
    const brandInk = hex(token('brand-ink'))
    expect(contrast(brandInk, hex(token('brand'))), 'brand-ink on brand').toBeGreaterThanOrEqual(4.5)
    expect(contrast(brandInk, hex(token('brand-hover'))), 'brand-ink on brand-hover').toBeGreaterThanOrEqual(4.5)
    for (const [surface, below] of surfaces()) {
      const link = contrast(hex(token('brand-text')), below)
      expect(link, `brand-text on ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
