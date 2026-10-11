import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The design rules (docs/DESIGN.md, "Rules"), enforced: in the renderer outside components/ui (shadcn, edited), colours come
// only from the tokens in globals.css and text sizes only from the text-ui scale. A Tailwind palette colour, a raw hex or
// rgb colour, a raw text size, or a colour class that no token registers (it would generate no CSS and fail silently)
// fails this test. Each rule has a known-bad case below.

const RENDERER = resolve(__dirname, '..')
const css = readFileSync(join(__dirname, 'globals.css'), 'utf8')

/** Colour names registered with Tailwind through @theme inline (bg-<name>, text-<name>, border-<name> ...). */
const REGISTERED = new Set([...css.matchAll(/--color-([a-z0-9-]+):/g)].map((match) => match[1]))
const PALETTE =
  /\b(?:bg|text|border|ring|fill|stroke|outline|from|to|via|decoration|divide|placeholder|caret|accent|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/
const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/
const RAW_TEXT_SIZE = /\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b|\btext-\[\d+(?:\.\d+)?(?:px|rem)\]/
const COLOUR_UTILITY =
  /\b(?:bg|text|border|ring|fill|stroke|outline|divide|placeholder|caret)-([a-z][a-z0-9-]*?)(?:\/\d+)?(?=[\s"'`:\]]|$)/g
/** Utility words that share a prefix with colours but are not colours. */
const NOT_COLOURS = new Set([
  'transparent',
  'current',
  'inherit',
  'none',
  'left',
  'right',
  'center',
  'justify',
  'start',
  'end',
  'balance',
  'pretty',
  'wrap',
  'nowrap',
  'clip',
  'ellipsis',
  'x',
  'y',
  't',
  'b',
  'l',
  'r',
  'solid',
  'dashed',
  'dotted',
  'double',
  'hidden',
  'collapse',
  'separate',
  'offset',
  'inset',
  'fixed',
  'local',
  'scroll',
  'contain',
  'cover',
  'auto',
  'no-repeat',
  'repeat',
  'origin',
  'clip-text',
  'blend',
  'opacity',
  'ui-xs',
  'ui-sm',
  'ui-caption',
  'ui-base',
  'ui-lg',
  'ui-xl',
  'ui-title',
])

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'ui' ? [] : sources(path)
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [path] : []
  })
}

function problems(text: string): string[] {
  const found: string[] = []
  for (const [index, line] of text.split('\n').entries()) {
    const at = `line ${index + 1}`
    // Comments may name classes to explain them; only code is held to the rules.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
    if (PALETTE.test(line)) found.push(`${at}: a Tailwind palette colour`)
    if (RAW_COLOUR.test(line)) found.push(`${at}: a raw colour`)
    if (RAW_TEXT_SIZE.test(line)) found.push(`${at}: a raw text size`)
    for (const match of line.matchAll(COLOUR_UTILITY)) {
      const name = match[1] ?? ''
      if (NOT_COLOURS.has(name) || /^\d/.test(name) || name.startsWith('[')) continue
      // Border and ring widths by side (border-t-0, border-x), and the gap an outline or ring leaves
      // (outline-offset-4), are sizes, not colours.
      if (/^(?:ui-|opacity-|offset-\d)/.test(name) || /^(?:[xytrbl]|[xytrbl]-\d+)$/.test(name)) continue
      if (!REGISTERED.has(name) && !['white', 'black'].includes(name))
        found.push(`${at}: ${match[0]} is not a registered colour`)
    }
  }
  return found
}

