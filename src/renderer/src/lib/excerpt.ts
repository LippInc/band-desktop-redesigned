/**
 * A line of text cut around the words found in it, so a match in a long paragraph is in view rather than off the
 * end. Both cuts land on a word: an excerpt that opens or closes mid-word reads as a mistake in what was said.
 * The guide's search and a room's Find both show one.
 */

const EXCERPT_CHARS = 140
const EXCERPT_LEAD = 40

export function excerptOf(line: string, needle: string, stripMarkdown = true): string {
  // The guide's own lines open with Markdown that is not part of what was written; a message's do not, and stripping
  // it there would eat the very words that matched (`--force`, `*args`, `#include`).
  const text = (stripMarkdown ? line.replace(/^[#>\-*\s]+/, '') : line).trim()
  const at = text.toLowerCase().indexOf(needle)
  const wanted = at < 0 ? 0 : Math.max(0, at - EXCERPT_LEAD)
  const from = wanted === 0 ? 0 : wordAfter(text, wanted, at < 0 ? text.length : at)
  const wantedEnd = from + EXCERPT_CHARS
  const to = wantedEnd >= text.length ? text.length : wordBefore(text, wantedEnd, at < 0 ? from : at + needle.length)
  return `${from > 0 ? '…' : ''}${text.slice(wholeFrom(text, from), wholeTo(text, to)).trim()}${to < text.length ? '…' : ''}`
}

// JavaScript counts a character outside the basic set - an emoji, most symbols - as two units, so a cut that falls
// between them leaves half a character, which shows as a replacement box. Neither cut lands inside one: each moves
// inwards by the one unit, which only ever shortens the excerpt.
const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff

/** The start, moved past the trailing half of a character the cut would otherwise open in the middle of. */
function wholeFrom(text: string, from: number): number {
  return isLow(text.charCodeAt(from)) ? from + 1 : from
}

/** The end, moved back off the leading half of a character the cut would otherwise close in the middle of. */
function wholeTo(text: string, to: number): number {
  return isHigh(text.charCodeAt(to - 1)) ? to - 1 : to
}

/** The start of the first word at or after `from`, unless that would pass `limit`. */
function wordAfter(text: string, from: number, limit: number): number {
  const space = text.indexOf(' ', from)
  return space >= 0 && space + 1 <= limit ? space + 1 : from
}

/** The end of the last whole word before `to`, unless that would fall before `limit`. */
function wordBefore(text: string, to: number, limit: number): number {
  const space = text.lastIndexOf(' ', to)
  return space >= limit ? space : to
}
