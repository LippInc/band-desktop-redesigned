import type { RoomMessage } from '@shared/daemon'

/**
 * Jam's event types, in the order and words of Jam Desktop's Event type filter (0.4.10), and the ones it shows before
 * the person changes the filter: messages, errors and system events; thoughts, tasks, tool calls and results are hidden.
 */
export const EVENT_TYPES = [
  ['message', 'Messages'],
  ['error', 'Errors'],
  ['thought', 'Thoughts'],
  ['task', 'Tasks'],
  ['tool_call', 'Tool calls'],
  ['tool_result', 'Tool results'],
  ['system', 'System'],
] as const
export type EventType = (typeof EVENT_TYPES)[number][0]
export const DEFAULT_EVENT_TYPES: readonly EventType[] = ['message', 'error', 'system']

/** The event type of a message, from its daemon type (recorded: text, tool_call, tool_result, task, participant). */
export function eventTypeOf(message: RoomMessage): EventType {
  switch (message.message_type) {
    case 'text':
      return 'message'
    case 'error':
      return 'error'
    case 'thought':
    case 'thinking':
      return 'thought'
    case 'task':
      return 'task'
    case 'tool_call':
      return 'tool_call'
    case 'tool_result':
      return 'tool_result'
    default:
      return 'system'
  }
}

/** A mention as the daemon writes it in a message's text: `@[[participant id]]`. */
const MENTION = /@\[\[([^\]\s]{1,100})\]\]/g

/**
 * A message's Markdown with each mention made a link to `#mention-<id>` named after the person, which the Markdown
 * renderer draws as a chip. A mention of someone the message does not name keeps a neutral name.
 */
export function withMentionLinks(text: string, names: Record<string, string>): string {
  return text.replace(MENTION, (_match, id: string) => {
    const name = (names[id] || 'someone').replace(/[\\[\]]/g, '')
    return `[@${name}](#mention-${encodeURIComponent(id)})`
  })
}

/**
 * A message's text as the room shows it: each mention as the name the room gives it ("@Atlas"), not the id the daemon
 * wrote. What Find looks through and what it shows of a match are both this, so a person can search for a name they
 * can see, and never for an id they cannot.
 */
export function withMentionNames(text: string, names: Record<string, string>): string {
  return text.replace(MENTION, (_match, id: string) => `@${names[id] || 'someone'}`)
}

/**
 * A message's text as one line of plain words, with its mentions taken out: a row in Inbox reads the way Jam Desktop's
 * rows read ("@[[id]] Hello!" is listed as "Hello!"), and the daemon leaves `mention_names` empty in an inbox snapshot,
 * so there is usually no name to put there anyway.
 */