describe('design rules', () => {
  it('registers the colour tokens', () => {
    expect(REGISTERED.size).toBeGreaterThan(20)
    expect(REGISTERED.has('brand')).toBe(true)
  })

  for (const file of sources(RENDERER)) {
    it(`${relative(RENDERER, file)} uses only tokens and the text-ui scale`, () => {
      expect(problems(readFileSync(file, 'utf8'))).toEqual([])
    })
  }

  it.each([
    ['a palette colour', '<div className="bg-slate-800" />'],
    ['a raw hex colour', "const c = '#92ed92'"],
    ['a raw rgb colour', "style={{ color: 'rgb(0 0 0)' }}"],
    ['a raw text size', '<p className="text-sm" />'],
    ['a raw pixel text size', '<p className="text-[13px]" />'],
    ['an unregistered colour class', '<p className="text-yellow-ink" />'],
    [
      'an unregistered outline colour, which a size in the same place must not excuse',
      '<p className="outline-offset-4 outline-marigold" />',
    ],
  ])('known-bad: catches %s', (_label, text) => {
    expect(problems(text).length).toBeGreaterThan(0)
  })
})

// The dark theme's greys are pure neutrals (docs/DESIGN.md, "What this app uses"): its surfaces, inks, lines and states
// carry no hue at all. Only the few tokens that are a colour by right may, so a tinted token added later fails here
// rather than passing unnoticed.
const COLOURED_BY_RIGHT = new Set([
  'brand',
  'brand-ink',
  'brand-hover',
  'brand-text',
  // The mascot, which is also the mark, keeps BAND's own colours under every theme (docs/DESIGN.md, "The Jam theme").
  'jam-mascot-top',
  'jam-mascot-bottom',
  'jam-mascot-ink',
  'jam-mascot-eye',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'success',
  'warning',
  'destructive',
  'info',
  'info-surface',
])

/** The custom properties one theme block sets, as [name, value] pairs. */
function themeBlock(source: string, selector: string): [string, string][] {
  const from = source.indexOf(selector)
  if (from < 0) throw new Error(`no ${selector} in globals.css`)
  const block = source.slice(from, source.indexOf('}', from))
  return [...block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim()])
}

/** Every colour written out in a declaration: a hex, or a colour function. A `var()` or a `color-mix()` names another
 * token instead and is judged where that token is set, so a value holding neither carries no colour of its own. */
const LITERALS = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/gi

/**
 * Whether one written-out colour carries a hue. A form this cannot read counts as one: the check has to fail closed,
 * or a notation nobody thought of would pass as neutral without anything being looked at.
 */
function literalHasHue(literal: string): boolean {
  const hex = /^#([0-9a-f]+)$/i.exec(literal)
  if (hex) {
    const digits = hex[1]!.toLowerCase()
    const width = digits.length <= 4 ? 1 : 2 // #rgb and #rgba, or #rrggbb and #rrggbbaa
    if (digits.length !== width * 3 && digits.length !== width * 4) return true
    const [r, g, b] = [0, 1, 2].map((i) => digits.slice(i * width, i * width + width))
    return r !== g || g !== b
  }
  const call = /^([a-z]+)\(([^)]*)\)$/i.exec(literal)
  const parts = call?.[2]?.split(/[\s,/]+/).filter(Boolean) ?? []
  switch (call?.[1]?.toLowerCase()) {
    case 'rgb':
    case 'rgba':
      return parts.length < 3 || parts[0] !== parts[1] || parts[1] !== parts[2]
    case 'hsl':
    case 'hsla':
    case 'hwb':
      return parts[1] !== '0%' && parts[1] !== '0' // no saturation, no hue
    case 'oklch':
    case 'lch':
      return parts[1] !== '0' // chroma
    case 'oklab':
    case 'lab':
      return parts[1] !== '0' || parts[2] !== '0'
    default:
      return true
  }
}

/** One bare word that carries no colour of its own. A CSS colour name is not one of these: all but a few of the 148
 * carry a hue, and this stylesheet never uses one, so an unknown bare word fails rather than passing. */
const KEYWORDS = new Set(['transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert', 'none', 'auto'])

/** Whether a declaration carries a hue: whether any colour written out in it does. */
function tinted([name, value]: [string, string]): boolean {
  if (COLOURED_BY_RIGHT.has(name)) return false
  const literals = value.match(LITERALS)
  if (literals) return literals.some(literalHasHue)
  return /^[a-z]+$/i.test(value) && !KEYWORDS.has(value.toLowerCase())
}

