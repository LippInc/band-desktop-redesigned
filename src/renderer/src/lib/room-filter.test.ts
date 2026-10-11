import { describe, expect, it } from 'vitest'
import type { AgentRow, Participant, Room } from '@shared/daemon'
import { ALL_SCOPES, allScopesOn, filterRooms, matches, ROOM_SCOPES, scopesOf } from '@/lib/room-filter'

const ME = '11111111-1111-4111-8111-111111111111'
const MATE = '22222222-2222-4222-8222-222222222222'
const MY_AGENT = '33333333-3333-4333-8333-333333333333'
const THEIR_AGENT = '44444444-4444-4444-8444-444444444444'

const room = (id: string, title: string): Room => ({ id, title }) as Room

const person = (id: string, over: Partial<Participant> = {}): Participant => ({ id, kind: 'User', ...over })
const agent = (id: string, over: Partial<Participant> = {}): Participant => ({ id, kind: 'Agent', ...over })

const agents: AgentRow[] = [{ id: MY_AGENT, name: 'Atlas', handle: 'me/atlas', local: { peer_key: 'default/atlas' } }]

describe('which of Jam’s four a room answers to', () => {
  it('says nothing at all about a room whose participants are not read', () => {
    expect(scopesOf(room('a', 'A'), undefined, agents, ME)).toBeNull()
    expect(scopesOf(room('a', 'A'), [], agents, ME)).toBeNull()
  })

  it('knows a room this account owns', () => {
    const answers = scopesOf(room('a', 'A'), [person(ME, { role: 'owner' }), person(MATE)], agents, ME)
    expect(answers).toEqual({ owned: true, member: false, agentOwned: false, hasAgents: false })
  })

  it('knows a room this account is only a member of', () => {
    const answers = scopesOf(room('a', 'A'), [person(MATE, { role: 'owner' }), person(ME)], agents, ME)
    expect(answers).toEqual({ owned: false, member: true, agentOwned: false, hasAgents: false })
  })

  it('knows a room one of this account’s own agents owns', () => {
    const answers = scopesOf(room('a', 'A'), [agent(MY_AGENT, { role: 'owner' }), person(ME)], agents, ME)
    expect(answers?.agentOwned).toBe(true)
  })

  it('does not call someone else’s agent one of this account’s', () => {
    const answers = scopesOf(room('a', 'A'), [agent(THEIR_AGENT, { role: 'owner' }), person(ME)], agents, ME)
    expect(answers).toEqual({ owned: false, member: true, agentOwned: false, hasAgents: false })
  })

  it('counts one of this account’s agents in the room, but not when it is the owner', () => {
    const owned = [person(ME, { role: 'owner' }), agent(MY_AGENT)]
    expect(scopesOf(room('a', 'A'), owned, agents, ME)?.hasAgents).toBe(true)
    const byAgent = [agent(MY_AGENT, { role: 'owner' })]
    expect(scopesOf(room('a', 'A'), byAgent, agents, ME)?.hasAgents).toBe(false)
  })

  it('claims nothing about ownership before the account’s own id is known', () => {
    const answers = scopesOf(room('a', 'A'), [person(ME, { role: 'owner' })], agents, null)
    expect(answers).toEqual({ owned: false, member: false, agentOwned: false, hasAgents: false })
  })
})

describe('the words the field looks for', () => {
  const people = [person(ME, { name: 'Sam Rivera', role: 'owner' }), agent(MY_AGENT, { handle: 'me/atlas' })]

  it('looks in the room’s name, its participants and its id, as Jam’s placeholder says', () => {
    const it0 = room('7c2e9a41-3d58-4b06-8f19-2a6c4e0d7b35', 'Checkout flow')
    expect(matches(it0, people, 'checkout')).toBe(true)
    expect(matches(it0, people, 'rivera')).toBe(true)
    expect(matches(it0, people, 'atlas')).toBe(true)
    expect(matches(it0, people, '7c2e9a41')).toBe(true)
    expect(matches(it0, people, 'nothing here')).toBe(false)
  })

  it('ignores case and surrounding space, and empty words match everything', () => {
    const it0 = room('a', 'Checkout flow')
    expect(matches(it0, people, '  CHECKOUT  ')).toBe(true)
    expect(matches(it0, people, '   ')).toBe(true)
  })

  it('matches on the room alone when its participants are not read', () => {
    expect(matches(room('a', 'Checkout flow'), undefined, 'checkout')).toBe(true)
    expect(matches(room('a', 'Checkout flow'), undefined, 'rivera')).toBe(false)
  })
})

describe('the rooms the list shows', () => {
  const rooms = [room('a', 'Mine'), room('b', 'Theirs'), room('c', 'Unread')]
  const people = {
    a: [person(ME, { role: 'owner' })],
    b: [person(MATE, { role: 'owner' }), person(ME)],
  }
  const base = { rooms, people, agents, selfId: ME, text: '', scopes: ALL_SCOPES }

  it('shows everything while every switch is on', () => {
    expect(filterRooms(base).map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    expect(allScopesOn(ALL_SCOPES)).toBe(true)
  })

  it('narrows to the switches left on', () => {
    const only = { ...ALL_SCOPES, member: false, agentOwned: false, hasAgents: false }
    expect(filterRooms({ ...base, scopes: only }).map((entry) => entry.id)).toEqual(['a', 'c'])
  })

  it('keeps a room it has read nothing about rather than hiding it', () => {
    const none = { owned: false, member: false, agentOwned: false, hasAgents: false }
    expect(filterRooms({ ...base, scopes: none }).map((entry) => entry.id)).toEqual(['c'])
  })

  it('applies the words even to a room no switch can speak for', () => {
    expect(filterRooms({ ...base, text: 'unread' }).map((entry) => entry.id)).toEqual(['c'])
  })

  it('has Jam’s four, in Jam’s order', () => {
    expect(ROOM_SCOPES.map((scope) => scope.label)).toEqual([
      'Owned by me',
      "I'm a member",
      'Owned by my agent',
      'Has my agents',
    ])
  })
})
