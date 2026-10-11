import { describe, expect, it } from 'vitest'
import type { RoomMessage } from '@shared/daemon'
import {
  answerOf,
  answersByCode,
  currentTool,
  eventTypeOf,
  mentionIdOf,
  messageDay,
  messageTime,
  questionCardOf,
  taskEventText,
  toolFullOf,
  toolJsonOf,
  toolRowOf,
  withMentionLinks,
  workingAgents,
} from './messages'

const PERSON = 'a1000000-0000-4000-8000-000000000001'
const AGENT = 'a2000000-0000-4000-8000-000000000002'

function message(part: Partial<RoomMessage>): RoomMessage {
  return {
    id: 'm',
    message_type: 'text',
    content: '',
    cut: false,
    sender_id: AGENT,
    sender_name: 'Atlas',
    sender_type: 'Agent',
    inserted_at: '2026-09-19T11:31:33.317576Z',
    mention_names: {},
    tool_name: null,
    system_event: null,
    attachments: 0,
    ...part,
  }
}

// An agent's question as the daemon records it (2026-09-19), with invented words and ids.
const MARK = String.fromCharCode(0x2063)
const question = message({
  content: [
    `@[[${PERSON}]] ❓ **I need input to continue.**`,
    '',
    '- Which colour should the chart use?  _(options: green / blue)_',
    '',
    '_Reply in this room — the first response resumes my turn._',
    '',
    'Reply with `Answer 1A2B3C4D: <answer>`.',
    `${MARK}jam-hitl-question${MARK}c3000000-0000-4000-8000-000000000003`,
  ].join('\n'),
})

describe('event types', () => {
  it("sorts the daemon's message types into Jam's filter", () => {
    expect(eventTypeOf(message({ message_type: 'text' }))).toBe('message')
    expect(eventTypeOf(message({ message_type: 'tool_call' }))).toBe('tool_call')
    expect(eventTypeOf(message({ message_type: 'tool_result' }))).toBe('tool_result')
    expect(eventTypeOf(message({ message_type: 'task' }))).toBe('task')
    expect(eventTypeOf(message({ message_type: 'participant' }))).toBe('system')
    expect(eventTypeOf(message({ message_type: 'something_new' }))).toBe('system')
  })
})

describe('mentions', () => {
  it('turns a mention into a link named after the person, and back', () => {
    const text = withMentionLinks(`@[[${PERSON}]] Hello!`, { [PERSON]: 'Maria Tamm' })
    expect(text).toBe(`[@Maria Tamm](#mention-${PERSON}) Hello!`)
    expect(mentionIdOf(`#mention-${PERSON}`)).toBe(PERSON)
    expect(withMentionLinks(`@[[${PERSON}]] and @[[${AGENT}]]`, { [PERSON]: 'Maria Tamm', [AGENT]: 'Nova' })).toBe(
      `[@Maria Tamm](#mention-${PERSON}) and [@Nova](#mention-${AGENT})`,
    )
  })

  it("keeps a name's brackets from breaking the link, and names an unknown id neutrally", () => {
    expect(withMentionLinks(`@[[${PERSON}]]`, { [PERSON]: 'Ma]ria[' })).toBe(`[@Maria](#mention-${PERSON})`)
    expect(withMentionLinks(`@[[${AGENT}]]`, {})).toBe(`[@someone](#mention-${AGENT})`)
    expect(withMentionLinks(`@[[${AGENT}]]`, { [AGENT]: '' })).toBe(`[@someone](#mention-${AGENT})`)
  })

  it('reads no mention from an ordinary link', () => {
    expect(mentionIdOf('https://example.com')).toBeNull()
    expect(mentionIdOf(undefined)).toBeNull()
  })
})

describe('questions', () => {
  it("reads an agent's question card and hides the answer instruction and the marker", () => {
    const card = questionCardOf(question)
    expect(card?.answerCode).toBe('1A2B3C4D')
    expect(card?.text).toContain('Which colour should the chart use?')
    expect(card?.text).not.toContain('Reply with')
    expect(card?.text).not.toContain('jam-hitl-question')
  })

  it('is no question without the marker, even with the instruction', () => {
    const plain = message({ content: 'Reply with `Answer 1A2B3C4D: <answer>`.' })
    expect(questionCardOf(plain)).toBeNull()
  })

  it("reads a person's answer, and never an agent's words as one", () => {
    const answer = message({
      sender_id: PERSON,
      sender_name: 'Maria Tamm',
      sender_type: 'User',
      content: `@[[${AGENT}]] Answer 1a2b3c4d: green`,
    })
    expect(answerOf(answer)).toEqual({ code: '1A2B3C4D', answer: 'green' })
    expect(answerOf(message({ content: 'Answer 1A2B3C4D: green' }))).toBeNull()
    expect(answersByCode([question, answer]).get('1A2B3C4D')).toEqual({ by: 'Maria Tamm', answer: 'green' })
  })
})