export function withoutMentions(text: string): string {
  return text.replace(MENTION, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Jam's own opening for the message an agent sends when it needs a decision (recorded 2026-09-19 from the daemon's
 * stream, and seen in Jam Desktop's own conversation). The request itself is what Inbox lists, so its message is not
 * listed beside it, as Jam's Inbox does not list one.
 */
const PERMISSION_OPENING = '\u{1F510} Permission needed:'

/** Whether a message is the one an agent sends to ask for a decision. */
export function isPermissionMessage(message: { content: string }): boolean {
  return message.content.startsWith(PERMISSION_OPENING)
}

/** A mention's id from its link, or null when the link is not one. */
export function mentionIdOf(href: string | undefined): string | null {
  if (!href?.startsWith('#mention-')) return null
  try {
    return decodeURIComponent(href.slice('#mention-'.length))
  } catch {
    return null
  }
}

/**
 * The marker Jam puts at the end of an agent's question message (recorded 2026-09-19): invisible separators around
 * `jam-hitl-question` and the question's id. Jam Desktop hides it and the answer instruction, and shows its Answer button.
 */
const QUESTION_MARKER = /⁣jam-hitl-question⁣([^\s⁣]{1,200})\s*$/
/** The agent's instruction for answering: "Reply with `Answer 38FC87B5: <answer>`." */
const ANSWER_INSTRUCTION = /^\s*Reply with `Answer ([0-9A-Fa-f]{8}): <answer>`\.?\s*$/m

export interface QuestionCard {
  /** The message's Markdown without the answer instruction and the marker. */
  text: string
  answerCode: string
}

/** An agent's question message, or null for any other message. */
export function questionCardOf(message: RoomMessage): QuestionCard | null {
  if (message.message_type !== 'text' || !QUESTION_MARKER.test(message.content)) return null
  const code = ANSWER_INSTRUCTION.exec(message.content)?.[1]
  if (!code) return null
  const text = message.content.replace(QUESTION_MARKER, '').replace(ANSWER_INSTRUCTION, '').trimEnd()
  return { text, answerCode: code.toUpperCase() }
}

/** An answer as Jam sends it for a question: "Answer <code>: <answer>", after any mentions. */
const ANSWER = /^\s*(?:@\[\[[^\]]+\]\]\s*)*Answer ([0-9A-Fa-f]{8}):\s*([\s\S]+?)\s*$/

/** A person's answer to a question: its code and its words, or null for any other message. */
export function answerOf(message: RoomMessage): { code: string; answer: string } | null {
  if (message.message_type !== 'text' || message.sender_type === 'Agent') return null
  const match = ANSWER.exec(message.content)
  return match ? { code: match[1]!.toUpperCase(), answer: match[2]! } : null
}

/** The message that answered each question in this list, by the question's code (the first answer counts, as in Jam). */
export function answersByCode(messages: readonly RoomMessage[]): Map<string, { by: string; answer: string }> {
  const answers = new Map<string, { by: string; answer: string }>()
  for (const message of messages) {
    const answer = answerOf(message)
    if (answer && !answers.has(answer.code)) {
      answers.set(answer.code, { by: message.sender_name || 'Someone', answer: answer.answer })
    }
  }
  return answers
}

/**
 * A turn's lifecycle message ("task", recorded 2026-09-19): "ready", {"event": "turn_started"}, {"event":
 * "turn_complete", "outcome"}, {"event": "permission_resolved", "granted"}, or a plain note.
 */
function taskEventOf(message: RoomMessage): { event: string; outcome: string | null } | null {
  if (message.message_type !== 'task') return null
  const text = message.content.trim()
  // A plain note ("ready", or "1 tool call(s) blocked by the permission layer this turn (Write) ...") is its own text.
  if (!text.startsWith('{')) return { event: text.slice(0, 500), outcome: null }
  try {
    const json = JSON.parse(text) as { event?: unknown; outcome?: unknown; granted?: unknown }
    if (typeof json.event !== 'string') return null
    const outcome =
      typeof json.outcome === 'string'
        ? json.outcome.slice(0, 60)
        : typeof json.granted === 'boolean'
          ? json.granted
            ? 'allowed'
            : 'denied'
          : null
    return { event: json.event.slice(0, 60), outcome }
  } catch {
    return null
  }
}

/** A lifecycle event in words. */
export function taskEventText(message: RoomMessage): string {
  const event = taskEventOf(message)
  if (!event) return message.content.slice(0, 120)
  if (event.event === 'permission_resolved')
    return event.outcome === 'allowed' ? 'Permission allowed' : 'Permission denied'
  const words: Record<string, string> = { turn_started: 'Turn started', turn_complete: 'Turn complete', ready: 'Ready' }
  const word = words[event.event] ?? (/^[a-z_]+$/.test(event.event) ? event.event.replace(/_/g, ' ') : event.event)
  return event.outcome && event.outcome !== 'complete' ? `${word} · ${event.outcome.replace(/_/g, ' ')}` : word
}

/**
 * The agents whose turn is running: a turn_started with no turn_complete after it, by the agent's participant id. The
 * conversation shows them working ("Reasoning") above the composer.
 */
export function workingAgents(messages: readonly RoomMessage[]): Set<string> {
  const working = new Set<string>()
  for (const message of messages) {
    const event = taskEventOf(message)
    if (!event || !message.sender_id) continue
    if (event.event === 'turn_started') working.add(message.sender_id)
    else if (event.event === 'turn_complete') working.delete(message.sender_id)
  }
  return working
}

/**
 * The tool an agent is using now: its last tool call after its turn started, if the turn is running. A permission
 * request names the tool it asks for, as Jam Desktop shows it on the agent (0.4.10: "Write" while a Write waits).
 */
export function currentTool(messages: readonly RoomMessage[], agentId: string): string | null {
  let tool: string | null = null
  for (const message of messages) {
    if (message.sender_id !== agentId) continue
    const event = taskEventOf(message)
    if (event?.event === 'turn_started' || event?.event === 'turn_complete') tool = null
    else if (message.message_type === 'tool_call') {
      tool = message.tool_name === 'permission_request' ? (permissionActionOf(message) ?? tool) : message.tool_name
    }
  }
  return tool
}

/** The tool a permission request's call asks for (its `args.action`), or null when it does not say. */
function permissionActionOf(message: RoomMessage): string | null {
  try {
    const json = JSON.parse(message.content) as { args?: { action?: unknown } }
    const action = json.args?.action
    return typeof action === 'string' && action ? action.slice(0, 60) : null
  } catch {
    return null
  }
}

const TOOL_WORDS: Record<string, string> = {
  Bash: 'Terminal',
  Read: 'Read',
  Write: 'Write',
  Edit: 'Edit',
  Glob: 'Search',
  Grep: 'Search',
  ToolSearch: 'Load tools',
  AskUserQuestion: 'Question',
  mcp__jam__jam_reply_to_message: 'Reply',
  mcp__jam__jam_no_reply: 'No reply',
  permission_request: 'Permission',
}

/** A tool call or result as an activity row: its name in words and a one-line detail. */
export function toolRowOf(message: RoomMessage): { label: string; detail: string; failed: boolean } {
  let json: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(message.content) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed as Record<string, unknown>
  } catch {
    // not JSON: the text is the detail
  }
  const name = typeof json.name === 'string' ? json.name : (message.tool_name ?? 'Tool')
  const label = TOOL_WORDS[name] ?? name.replace(/^mcp__[^_]+__/, '')
  if (message.message_type === 'tool_result') {
    const failed = json.is_error === true
    const output = typeof json.output === 'string' ? json.output : ''
    return {
      label,
      detail: oneLine(output.replace(/<\/?tool_use_error>/g, '')) || (failed ? 'Failed' : 'Done'),
      failed,
    }
  }
  const args = json.args && typeof json.args === 'object' ? (json.args as Record<string, unknown>) : {}
  const pick = ['command', 'file_path', 'path', 'pattern', 'query', 'description', 'text']
    .map((key) => args[key])
    .find((value) => typeof value === 'string')
  const question = Array.isArray(args.questions) ? (args.questions[0] as { question?: unknown } | undefined) : undefined
  const detail =
    typeof pick === 'string'
      ? pick
      : typeof question?.question === 'string'
        ? question.question
        : Object.keys(args).length
          ? JSON.stringify(args)
          : message.content
  return { label, detail: oneLine(detail), failed: false }
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 240 ? `${line.slice(0, 239)}…` : line
}

