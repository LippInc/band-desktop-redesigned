/**
 * What the page learns about Jam's own user guide. The text, or why there is none - never where it was read
 * from: a path from this machine is not something a page needs (`src/main/guide.ts`).
 */
export type GuideRead =
  | { state: 'read'; markdown: string }
  /** Jam is not running, so it has not said where it is installed. */
  | { state: 'no-daemon' }
  /** The daemon answered, but no guide sits beside it. */
  | { state: 'not-found' }
  /** A guide is there and could not be read (permissions, a file that is not text, one too large). */
  | { state: 'unreadable' }
