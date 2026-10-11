import { describe, expect, it } from 'vitest'
import { excerptOf } from './excerpt'

/** An emoji, built at run time: it is one character and two of the units a cut counts. */
const GRIN = String.fromCodePoint(0x1f600)

/** True when the text holds half a character - one unit of a pair, with the other cut away. */
const halved = (text: string): boolean =>
  [...text].some((one) => one.length === 1 && one.charCodeAt(0) >= 0xd800 && one.charCodeAt(0) <= 0xdfff)

describe('an excerpt around what was found', () => {
  it('keeps the words around the match and marks both cuts', () => {
    const line = `${'before '.repeat(20)}needle ${'after '.repeat(40)}`
    const cut = excerptOf(line, 'needle')
    expect(cut).toContain('needle')
    expect(cut.startsWith('…')).toBe(true)
    expect(cut.endsWith('…')).toBe(true)
  })

  it('leaves a short line whole', () => {
    expect(excerptOf('a plan for the room', 'plan')).toBe('a plan for the room')
  })

  /**
   * With no space to cut at, both cuts fall on a counted unit rather than a word - and a character outside the basic
   * set is two units. Neither cut may land between them: half a character shows as a replacement box in a search
   * result, which reads as the text itself being broken.
   */
  it('never cuts a character in half where there is no word to cut at', () => {
    const end = `jam${'a'.repeat(136)}${GRIN}${'b'.repeat(20)}`
    expect(halved(excerptOf(end, 'jam', false))).toBe(false)

    const start = `${'x'.repeat(100)}${GRIN}${'y'.repeat(39)}jam${'z'.repeat(60)}`
    expect(halved(excerptOf(start, 'jam', false))).toBe(false)

    // The words that matched are still there: the guard shortens the excerpt, it does not move it.
    expect(excerptOf(end, 'jam', false)).toContain('jam')
    expect(excerptOf(start, 'jam', false)).toContain('jam')
  })
})