/** The JSON object a text holds, or null for text that is not one. */
function objectIn(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * A tool message whole, laid out two spaces deep: a result's output read as the object it holds where it holds one (a
 * Jam reply's result is `{"detail", "staged"}` written as text inside `output`, recorded 2026-09-19). Content that is not
 * JSON is shown as it came.
 */
export function toolJsonOf(message: RoomMessage): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(message.content)
  } catch {
    return message.content
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const json = parsed as Record<string, unknown>
    const inner = typeof json.output === 'string' ? objectIn(json.output) : null
    if (inner) parsed = { ...json, output: inner }
  }
  return JSON.stringify(parsed, null, 2)
}

/**
 * The whole of a tool row, as Jam Desktop 0.4.10 opens it under the row: "View full output" for a result whose output is
 * text (a Write's "The file … has been updated"), and "View full JSON" for a call and for a result whose output is itself
 * an object of fields (a Jam reply's `detail` and `staged`), which Jam lists as fields.
 */
export function toolFullOf(message: RoomMessage): { label: 'View full JSON' | 'View full output'; text: string } {
  const json = objectIn(message.content)
  if (message.message_type === 'tool_result' && typeof json?.output === 'string' && !objectIn(json.output)) {
    return { label: 'View full output', text: json.output }
  }
  return { label: 'View full JSON', text: toolJsonOf(message) }
}

/** A message's time as Jam Desktop writes it: "01:31 pm". */
export function messageTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const hours = date.getHours()
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${String(hour12).padStart(2, '0')}:${minutes} ${hours < 12 ? 'am' : 'pm'}`
}

/** A day divider as Jam Desktop writes it: "Sat Sep 19 2026". */
export function messageDay(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toDateString()
}
