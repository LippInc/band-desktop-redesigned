import { HISTORY_MAX_PAGES, type RoomHistoryPage, type RoomMessage } from '@shared/daemon'

/**
 * Reading a room's conversation past the snapshot the daemon keeps. Band hands a room's messages back a page at a
 * time, **newest page first** (`RoomHistorySchema`), so the pages come back in the reverse of the order they are read
 * in: page 1 is the end of the conversation, and the last page is its beginning.
 */

/** Why the reading stopped. Only `end` means the conversation was read to its first message. */
export type StoppedBecause =
  | /** The daemon said there was nothing older. */ 'end'
  | /** The most pages this app reads at once. */ 'bound'
  | /** The daemon stopped saying whether there was more, which is not the same as saying there is none. */ 'silent'
  | /** A page could not be read. What was read before it is kept. */ 'error'

export interface WholeConversation {
  /** Every message read, oldest first. */
  messages: RoomMessage[]
  /** Messages the daemon listed in a format this app cannot read (left out, and counted). */
  unreadable: number
  stopped: StoppedBecause
  /** How many pages were read. */
  pages: number
  /** What went wrong, when a page could not be read. */
  error?: unknown
}

/**
 * The pages in the order a conversation is read in: the last page read holds the oldest messages, and within a page
 * they are oldest first. A message the daemon listed on two pages (a message sent while the pages are being read
 * shifts them) is kept once, at its oldest place.
 */
export function mergePages(pages: readonly (readonly RoomMessage[])[]): RoomMessage[] {
  const messages: RoomMessage[] = []
  const seen = new Set<string>()
  for (const page of pages.toReversed()) {
    for (const message of page) {
      if (seen.has(message.id)) continue
      seen.add(message.id)
      messages.push(message)
    }
  }
  return messages
}

/**
 * Whether the daemon said there are older messages behind this page. `has_more` when it said; otherwise the page
 * count, when it gave one; and null when it said neither - which is not the same as saying there are none.
 */
function moreBehind(answer: RoomHistoryPage, page: number): boolean | null {
  if (answer.hasMore !== null) return answer.hasMore
  return answer.totalPages === null ? null : page < answer.totalPages
}

/**
 * Reads a conversation from its newest page back to its first. It stops when the daemon says there is no more, when
 * the daemon stops saying, at `max` pages, or at a page that could not be read - and in every case keeps what it read
 * and says which it was. Only "the daemon said there is no more" means the conversation was read whole: a missing
 * answer is never read as an empty one.
 */
export async function readWholeConversation(
  read: (page: number) => Promise<RoomHistoryPage>,
  max: number = HISTORY_MAX_PAGES,
): Promise<WholeConversation> {
  const pages: RoomMessage[][] = []
  let unreadable = 0
  let stopped: StoppedBecause = 'bound'
  let error: unknown
  for (let page = 1; page <= max; page++) {
    let answer: RoomHistoryPage
    try {
      answer = await read(page)
    } catch (failure) {
      // What was read before this page is worth keeping: the next attempt need not start from nothing.
      stopped = 'error'
      error = failure
      break
    }
    pages.push(answer.messages)
    unreadable += answer.unreadable
    const more = moreBehind(answer, page)
    if (more !== true) {
      stopped = more === false ? 'end' : 'silent'
      break
    }
  }
  return { messages: mergePages(pages), unreadable, stopped, pages: pages.length, ...(error ? { error } : {}) }
}

/**
 * The conversation as the room shows it: what was read before the snapshot, then the snapshot's own messages, each
 * one once. The snapshot is read again whenever the daemon announces a change, so what was read before it is kept
 * beside it rather than folded into it.
 *
 * Only what is older than the snapshot's first message is put in front of it: a message said while the pages were
 * being read belongs where the snapshot puts it, not at the head of the room.
 */
export function withEarlier(earlier: readonly RoomMessage[], messages: readonly RoomMessage[]): RoomMessage[] {
  const known = new Set(messages.map((message) => message.id))
  const first = messages[0]?.inserted_at
  const before = earlier.filter(
    (message) => !known.has(message.id) && (first === undefined || message.inserted_at < first),
  )
  return [...before, ...messages]
}
