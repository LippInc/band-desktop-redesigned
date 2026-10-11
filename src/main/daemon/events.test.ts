import { describe, expect, it } from 'vitest'
import { EventLineParser, MAX_EVENT_BYTES } from './events'

const parse = (...chunks: string[]) => {
  const parser = new EventLineParser(() => 1)
  return chunks.flatMap((chunk) => parser.push(chunk))
}

/** The shape recorded on 2026-09-19 (renaming a room), with invented content. */
const roomDirectory = (rooms: unknown[] = []) =>
  JSON.stringify({
    peer: 'human:default',
    kind: { kind: 'room_directory_snapshot', profile: 'default', revision: 3, rooms, recovery: { state: 'idle' } },
  })

describe('EventLineParser', () => {
  it('names a recorded event by the kind inside its kind, across chunk boundaries', () => {
    const line = `${roomDirectory()}\n`
    expect(parse(line.slice(0, 20), line.slice(20))).toEqual([{ receivedAt: 1, kind: 'room_directory_snapshot' }])
  })

  it('passes on only the name, never the unvalidated content', () => {
    const [event] = parse(`${roomDirectory([{ id: 'x', title: '<img src=x onerror=alert(1)>' }])}\n`)
    expect(event).toEqual({ receivedAt: 1, kind: 'room_directory_snapshot' })
  })

  it('leaves an object without a named kind unnamed: it still means something changed', () => {
    expect(parse('{"kind":"flat"}\n{"type":"x"}\n{"kind":{"kind":7}}\n').map((event) => event.kind)).toEqual([
      null,
      null,
      null,
    ])
  })

  it.each([
    'not json\n',
    '[1,2]\n',
    '"text"\n',
    '42\n',
    'null\n',
    'data: {"kind":{"kind":"sse"}}\n',
    `{"a":"${'x'.repeat(MAX_EVENT_BYTES)}"}\n`,
  ])('drops %s without failing', (line) => {
    expect(parse(line)).toEqual([])
  })

  it('does not let a line without an end grow without limit', () => {
    const parser = new EventLineParser(() => 1)
    parser.push('{"a":"' + 'x'.repeat(MAX_EVENT_BYTES + 10))
    expect(parser.push(`"}\n${roomDirectory()}\n`)).toEqual([{ receivedAt: 1, kind: 'room_directory_snapshot' }])
  })
})
