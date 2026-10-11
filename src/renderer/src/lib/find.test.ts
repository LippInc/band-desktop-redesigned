import { describe, expect, it } from 'vitest'
import type { RoomMessage } from '@shared/daemon'
import { findResults, FIND_MIN, matchCount, NO_MATCHES, stepMatch } from '@/lib/find'

const message = (id: string, content: string, sender = 'Sam Rivera'): RoomMessage => ({
  id,
  message_type: 'text',
  content,
  cut: false,
  sender_id: null,
  sender_name: sender,
  sender_type: null,
  inserted_at: `2026-09-19T09:0${id.at(-1)}:00.000000Z`,
  mention_names: {},
  tool_name: null,
  system_event: null,
  attachments: 0,
})

const conversation = [
  message('m1', 'Kicking off the checkout redesign'),
  message('m2', 'The CHECKOUT plan is in the side pane'),
  message('m3', 'Nothing to do with it'),
  message('m4', 'checkout again, at the end'),
]

/** The ids of the messages found, which is what the room page walks: `findResults` carries each hit's line too. */
const matchIds = (messages: readonly RoomMessage[], query: string): string[] =>
  findResults(messages, query).map((hit) => hit.id)

describe('finding words in a conversation', () => {
  it('finds the messages the words are in, newest first, whatever their case', () => {
    expect(matchIds(conversation, 'checkout')).toEqual(['m4', 'm2', 'm1'])
    expect(matchIds(conversation, 'CHECKOUT')).toEqual(['m4', 'm2', 'm1'])
    expect(matchIds(conversation, ' checkout ')).toEqual(['m4', 'm2', 'm1'])
  })

  // Jam waits for two characters: one letter matches most of a conversation.
  it('finds nothing until two characters are typed', () => {
    expect(FIND_MIN).toBe(2)
    expect(matchIds(conversation, 'c')).toEqual([])
    expect(matchIds(conversation, ' ')).toEqual([])
    expect(matchIds(conversation, '')).toEqual([])
    expect(matchIds(conversation, 'ch')).toHaveLength(3)
  })

  it('finds nothing in a conversation that says nothing of the kind, and in no conversation at all', () => {
    expect(matchIds(conversation, 'sonar')).toEqual([])
    expect(matchIds([], 'checkout')).toEqual([])
  })

  it('steps through the matches, wrapping at either end', () => {
    const found = { ids: ['m4', 'm2', 'm1'], at: 0 }
    expect(stepMatch(found, 1)).toMatchObject({ at: 1 })
    expect(stepMatch({ ...found, at: 2 }, 1)).toMatchObject({ at: 0 })
    expect(stepMatch(found, -1)).toMatchObject({ at: 2 })
    expect(stepMatch({ ...found, at: 1 }, -1)).toMatchObject({ at: 0 })
    // Nothing to step through stays nothing, rather than landing on a match that is not there.
    expect(stepMatch(NO_MATCHES, 1)).toEqual(NO_MATCHES)
    expect(stepMatch(NO_MATCHES, -1)).toEqual(NO_MATCHES)
  })

  // Jam lists each match with who sent it, when, and the part that matched (user guide, "Use Chat").
  it('lists each match with who sent it, when, and the part that matched', () => {
    const long = ['first line of the message', 'the CHECKOUT is on this line', 'a third line'].join(
      String.fromCharCode(10),
    )
    const [hit] = findResults([message('m9', long, 'Atlas')], 'checkout')
    expect(hit).toMatchObject({ id: 'm9', sender: 'Atlas' })
    // The line the words are on, not the whole message and not its first line.
    expect(hit?.excerpt).toBe('the CHECKOUT is on this line')
    // A flat list has no day dividers, so a result says which day it was, as an Inbox row does.
    expect(hit?.time).toMatch(/\d:\d\d (am|pm)/)
    expect(hit?.time).toMatch(/Sep 19|Yesterday|^\d/)
    // A message with no sender name still says whose it is, rather than nothing.
    const [unknown] = findResults([message('m8', 'checkout', null as unknown as string)], 'checkout')
    expect(unknown?.sender).toBe('Unknown')
  })

  // A mention is a name on screen and an id in the text: a person searches for the name they can see.
  it('reads a mention as the name the room shows, not as the id the daemon wrote', () => {
    const mention = {
      ...message('m5', '@[[7a1d3c5e-2b4f-4a6c-8e0d-1f3a5c7e9b21]] please take the summary'),
      mention_names: { '7a1d3c5e-2b4f-4a6c-8e0d-1f3a5c7e9b21': 'Atlas' },
    }
    const [hit] = findResults([mention], 'atlas')
    expect(hit?.excerpt).toContain('@Atlas')
    expect(hit?.excerpt).not.toContain('7a1d3c5e')
    // And the id itself finds nothing: it is not on screen to be looked for.
    expect(findResults([mention], '7a1d3c5e')).toEqual([])
  })

  // A message is not Markdown to be cleaned up: the words that matched may be the ones at its start.
  it('keeps a line that opens with the words themselves', () => {
    for (const line of ['--force is dangerous', '*args and the rest', '#include <stdio.h>', '> quoted words']) {
      const needle = line.slice(0, 5).toLowerCase()
      const [hit] = findResults([message('m6', line)], needle)
      expect(hit?.excerpt.toLowerCase()).toContain(needle)
    }
  })

  it('cuts a long line around the words rather than from its start', () => {
    const line = `${'a'.repeat(200)} needle ${'b'.repeat(200)}`
    const [hit] = findResults([message('m7', line)], 'needle')
    expect(hit?.excerpt).toContain('needle')
    expect(hit?.excerpt.length).toBeLessThanOrEqual(142)
    expect(hit?.excerpt.startsWith('…')).toBe(true)
  })

  it('counts the matches as Jam does, and says when there are none', () => {
    expect(matchCount({ ids: ['m4', 'm2', 'm1'], at: 0 }, 'checkout')).toBe('1 of 3')
    expect(matchCount({ ids: ['m4', 'm2', 'm1'], at: 2 }, 'checkout')).toBe('3 of 3')
    expect(matchCount(NO_MATCHES, 'sonar')).toBe('No matches')
    // Before two characters there is nothing to count, not a count of none.
    expect(matchCount(NO_MATCHES, 'c')).toBeNull()
    expect(matchCount(NO_MATCHES, '')).toBeNull()
  })
})
