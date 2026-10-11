import type { AgentQuestion, Inbox, InboxMention, PermissionRecord, RoomMessage } from '@shared/daemon'
import { isPermissionMessage, questionCardOf, withoutMentions } from '@/lib/messages'

/** The calendar day before `now`, by the calendar rather than by 24 hours: a day that springs forward is shorter. */
function yesterday(now: number): Date {
  const day = new Date(now)
  day.setDate(day.getDate() - 1)
  return day
}

/**
 * One row of Inbox (user guide, "Inbox": "direct mentions and human requests across rooms").
 *
 * A direct mention is a message of the room's own, so an agent's question arrives here as the message that asks it:
 * Jam Desktop 0.4.10 lists those questions among the mentions, not beside them, and this app does the same. A question
 * still waiting on the person carries its options, so the row can be answered from here. A permission request has no
 * message of its own and is a row in its own right.
 */
export interface InboxEntry {
  id: string
  kind: 'mention' | 'question' | 'permission'
  roomId: string
  /** When it arrived, for the list's order and its time. */
  at: number
  /** Who it came from, as the room names them. */
  from: string
  /** The line the row shows under the sender: plain words, with each mention written as a name. */
  excerpt: string
  /**
   * What the detail shows: the message's own Markdown, mentions still written `@[[id]]`. The renderer substitutes and
   * escapes them itself, so a name that reads as Markdown cannot become Markdown.
   */
  body: string
  message: RoomMessage | null
  /** The question this row asks, while it waits on the person. */
  question: AgentQuestion | null
  /** The agent's local key, for a request this app can decide. */
  peerKey: string | null
  record: PermissionRecord | null
}

const at = (iso: string | undefined): number => {
  const ms = iso ? Date.parse(iso) : Number.NaN
  return Number.isNaN(ms) ? 0 : ms
}

/** A mention's row: an agent's question if its message asks one and that question is still open. */
function entryOfMention(mention: InboxMention, questions: Inbox['questions']): InboxEntry {
  const { message } = mention
  const card = questionCardOf(message)
  const open = card
    ? (questions.find(
        (item) => item.roomId === mention.roomId && item.question.answer_code.toUpperCase() === card.answerCode,
      ) ?? null)
    : null
  const text = (card ? card.text : message.content).trim()
  return {
    id: message.id,
    kind: card ? 'question' : 'mention',
    roomId: mention.roomId,
    at: at(message.inserted_at),
    from: message.sender_name || 'Someone',
    excerpt: withoutMentions(text),
    body: text,
    message,
    question: open?.question ?? null,
    peerKey: open?.peerKey ?? null,
    record: null,
  }
}

function entryOfPermission(item: { peerKey: string; record: PermissionRecord }): InboxEntry {
  const { request } = item.record
  return {
    id: request.id,
    kind: 'permission',
    roomId: request.chat_id ?? '',
    at: request.created_at ?? 0,
    from: item.peerKey.split('/').pop() || 'An agent',
    excerpt: request.action ? `Permission: ${request.action}` : 'Permission request',
    body: request.description,
    message: null,
    question: null,
    peerKey: item.peerKey,
    record: item.record,
  }
}

/** A question still waiting whose own message is not among the mentions: its row is built from the question. */
function entryOfQuestion(item: { peerKey: string; roomId: string; question: AgentQuestion }): InboxEntry {
  return {
    id: `question:${item.roomId}:${item.question.answer_code}`,
    kind: 'question',
    roomId: item.roomId,
    // A question carries no time of its own; its row sits with the others waiting, above the mentions.
    at: 0,
    from: item.peerKey.split('/').pop() || 'An agent',
    excerpt: item.question.prompt,
    body: item.question.prompt,
    message: null,
    question: item.question,
    peerKey: item.peerKey,
    record: null,
  }
}

/**
 * Inbox's list: the mentions the person has not dismissed, and the human requests still waiting, newest first as Jam
 * Desktop lists them. An agent's question usually arrives as a mention, since it addresses the person, and that one row
 * carries it; a question whose message is not among the mentions still gets a row of its own, so nothing waiting is
 * missing. A mention the daemon has dropped is not here to show: how many it dropped is `inbox.overflow` and
 * `inbox.truncated`, which the page says in Jam's words.
 */
export function inboxEntries(inbox: Inbox | null): InboxEntry[] {
  if (!inbox) return []
  const mentions = inbox.mentions
    // A request for a decision is listed as the request, never also as the message that asked for it.
    .filter((mention) => !mention.done && !isPermissionMessage(mention.message))
    .map((mention) => entryOfMention(mention, inbox.questions))
  // A question is matched to its message by room and code together, so one room's question cannot hide another's.
  const asked = new Set(
    mentions.flatMap((entry) => (entry.question ? [`${entry.roomId} ${entry.question.answer_code}`] : [])),
  )
  const questions = inbox.questions
    .filter((item) => !asked.has(`${item.roomId} ${item.question.answer_code}`))
    .map((item) => entryOfQuestion(item))
  const permissions = inbox.permissions
    .filter((item) => item.record.status === 'pending')
    .map((item) => entryOfPermission(item))
  // What waits on the person comes first, approvals before questions, as Home orders its Needs attention; then what
  // is only to read, newest first, as Jam Desktop lists its mentions. A question that arrived as a mention is still
  // waiting, so it rises with the rest. Where Jam puts a waiting request among its mentions was not seen.
  const waiting = mentions.filter((entry) => entry.question !== null)
  const read = mentions.filter((entry) => entry.question === null)
  return [
    ...permissions.toSorted(newestFirst),
    ...[...questions, ...waiting].toSorted(newestFirst),
    ...read.toSorted(newestFirst),
  ]
}

/**
 * The time on an Inbox row, as Jam Desktop writes it: the clock alone for a moment today ("4:58 pm", the hour not
 * padded, unlike a message's time in a room), and "Yesterday" before it for the day before. Jam's wording for anything
 * older was not seen, so the date stands in there (docs/jam/differences.md).
 */
export function inboxTime(ms: number, now: number = Date.now()): string {
  const when = new Date(ms)
  if (Number.isNaN(when.getTime()) || ms === 0) return ''
  const hours = when.getHours()
  const clock = `${hours % 12 || 12}:${String(when.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'am' : 'pm'}`
  if (sameDay(when, new Date(now))) return clock
  if (sameDay(when, yesterday(now))) return `Yesterday ${clock}`
  return `${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${clock}`
}

const newestFirst = (a: InboxEntry, b: InboxEntry) => b.at - a.at

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/**
 * What Inbox counts beside its name in the sidebar: what it lists and what the daemon holds back, since Jam counts
 * "visible and queued" alike (user guide, "Inbox").
 */
export function inboxCount(inbox: Inbox | null): number {
  return inboxEntries(inbox).length + (inbox?.overflow ?? 0)
}

/**
 * What Jam's quiet dismiss takes: a row that came from a mention's own message and no longer waits on the person. Jam
 * Desktop puts its X on each of those rows - a question already answered included, as its own capture shows - while a
 * question still waiting is answered and a permission request is decided, not dismissed (user guide, "Dismiss a routine
 * mention"). A question whose message is not among the mentions, and a request, have no message to mark done.
 */
export function dismissibleEntry(entry: InboxEntry): boolean {
  return entry.message !== null && entry.question === null
}
