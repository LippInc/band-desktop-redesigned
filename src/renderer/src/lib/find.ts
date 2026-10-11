import type { RoomMessage } from '@shared/daemon'
import { excerptOf } from '@/lib/excerpt'
import { inboxTime } from '@/lib/inbox'
import { withMentionNames } from '@/lib/messages'

/**
 * Find in conversation (Jam Desktop 0.4.10 shows the control in a room's header, before Event type): the words a
 * person is looking for, in the conversation on screen. Jam waits for two characters, as its search of the guide
 * does, and puts the newest match first.
 */

/** Jam's search waits for two characters (`docs/jam/features.md`, "Find in the room"). */
export const FIND_MIN = 2

export interface FindResult {
  /** The messages the words are in, newest first. */
  ids: string[]
  /** Which of them is being looked at, or -1 for none. */
  at: number
}

export const NO_MATCHES: FindResult = { ids: [], at: -1 }

/** One match, as Jam lists it: who said it, when, and the part that matched (user guide, "Use Chat"). */
export interface FindHit {
  id: string
  sender: string
  time: string
  excerpt: string
}

/**
 * The messages whose text carries the words, newest first. `messages` is the conversation as the room shows it -
 * what the filters left - so every match can be reached; a match hidden behind a filter could not be.
 */
export function findResults(messages: readonly RoomMessage[], query: string): FindHit[] {
  const needle = query.trim().toLowerCase()
  if (needle.length < FIND_MIN) return []
  const found: FindHit[] = []
  for (const message of messages) {
    const line = matchingLine(withMentionNames(message.content, message.mention_names), needle)
    if (line === null) continue
    found.push({
      id: message.id,
      sender: message.sender_name ?? 'Unknown',
      time: findTime(message.inserted_at),
      excerpt: excerptOf(line, needle, false),
    })
  }
  return found.toReversed()
}

/**
 * When a match was said. The conversation carries a divider per day, so its messages show the clock alone; a flat
 * list of matches has none, and five results at the same hour of different days would read alike.
 */
function findTime(at: string): string {
  const ms = new Date(at).getTime()
  return Number.isNaN(ms) ? '' : inboxTime(ms)
}

/** The line of a message the words are on: what is shown of a match, rather than the whole of a long message. */
function matchingLine(content: string, needle: string): string | null {
  const lines = content.split(String.fromCharCode(10))
  const line = lines.find((one) => one.toLowerCase().includes(needle))
  return line ?? null
}

/** The match after this one, wrapping at the end, and the one before it, wrapping at the start. */
export function stepMatch(result: FindResult, by: 1 | -1): FindResult {
  if (result.ids.length === 0) return NO_MATCHES
  const at = (result.at + by + result.ids.length) % result.ids.length
  return { ...result, at }
}

/** What the count says beside the field: Jam's own "1 of 7", and nothing to count before two characters. */
export function matchCount(result: FindResult, query: string): string | null {
  if (query.trim().length < FIND_MIN) return null
  if (result.ids.length === 0) return 'No matches'
  return `${result.at + 1} of ${result.ids.length}`
}