describe("the dark theme's greys", () => {
  const dark = themeBlock(css, "[data-theme='dark'] {")

  it('reads the whole block', () => {
    // An empty or truncated parse would let every check below pass while looking at nothing.
    expect(dark.length).toBeGreaterThan(20)
    expect(dark.map(([name]) => name)).toContain('background')
    expect(dark.map(([name]) => name)).toContain('surface-hover')
  })

  it('are neutral: no surface, ink, line or state carries a hue', () => {
    expect(dark.filter(tinted).map(([name, value]) => `--${name}: ${value}`)).toEqual([])
  })

  it('nothing tinted reaches Dark from :root, which it inherits', () => {
    const root = themeBlock(css, ':root {')
    expect(root.length).toBeGreaterThan(20)
    const set = new Set(dark.map(([name]) => name))
    const inherited = root.filter(([name]) => !set.has(name))
    expect(inherited.length).toBeGreaterThan(0) // it does inherit some, or this proves nothing
    expect(inherited.filter(tinted).map(([name, value]) => `--${name}: ${value}`)).toEqual([])
  })

  // The gate itself, not only the predicate: a tinted value put back into the real stylesheet must be caught.
  it('known-bad: the gate fails on a tinted stylesheet', () => {
    const spoiled = themeBlock(css.replace('--card: #272727;', '--card: #282c2d;'), "[data-theme='dark'] {")
    expect(spoiled.filter(tinted).map(([name]) => name)).toEqual(['card'])
  })

  it.each([
    ['a tinted surface', ['card', '#282c2d']],
    ['a tinted ink', ['foreground', '#d1d5d6']],
    ['a tinted line', ['line', 'rgb(214 228 245 / 0.09)']],
    ['a surface off by one channel', ['panel', '#1c1c1d']],
    ['a short hex', ['card', '#1d2']],
    ['a hex with an alpha', ['card', '#1c1c1dff']],
    ['an opaque rgb, which carries no slash', ['card', 'rgb(30 30 35)']],
    ['an oklch, the notation this palette is reasoned in', ['card', 'oklch(22.6% 0.015 250)']],
    ['an hsl with a saturation', ['card', 'hsl(250 12% 14%)']],
    ['a colour mixed from a written-out tint', ['strip', 'color-mix(in oklab, #1f2324 60%, transparent)']],
    ['a notation this test cannot read, which must never pass as neutral', ['card', 'color(display-p3 .1 .1 .2)']],
    ['a hex of an impossible length', ['card', '#1c1c1']],
    ['a CSS colour name, which this test does not keep a list of', ['card', 'darkslateblue']],
  ])('known-bad: catches %s', (_label, declaration) => {
    expect(tinted(declaration as [string, string])).toBe(true)
  })

  it.each([
    ['a neutral surface', ['card', '#272727']],
    ['a neutral state', ['hover', 'rgb(255 255 255 / 0.05)']],
    ['a neutral short hex', ['card', '#ccc']],
    ['a neutral oklch', ['foreground', 'oklch(87% 0 0)']],
    ["BAND's green, a colour by right", ['brand', '#92ed92']],
    ["the mascot, which keeps BAND's colours under every theme", ['jam-mascot-top', '#77e877']],
    ['a shadow, whose own colours are black', ['shadow-popover', '0 4px 6px -1px rgb(0 0 0 / 0.1)']],
    ['a size, which is no colour at all', ['ui-font-size', '14px']],
    ['a keyword that carries no colour', ['selected', 'transparent']],
    [
      'an ink derived from another token',
      ['foreground-subtle', 'color-mix(in oklab, var(--foreground) 60%, transparent)'],
    ],
  ])('passes %s', (_label, declaration) => {
    expect(tinted(declaration as [string, string])).toBe(false)
  })
})
