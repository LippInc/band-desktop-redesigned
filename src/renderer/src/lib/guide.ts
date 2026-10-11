import { excerptOf } from '@/lib/excerpt'

/**
 * Jam's user guide as the Documentation screen shows it. The guide is Jam's own Markdown, read from the Jam install
 * at run time and never copied into this project; nothing here rewrites it. What this file does is find its headings,
 * so the screen can list them and jump, and search them the way Jam's own search does (two characters, a heading and
 * an excerpt).
 */

export interface GuideSection {
  /** A value for the anchor and the list: the heading's own text, made safe for an id. */
  id: string
  title: string
  /** 1 for the guide's own title, 2 for a part, 3 for a page within it. */
  level: number
  /** The lines under this heading, before the next of the same level or higher. */
  body: string
}

/** Jam's search wants two characters before it looks (user guide, "Documentation"). */
export const SEARCH_MIN = 2

/** The guide's headings, in its own order, each with the text under it. */
export function guideSections(markdown: string): GuideSection[] {
  const sections: GuideSection[] = []
  let current: GuideSection | null = null
  let fenced = false
  const seen = new Map<string, number>()
  for (const line of markdown.split('\n')) {
    // A heading inside a fenced block is part of an example, not a heading of the guide.
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const heading = fenced ? null : /^(#{1,3})\s+(.*\S)\s*$/.exec(line)
    if (heading) {
      const title = heading[2] as string
      const base = slug(title)
      const taken = seen.get(base) ?? 0
      seen.set(base, taken + 1)
      current = { id: taken === 0 ? base : `${base}-${taken}`, title, level: (heading[1] as string).length, body: '' }
      sections.push(current)
      continue
    }
    if (current) current.body += `${line}\n`
  }
  return sections
}

/** An id from a heading: letters, digits and single dashes, so an anchor never carries the heading's punctuation. */
function slug(title: string): string {
  const id = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return id === '' ? 'section' : id
}

export interface GuideEntry {
  section: GuideSection
  children: GuideSection[]
}

/**
 * The list beside the guide, as Jam draws it: a part, then the pages within it. The guide's own title is left out -
 * the screen shows it as its heading.
 */
export function guideContents(sections: readonly GuideSection[]): GuideEntry[] {
  const entries: GuideEntry[] = []
  for (const section of sections) {
    if (section.level <= 1) continue
    if (section.level === 2 || entries.length === 0) entries.push({ section, children: [] })
    else entries[entries.length - 1]?.children.push(section)
  }
  return entries
}

export interface GuideHit {
  id: string
  title: string
  /** The line the words were found on, cut to a readable length, or the heading's first line. */
  excerpt: string
}

/**
 * What Jam's search finds: the headings and the text whose words match, each with the line they were found on.
 * Under two characters it finds nothing, because a single letter matches most of a guide.
 */
export function searchGuide(sections: readonly GuideSection[], query: string): GuideHit[] {
  const needle = query.trim().toLowerCase()
  if (needle.length < SEARCH_MIN) return []
  const hits: GuideHit[] = []
  for (const section of sections) {
    const inTitle = section.title.toLowerCase().includes(needle)
    const line = section.body.split('\n').find((one) => one.toLowerCase().includes(needle))
    if (!inTitle && !line) continue
    hits.push({ id: section.id, title: section.title, excerpt: excerptOf(line ?? firstLine(section.body), needle) })
  }
  return hits
}

function firstLine(body: string): string {
  return body.split('\n').find((line) => line.trim() !== '') ?? ''
}

/**
 * The section a link in the guide points at, or null when it points outside it. Jam's own guide holds two kinds of
 * link, and Jam Desktop draws them differently: a link within the manual (`#inbox`) is a control that jumps, and a
 * link to another file of Jam's documentation is plain text, because that file is not in the guide. This app does the
 * same, and a link to a section the guide does not have stays plain text too: a link that would land nowhere is not
 * one.
 */
export function anchorTarget(href: string | undefined, sections: readonly GuideSection[]): string | null {
  if (href === undefined || !href.startsWith('#') || href.length === 1) return null
  const name = slug(decoded(href.slice(1)))
  return sections.some((one) => one.id === name) ? name : null
}

/** An anchor written with escapes (`#a%20b`) names the same section; a broken escape is read as the text it is. */
function decoded(name: string): string {
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/**
 * How far below the top of the view a heading counts as reached. A jump lands a heading on the section's own scroll
 * margin, so the line sits just below it.
 */
export const READING_LINE = 32

/**
 * The section being read, which the list marks (user guide, "Documentation": the active section follows your reading
 * position). It is the last heading to have passed the line; before the first one has, it is the first section, which
 * is the guide's title and has no entry, so nothing is marked at the top of the guide.
 *
 * `tops` are the sections in the guide's order, each measured from the top of the view.
 */
export function readingSection(tops: readonly { id: string; top: number }[], line: number): string | null {
  let reading: string | null = tops[0]?.id ?? null
  for (const one of tops) {
    if (one.top > line) break
    reading = one.id
  }
  return reading
}

/**
 * Where the list must stand for the marked entry to be in its own view, and no further: a mark out of sight marks
 * nothing. It moves the list alone - the page never scrolls because the list marked something.
 */
export function railScroll(
  rail: { top: number; bottom: number; scrollTop: number },
  item: { top: number; bottom: number },
): number {
  if (item.top < rail.top) return rail.scrollTop - (rail.top - item.top)
  if (item.bottom > rail.bottom) return rail.scrollTop + (item.bottom - rail.bottom)
  return rail.scrollTop
}

/** Why the guide cannot be shown, in this app's own words: Jam has none for a guide it always ships with. */
export function guideProblem(state: 'no-daemon' | 'not-found' | 'unreadable'): string {
  switch (state) {
    case 'no-daemon':
      return 'The guide is read from the Band install on this computer, and Band is not running, so it has not said where it is.'
    case 'not-found':
      return 'No user guide sits beside the Band daemon on this computer. The official app shows the same guide.'
    case 'unreadable':
      return 'The user guide beside the Band daemon could not be read.'
  }
}
