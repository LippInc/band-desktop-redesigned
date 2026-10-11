import { describe, expect, it } from 'vitest'
import type { Inbox, PermissionRecord, RoomMessage } from '@shared/daemon'
import type { InboxEntry } from './inbox'
import { dismissibleEntry, inboxCount, inboxEntries, inboxTime } from './inbox'

const ROOM = '5b0f6c2e-8d1a-4c3b-9e7f-2a4d6b8c0e11'
/** The invisible marker Jam puts at the end of an agent's question, built here as the fixtures build it. */
const MARKER = String.fromCharCode(0x20_63)

const message = (fields: Partial<RoomMessage> & { id: string; inserted_at: string }): RoomMessage => ({
  message_type: 'text',
  content: '',
  cut: false,
  sender_id: 'agent-1',
  sender_name: 'Atlas',
  sender_type: 'Agent',
  mention_names: {},
  tool_name: null,
  system_event: null,
  attachments: 0,
  ...fields,
})

const question = (code: string) => ({
  id: `q-${code}`,
  answer_code: code,
  prompt: 'Which payment provider?',
  options: ['Stripe', 'Adyen'],
})

const permission = (id: string, createdAt: number): { peerKey: string; record: PermissionRecord } => ({
  peerKey: 'default/nova',
  record: {
    request: {
      id,
      chat_id: ROOM,
      action: 'Write',
      description: 'Write to checkout.ts',
      created_at: createdAt,
    },
    status: 'pending',
  } as PermissionRecord,
})

const inbox = (parts: Partial<Inbox>): Inbox => ({
  permissions: [],
  questions: [],
  answered: [],
  mentions: [],
  unreadable: 0,
  overflow: 0,
  truncated: 0,
  ...parts,
})

describe("Inbox's list", () => {
  it('puts what waits first, approvals before questions, then the mentions newest first', () => {
    const entries = inboxEntries(
      inbox({
        permissions: [permission('req-1', 1_000)],
        questions: [{ peerKey: 'default/atlas', roomId: ROOM, question: question('AAAA1111') }],
        mentions: [
          {
            message: message({ id: 'm-old', inserted_at: '2026-09-19T09:00:00Z', content: 'older' }),
            roomId: ROOM,
            done: false,
          },
          {
            message: message({ id: 'm-new', inserted_at: '2026-09-19T11:00:00Z', content: 'newer' }),
            roomId: ROOM,
            done: false,
          },
        ],
      }),
    )
    expect(entries.map((entry) => [entry.kind, entry.id])).toEqual([
      ['permission', 'req-1'],
      ['question', `question:${ROOM}:AAAA1111`],
      ['mention', 'm-new'],
      ['mention', 'm-old'],
    ])
    expect(inboxCount(inbox({ mentions: [] }))).toBe(0)
  })

  it('counts what the daemon is holding back as well as what it lists, as Jam counts both', () => {
    const held = inbox({
      mentions: [{ message: message({ id: 'm-1', inserted_at: '2026-09-19T09:00:00Z' }), roomId: ROOM, done: false }],
      overflow: 4,
    })
    expect(inboxEntries(held)).toHaveLength(1)
    expect(inboxCount(held)).toBe(5)
  })

  it('leaves out a mention the person has dismissed, and a request already decided', () => {
    const decided = permission('req-done', 1)
    const entries = inboxEntries(
      inbox({
        permissions: [{ ...decided, record: { ...decided.record, status: 'allowed' } }],
        mentions: [
          {
            message: message({ id: 'm-1', inserted_at: '2026-09-19T09:00:00Z' }),
            roomId: ROOM,
            done: true,
          },
        ],
      }),
    )
    expect(entries).toEqual([])
  })

  it("shows an agent's question as the one message that asks it, with its options, not twice", () => {
    const asks = message({
      id: 'm-question',
      inserted_at: '2026-09-19T10:00:00Z',
      content: `@[[me]] Which payment provider?\n\nReply with \`Answer AAAA1111: <answer>\`.\n${MARKER}jam-hitl-question${MARKER}q-1`,
      mention_names: { me: 'Sam Rivera' },
    })
    const entries = inboxEntries(
      inbox({
        questions: [{ peerKey: 'default/atlas', roomId: ROOM, question: question('AAAA1111') }],
        mentions: [{ message: asks, roomId: ROOM, done: false }],
      }),
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]?.kind).toBe('question')
    expect(entries[0]?.question?.options).toEqual(['Stripe', 'Adyen'])
    // The row reads as Jam's rows read: the marker, the answer instruction and the mention are all gone from it.
    expect(entries[0]?.excerpt).toBe('Which payment provider?')
  })

  it("drops a row's mentions, as Jam's rows do, and leaves the detail's own text for the renderer", () => {
    // A display name comes from the daemon like everything else, and one can read as Markdown.
    const hostile = message({
      id: 'm-hostile',
      inserted_at: '2026-09-19T10:00:00Z',
      content: '@[[someone]] please look',
      mention_names: { someone: '[Verify your account](https://evil.example)' },
    })
    const [entry] = inboxEntries(inbox({ mentions: [{ message: hostile, roomId: ROOM, done: false }] }))
    // The row is the message without its mentions, so no name of the daemon's reaches it at all.
    expect(entry?.excerpt).toBe('please look')
    // The detail keeps the message as the daemon wrote it: the renderer writes each mention in, escaping as it goes.
    expect(entry?.body).toBe('@[[someone]] please look')
    expect(entry?.body).not.toContain('evil.example')
  })

  it('lists a request for a decision once: as the request, never also as the message that asked', () => {
    // Jam's own opening for that message, recorded from the daemon's stream on 2026-09-19.
    const asks = message({
      id: 'm-permission',
      inserted_at: '2026-09-19T11:44:45Z',
      content: `${String.fromCodePoint(0x1_f5_10)} Permission needed: @[[me]] Claude Code Write: {"file_path":"a.md"}`,
    })
    const entries = inboxEntries(
      inbox({
        permissions: [permission('req-1', 1_000)],
        mentions: [{ message: asks, roomId: ROOM, done: false }],
      }),
    )
    expect(entries.map((entry) => entry.kind)).toEqual(['permission'])
  })

  it('raises a question that arrived as a mention above the mentions that are only to read', () => {
    const asks = message({
      id: 'm-asks',
      inserted_at: '2026-09-19T09:00:00Z',
      content: `Which payment provider?\n\nReply with \`Answer DDDD4444: <answer>\`.\n${MARKER}jam-hitl-question${MARKER}q-4`,
    })
    const chatter = message({
      id: 'm-chatter',
      inserted_at: '2026-09-19T12:00:00Z',
      content: 'newer, but only to read',
    })
    const entries = inboxEntries(
      inbox({
        questions: [{ peerKey: 'default/atlas', roomId: ROOM, question: question('DDDD4444') }],
        mentions: [
          { message: asks, roomId: ROOM, done: false },
          { message: chatter, roomId: ROOM, done: false },
        ],
      }),
    )
    expect(entries.map((entry) => entry.id)).toEqual(['m-asks', 'm-chatter'])
  })

  it('shows a question whose message is no longer among the mentions', () => {
    const entries = inboxEntries(
      inbox({ questions: [{ peerKey: 'default/atlas', roomId: ROOM, question: question('BBBB2222') }] }),
    )
    expect(entries.map((entry) => entry.kind)).toEqual(['question'])
    expect(entries[0]?.excerpt).toBe('Which payment provider?')
  })

  it('reads an answered question as a mention again, since it no longer waits', () => {
    const asks = message({
      id: 'm-answered',
      inserted_at: '2026-09-19T10:00:00Z',
      content: `Which payment provider?\n\nReply with \`Answer CCCC3333: <answer>\`.\n${MARKER}jam-hitl-question${MARKER}q-3`,
    })
    const entries = inboxEntries(inbox({ mentions: [{ message: asks, roomId: ROOM, done: false }] }))
    expect(entries[0]?.kind).toBe('question')
    expect(entries[0]?.question).toBeNull()
  })
})