describe('turns and tools', () => {
  const started = message({ message_type: 'task', content: '{"event":"turn_started"}' })
  const call = message({
    message_type: 'tool_call',
    tool_name: 'Write',
    content: '{"args":{"content":"x","file_path":"notes.md"},"name":"Write","tool_call_id":"t1"}',
  })
  const done = message({ message_type: 'task', content: '{"event":"turn_complete","outcome":"complete"}' })

  it('knows an agent is working until its turn completes, and what it is doing', () => {
    expect(workingAgents([started])).toEqual(new Set([AGENT]))
    expect(currentTool([started, call], AGENT)).toBe('Write')
    expect(workingAgents([started, call, done])).toEqual(new Set())
    expect(currentTool([started, call, done], AGENT)).toBeNull()
  })

  it('names the tool a permission request asks for, as Jam does, and keeps the last tool when it does not say', () => {
    const request = (args: object) =>
      message({ message_type: 'tool_call', tool_name: 'permission_request', content: JSON.stringify({ args }) })
    expect(currentTool([started, request({ action: 'Bash', description: 'x' })], AGENT)).toBe('Bash')
    expect(currentTool([started, call, request({ description: 'x' })], AGENT)).toBe('Write')
    expect(currentTool([started, request({})], AGENT)).toBeNull()
  })

  it('words the lifecycle events', () => {
    expect(taskEventText(started)).toBe('Turn started')
    expect(taskEventText(done)).toBe('Turn complete')
    expect(taskEventText(message({ message_type: 'task', content: 'ready' }))).toBe('Ready')
    const resolved = (granted: boolean) =>
      message({ message_type: 'task', content: JSON.stringify({ event: 'permission_resolved', granted, id: 'p1' }) })
    expect(taskEventText(resolved(true))).toBe('Permission allowed')
    expect(taskEventText(resolved(false))).toBe('Permission denied')
    const note = '1 tool call(s) blocked by the permission layer this turn (Write) under mode default'
    expect(taskEventText(message({ message_type: 'task', content: note }))).toBe(note)
  })

  it('makes one line of a tool call and of a failed result', () => {
    expect(toolRowOf(call)).toEqual({ label: 'Write', detail: 'notes.md', failed: false })
    const failed = message({
      message_type: 'tool_result',
      content: '{"is_error":true,"name":"Write","output":"<tool_use_error>timed out after 60s</tool_use_error>"}',
    })
    expect(toolRowOf(failed)).toEqual({ label: 'Write', detail: 'timed out after 60s', failed: true })
  })

  it("opens a row whole in Jam's words: the call's JSON, a result's output, a result made of fields as JSON", () => {
    const full = toolFullOf(call)
    expect(full.label).toBe('View full JSON')
    expect(JSON.parse(full.text)).toEqual(JSON.parse(call.content))
    expect(full.text).toContain('\n  "args"')
    const written = message({
      message_type: 'tool_result',
      content: '{"name":"Write","output":"The file notes.md has been updated successfully."}',
    })
    expect(toolFullOf(written)).toEqual({
      label: 'View full output',
      text: 'The file notes.md has been updated successfully.',
    })
    // A Jam reply's result, in the recorded shape: its fields written as text inside `output`. Jam lists them as fields
    // and labels the row View full JSON; the whole view reads the output as the object it holds.
    const reply = message({
      message_type: 'tool_result',
      content: JSON.stringify({
        is_error: false,
        name: 'mcp__jam__jam_reply_to_message',
        output: JSON.stringify({ detail: 'staged disposition for the message', staged: true }),
        tool_call_id: 'toolu_r1',
      }),
    })
    expect(toolFullOf(reply).label).toBe('View full JSON')
    expect(JSON.parse(toolFullOf(reply).text).output).toEqual({
      detail: 'staged disposition for the message',
      staged: true,
    })
    // Whole, a result with text output keeps its name and id as well as the output.
    expect(JSON.parse(toolJsonOf(written))).toEqual(JSON.parse(written.content))
    expect(toolFullOf(message({ message_type: 'tool_call', content: 'not json' }))).toEqual({
      label: 'View full JSON',
      text: 'not json',
    })
  })
})

describe("Jam's times", () => {
  it('writes the time with two digits and a lowercase am or pm, and the day as a date string', () => {
    const local = new Date(2026, 8, 19, 13, 31)
    expect(messageTime(local.toISOString())).toBe('01:31 pm')
    expect(messageTime(new Date(2026, 8, 19, 0, 5).toISOString())).toBe('12:05 am')
    expect(messageDay(local.toISOString())).toBe('Sat Sep 19 2026')
    expect(messageTime('not a time')).toBe('')
  })
})
