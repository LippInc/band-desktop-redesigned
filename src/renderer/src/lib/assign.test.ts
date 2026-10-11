import { describe, expect, it } from 'vitest'
import type { AgentRow, HostPeer, Kickoff, Room, WorkSummary } from '@shared/daemon'
import { agentGroups, choiceOf, deliveryText, readinessOf, READINESS } from '@/lib/assign'

const agent = (scope: string, over: Partial<AgentRow> = {}): AgentRow => ({
  id: `id-${scope}`,
  name: scope.charAt(0).toUpperCase() + scope.slice(1),
  handle: `owner/${scope}`,
  local: { peer_key: `default/${scope}`, host: 'this' },
  ...over,
})

const peer = (scope: string, presence: string, over: Partial<HostPeer> = {}): HostPeer => ({
  peer: {
    scope,
    profile: 'default',
    host_sessions: [{ id: `${scope}-1`, room: null, provider: 'claudecode', presence, binding: 'bound' }],
  },
  running: true,
  ...over,
})

const room = (id: string, at: string): Room => ({ id, title: id, updated_at: at, last_message_at: at }) as Room

const work = (pairs: [string, string][]): WorkSummary => ({
  boards: 0,
  lanes: pairs.length,
  rooms: pairs.map(([roomId, peerId]) => ({ roomId, lanes: [{ peer_id: peerId, active: true, tasks: [] }] })),
})

describe('an agent’s readiness', () => {
  it('is attached when a live session runs under a running host for that agent', () => {
    expect(readinessOf(agent('atlas'), [peer('atlas', 'live')])).toBe('attached')
  })

  it('is ready when the agent runs here but no session is live', () => {
    expect(readinessOf(agent('atlas'), [peer('atlas', 'unknown')])).toBe('ready')
    expect(readinessOf(agent('atlas'), [])).toBe('ready')
  })

  it('claims nothing at all before the host sessions are read, or when that read failed', () => {
    expect(readinessOf(agent('atlas'), null)).toBeNull()
    expect(choiceOf(agent('atlas'), null)?.readiness).toBeNull()
  })

  it('needs setup when the agent runs nowhere on this computer', () => {
    expect(readinessOf(agent('atlas', { local: null }), [peer('atlas', 'live')])).toBe('setup')
  })

  it('does not count a live session under a host that is not running', () => {
    expect(readinessOf(agent('atlas'), [peer('atlas', 'live', { running: false })])).toBe('ready')
  })

  it('does not count another agent’s live session', () => {
    expect(readinessOf(agent('atlas'), [peer('nova', 'live')])).toBe('ready')
  })

  it('says Jam’s words for each', () => {
    expect(READINESS.attached).toBe('Attached · available now')
    expect(READINESS.ready).toBe('Ready · Band starts it')
    expect(READINESS.setup).toBe('Needs setup · Attach a coding session')
  })
})

describe('the agents the control offers', () => {
  it('offers every agent that runs here, and leaves out one it could not name', () => {
    expect(choiceOf(agent('atlas'), [])?.name).toBe('Atlas')
    expect(choiceOf(agent('atlas', { handle: null }), [])).toBeNull()
    expect(choiceOf(agent('atlas', { local: null }), [])).toBeNull()
  })

  it('names an agent by its handle when it has no name', () => {
    expect(choiceOf(agent('atlas', { name: null }), [])?.name).toBe('owner/atlas')
  })

  it('puts the agent of the most recently touched room first under Recent agents', () => {
    const groups = agentGroups(
      [agent('atlas'), agent('nova')],
      [],
      work([
        ['old', 'default/atlas'],
        ['new', 'default/nova'],
      ]),
      [room('old', '2026-09-01T10:00:00Z'), room('new', '2026-09-20T10:00:00Z')],
    )
    expect(groups.recent.map((choice) => choice.name)).toEqual(['Nova', 'Atlas'])
    expect(groups.mine.map((choice) => choice.name)).toEqual(['Atlas', 'Nova'])
  })

  it('has no recent agents before the work is read, and none for an agent with no work', () => {
    expect(agentGroups([agent('atlas')], [], null, []).recent).toEqual([])
    expect(agentGroups([agent('atlas')], [], work([]), []).recent).toEqual([])
  })

  it('offers at most the few Jam shows as chips', () => {
    const scopes = ['a', 'b', 'c', 'd', 'e']
    const groups = agentGroups(
      scopes.map((scope) => agent(scope)),
      [],
      work(scopes.map((scope) => [scope, `default/${scope}`] as [string, string])),
      scopes.map((scope, index) => room(scope, `2026-09-0${index + 1}T10:00:00Z`)),
    )
    expect(groups.recent).toHaveLength(3)
    expect(groups.mine).toHaveLength(5)
  })
})

describe('what Jam says once the work is assigned', () => {
  const outcome = (over: Partial<Kickoff> = {}): Kickoff => ({
    chat_id: 'room-1',
    task_uid: '1',
    message_id: 'message-1',
    delivery: 'bound',
    collaborator_agent_ids: [],
    runs_elsewhere: false,
    ...over,
  })

  it('says the agent is on it when a session took the room', () => {
    expect(deliveryText(outcome(), 'Atlas')).toBe('Atlas is on it.')
  })

  it('invents no fourth result: Jam has three, and where the session runs is not one of them', () => {
    expect(deliveryText(outcome({ runs_elsewhere: true }), 'Atlas')).toBe('Atlas is on it.')
    expect(deliveryText(outcome({ runs_elsewhere: true, delivery: 'queued' }), 'Atlas')).toBe('Waiting for Atlas.')
  })

  it('waits rather than claiming a session for a word it does not know', () => {
    expect(deliveryText(outcome({ delivery: 'queued' }), 'Atlas')).toBe('Waiting for Atlas.')
    expect(deliveryText(outcome({ delivery: null }), 'Atlas')).toBe('Waiting for Atlas.')
  })
})