describe('what Jam\u2019s quiet dismiss takes, row by row', () => {
  /** The one entry a fixture lists, proven to be there before it is asked about. */
  const entry = (parts: Partial<Inbox>): InboxEntry => {
    const first = inboxEntries(inbox(parts))[0]
    if (!first) throw new Error('the fixture built no entry')
    return first
  }

  it('takes a routine mention, and a question already answered - Jam\u2019s own capture shows its X on both', () => {
    const read = entry({
      mentions: [{ message: message({ id: 'm-1', inserted_at: '2026-09-19T09:00:00Z' }), roomId: ROOM, done: false }],
    })
    expect(read.kind).toBe('mention')
    expect(dismissibleEntry(read)).toBe(true)

    const asks = message({
      id: 'm-answered',
      inserted_at: '2026-09-19T10:00:00Z',
      content: `Which payment provider?\n\nReply with \`Answer CCCC3333: <answer>\`.\n${MARKER}jam-hitl-question${MARKER}q-3`,
    })
    const answered = entry({ mentions: [{ message: asks, roomId: ROOM, done: false }] })
    expect(answered.kind).toBe('question')
    expect(answered.question).toBeNull()
    expect(dismissibleEntry(answered)).toBe(true)
  })

  it('never takes a question still waiting, one whose message is gone, or a permission request', () => {
    const asks = message({
      id: 'm-asks',
      inserted_at: '2026-09-19T09:00:00Z',
      content: `Which payment provider?\n\nReply with \`Answer DDDD4444: <answer>\`.\n${MARKER}jam-hitl-question${MARKER}q-4`,
    })
    const waiting = entry({
      questions: [{ peerKey: 'default/atlas', roomId: ROOM, question: question('DDDD4444') }],
      mentions: [{ message: asks, roomId: ROOM, done: false }],
    })
    expect(waiting.question).not.toBeNull()
    expect(dismissibleEntry(waiting)).toBe(false)

    const orphaned = entry({ questions: [{ peerKey: 'default/atlas', roomId: ROOM, question: question('BBBB2222') }] })
    expect(dismissibleEntry(orphaned)).toBe(false)

    const request = entry({ permissions: [permission('req-1', 1_000)] })
    expect(dismissibleEntry(request)).toBe(false)
  })
})

/** A moment in September 2026, read in the machine's own time zone, as an Inbox row's time is. */
const on = (day: number, hour: number, minute: number) => new Date(2026, 8, day, hour, minute).getTime()

describe('the time on an Inbox row, as Jam Desktop writes it', () => {
  const now = on(20, 18, 0)

  it.each([
    [on(20, 16, 58), '4:58 pm'],
    [on(20, 9, 5), '9:05 am'],
    [on(20, 0, 30), '12:30 am'],
    [on(19, 16, 58), 'Yesterday 4:58 pm'],
  ])('%s reads %s', (ms, text) => {
    expect(inboxTime(ms, now)).toBe(text)
  })

  it('has nothing to say for an item with no time of its own', () => {
    expect(inboxTime(0, now)).toBe('')
  })

  it('falls back to the date for anything older, which Jam has not been seen writing', () => {
    expect(inboxTime(on(12, 16, 58), now)).toMatch(/4:58 pm$/)
    expect(inboxTime(on(12, 16, 58), now)).not.toContain('Yesterday')
  })
})
