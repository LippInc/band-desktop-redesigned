import { describe, expect, it } from 'vitest'
import {
  anchorTarget,
  guideContents,
  guideProblem,
  guideSections,
  railScroll,
  READING_LINE,
  readingSection,
  SEARCH_MIN,
  searchGuide,
} from '@/lib/guide'

const guide = [
  '# Jam user guide',
  '',
  'Everything this app can do.',
  '',
  '## Start here',
  '',
  'Pick how you want to begin.',
  '',
  '### Start with a Jam-owned agent',
  '',
  'Open Home and describe the work.',
  '',
  '```',
  '# not a heading: this is inside a fenced block',
  '```',
  '',
  '### Return to ongoing work',
  '',
  'Reopen the room from the list.',
  '',
  '## Home',
  '',
  'Home is where work starts.',
  '',
  // A heading of punctuation alone: its id is the one a name of nothing falls back to.
  '## ---',
  '',
  'A divider of a heading.',
].join('\n')

describe("what Documentation makes of Jam's guide", () => {
  it("finds the guide's own headings, in its order, with the text under each", () => {
    const sections = guideSections(guide)
    expect(sections.map((one) => [one.level, one.title])).toEqual([
      [1, 'Jam user guide'],
      [2, 'Start here'],
      [3, 'Start with a Jam-owned agent'],
      [3, 'Return to ongoing work'],
      [2, 'Home'],
      [2, '---'],
    ])
    expect(sections[4]?.body.trim()).toBe('Home is where work starts.')
    expect(sections[5]?.id).toBe('section')
  })

  // A heading inside a fenced block is part of an example. Counting it would put an entry in the list that the
  // guide does not have, and the jump would land nowhere.
  it('takes no heading from inside a fenced block', () => {
    expect(guideSections(guide).some((one) => one.title.includes('not a heading'))).toBe(false)
    expect(guideSections(['# One', '~~~', '## Inside', '~~~', '## Two'].join('\n')).map((s) => s.title)).toEqual([
      'One',
      'Two',
    ])
  })

  it('gives every heading an id of its own, even two with the same words', () => {
    const sections = guideSections(['## Home', '## Home', '## Home & away'].join('\n'))
    const ids = sections.map((one) => one.id)
    expect(ids).toEqual(['home', 'home-1', 'home-away'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('lists the parts with their pages under them, and leaves the guide title out', () => {
    const contents = guideContents(guideSections(guide))
    expect(contents.map((entry) => [entry.section.title, entry.children.map((child) => child.title)])).toEqual([
      ['Start here', ['Start with a Jam-owned agent', 'Return to ongoing work']],
      ['Home', []],
      ['---', []],
    ])
  })

  it('finds nothing until two characters are typed', () => {
    const sections = guideSections(guide)
    expect(SEARCH_MIN).toBe(2)
    expect(searchGuide(sections, 'h')).toEqual([])
    expect(searchGuide(sections, ' ')).toEqual([])
    expect(searchGuide(sections, '')).toEqual([])
    expect(searchGuide(sections, 'ho').length).toBeGreaterThan(0)
  })

  it('finds a heading and the line the words are on, and says where to jump', () => {
    const sections = guideSections(guide)
    const hits = searchGuide(sections, 'reopen')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.title).toBe('Return to ongoing work')
    expect(hits[0]?.excerpt).toBe('Reopen the room from the list.')
    expect(sections.some((one) => one.id === hits[0]?.id)).toBe(true)
  })

  it('finds a heading whose own words match, even with nothing under it', () => {
    const hits = searchGuide(guideSections('## Sonar\n'), 'sonar')
    expect(hits.map((hit) => hit.title)).toEqual(['Sonar'])
  })

  it('cuts a long line around the words rather than from its start', () => {
    const line = `${'a'.repeat(200)} needle ${'b'.repeat(200)}`
    const hits = searchGuide(guideSections(`## Long\n\n${line}\n`), 'needle')
    expect(hits[0]?.excerpt).toContain('needle')
    expect(hits[0]?.excerpt.length).toBeLessThanOrEqual(142)
    expect(hits[0]?.excerpt.startsWith('…')).toBe(true)
  })

  // An excerpt that opens or closes in the middle of a word reads as a mistake in the guide itself.
  it('cuts an excerpt at a word, at both ends', () => {
    // The 40 characters before the match land inside "incontrovertible", so a cut that ignored words would show it.
    const before = 'one two three four five six seven incontrovertible eight nine ten eleven twelve'
    const after = 'november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu'
    const hits = searchGuide(guideSections(`## Long\n\n${before} needle ${after}\n`), 'needle')
    const excerpt = hits[0]?.excerpt ?? ''
    const inner = excerpt.replaceAll('…', '')
    expect(inner).toContain('needle')
    // Whatever it starts and ends with is a whole word of the line.
    const words = `${before} needle ${after}`.split(' ')
    expect(words).toContain(inner.split(' ')[0])
    expect(words).toContain(inner.split(' ').at(-1))
  })

  it('has nothing to list for a guide with no headings at all', () => {
    expect(guideSections('just some words\n')).toEqual([])
    expect(guideContents([])).toEqual([])
    expect(searchGuide([], 'anything')).toEqual([])
  })

  // Jam Desktop draws a link within the manual as a control that jumps, and a link to another of its documents as
  // plain text. A link that names no section of the guide would land nowhere, so it is not one either.
  it('finds the section a link within the guide points at, and nothing else', () => {
    const sections = guideSections(guide)
    expect(anchorTarget('#home', sections)).toBe('home')
    expect(anchorTarget('#Home', sections)).toBe('home')
    expect(anchorTarget('#start-here', sections)).toBe('start-here')
    expect(anchorTarget('#start%20here', sections)).toBe('start-here')
    expect(anchorTarget('#start%here', sections)).toBe('start-here')
    // A heading of punctuation alone keeps the id a name of nothing falls back to, and a link can name it.
    expect(anchorTarget('#section', sections)).toBe('section')
    for (const outside of [
      undefined,
      '',
      '#',
      '#inbox',
      'advanced-reference.md#home',
      './agent-connection-states.md',
      'human-in-the-loop.md',
      'https://band.ai/#home',
      'mailto:someone@example.com',
      '/home',
    ]) {
      expect(anchorTarget(outside, sections)).toBeNull()
    }
  })

  // The list marks the section being read (user guide, "Documentation"): the last heading to have passed the line.
  it('follows the reading position down the guide', () => {
    const tops = (...at: number[]) => at.map((top, index) => ({ id: `s${index}`, top }))
    expect(readingSection([], READING_LINE)).toBeNull()
    // At the top of the guide, the first section - its title, which has no entry, so nothing is marked.
    expect(readingSection(tops(0, 400, 900), READING_LINE)).toBe('s0')
    // A heading exactly on the line has been reached, which is where a jump lands one; a pixel below it has not.
    expect(readingSection(tops(-500, READING_LINE, 900), READING_LINE)).toBe('s1')
    expect(readingSection(tops(-500, READING_LINE + 1, 900), READING_LINE)).toBe('s0')
    // Further down, and at the end of the guide.
    expect(readingSection(tops(-900, -400, 20), READING_LINE)).toBe('s2')
    expect(readingSection(tops(-2000, -1500, -900), READING_LINE)).toBe('s2')
    // Above the first heading nothing has been reached, and the first section stands.
    expect(readingSection(tops(100, 500, 1000), READING_LINE)).toBe('s0')
  })

  // A mark out of sight marks nothing, and the page must never move because the list marked something.
  it('scrolls the list just far enough to show the marked entry, and not at all when it is in view', () => {
    const rail = { top: 100, bottom: 400, scrollTop: 250 }
    // Inside the list, including exactly on either edge: it does not move.
    expect(railScroll(rail, { top: 180, bottom: 210 })).toBe(250)
    expect(railScroll(rail, { top: 100, bottom: 130 })).toBe(250)
    expect(railScroll(rail, { top: 370, bottom: 400 })).toBe(250)
    // Above it: up by the gap, and no further.
    expect(railScroll(rail, { top: 60, bottom: 90 })).toBe(210)
    // Below it: down by the gap.
    expect(railScroll(rail, { top: 430, bottom: 460 })).toBe(310)
    // A list that has not scrolled yet never goes above its own top.
    expect(railScroll({ top: 0, bottom: 300, scrollTop: 0 }, { top: 0, bottom: 30 })).toBe(0)
  })

  it('says why there is no guide, differently for each reason', () => {
    const reasons = (['no-daemon', 'not-found', 'unreadable'] as const).map(guideProblem)
    expect(new Set(reasons).size).toBe(3)
    expect(reasons.every((one) => one.length > 0)).toBe(true)
    expect(reasons[0]).toMatch(/Band is not running/)
  })
})
