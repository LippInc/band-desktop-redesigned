import { InboxSnapshotSchema, toInbox, type InboxRead } from '@shared/daemon'
import type { DaemonEvent } from '@shared/daemon-api'

/** One event larger than this is dropped whole; the stream goes on. An inbox with many open items can be large. */
export const MAX_EVENT_BYTES = 2 * 1024 * 1024

/** An event as the parser read it: its name for the page, and the person's inbox when the event carried it. */
export interface ParsedEvent extends DaemonEvent {
  inbox?: { profile: string; read: InboxRead }
}

/**
 * Splits the daemon's /v1/events stream into events. The stream answers 200 with chunked transfer and no content type,
 * one JSON object per line (recorded 2026-09-19: `{"peer": "human/<profile>", "kind": {"kind": "inbox_snapshot",
 * "profile": ..., "snapshot": {...}}}`, the event's name inside `kind` beside its content). Anything that is not such a
 * line is dropped: unknown events are ignored, never fatal. The event's name leaves this parser, and one content: the
 * person's inbox (`inbox_snapshot`), validated against its schema; an inbox that does not fit it leaves as `changed`, so
 * the one before it is not shown as if it were current.
 */
export class EventLineParser {
  #buffer = ''
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  push(text: string): ParsedEvent[] {
    this.#buffer += text
    const events: ParsedEvent[] = []
    let newline = this.#buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.#buffer.slice(0, newline).replace(/\r$/, '')
      this.#buffer = this.#buffer.slice(newline + 1)
      const event = this.#parseLine(line)
      if (event) events.push(event)
      newline = this.#buffer.indexOf('\n')
    }
    // A line that never ends is not allowed to grow without limit.
    if (this.#buffer.length > MAX_EVENT_BYTES) this.#buffer = ''
    return events
  }

  #parseLine(line: string): ParsedEvent | null {
    const data = line.trim()
    if (!data.startsWith('{') || data.length > MAX_EVENT_BYTES) return null
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      return null
    }
    if (!isObject(payload)) return null
    const kind = isObject(payload.kind) ? payload.kind : undefined
    const name = kind?.kind
    const event: ParsedEvent = { receivedAt: this.#now(), kind: typeof name === 'string' ? name.slice(0, 100) : null }
    if (name === 'inbox_snapshot' && kind && typeof kind.profile === 'string' && kind.profile.length <= 64) {
      const snapshot = InboxSnapshotSchema.safeParse(kind.snapshot)
      event.inbox = {
        profile: kind.profile,
        read: snapshot.success ? { state: 'ready', inbox: toInbox(snapshot.data) } : { state: 'changed' },
      }
    }
    return event
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
