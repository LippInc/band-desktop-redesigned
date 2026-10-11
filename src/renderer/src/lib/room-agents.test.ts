import { describe, expect, it } from 'vitest'
import type { AgentRow, AgentSession, Inbox, Participant, PermissionRecord, RoomMessage } from '@shared/daemon'
import {
  agentOfLane,
  openQuestionsOf,
  permissionWish,
  roomAgents,
  roomPermissions,
  roomQuestions,
  type RoomAgent,
} from './room-agents'

const ROOM = 'a1000000-0000-4000-8000-000000000001'
const OTHER_ROOM = 'a1000000-0000-4000-8000-000000000002'
const ATLAS = 'a2000000-0000-4000-8000-000000000003'
const NOVA = 'a2000000-0000-4000-8000-000000000004'
const PERSON = 'a3000000-0000-4000-8000-000000000005'

function permission(id: string, part: { chat_id?: string; status?: string; created_at?: number; action?: string }) {
  return {
    status: part.status ?? 'pending',
    request: {
      id,
      action: part.action ?? 'Write',
      description: 'Claude Code Write: {}',
      chat_id: part.chat_id ?? ROOM,
      created_at: part.created_at ?? 1,
    },
  } as unknown as PermissionRecord
}

const question = (code: string) =>
  ({ id: code, prompt: 'Which?', answer_code: code }) as unknown as Inbox['questions'][0]['question']

const inbox: Inbox = {
  permissions: [
    { peerKey: 'default/nova', record: permission('later', { created_at: 20 }) },
    { peerKey: 'default/nova', record: permission('earlier', { created_at: 10 }) },
    { peerKey: 'default/nova', record: permission('decided', { status: 'allowed' }) },
    { peerKey: 'default/atlas', record: permission('elsewhere', { chat_id: OTHER_ROOM }) },
  ],
  questions: [
    { peerKey: 'default/atlas', roomId: ROOM, question: question('1A2B3C4D') },
    { peerKey: 'default/atlas', roomId: OTHER_ROOM, question: question('5E6F7A8B') },
  ],
  answered: [],
  mentions: [],
  unreadable: 0,
  overflow: 0,
  truncated: 0,
}

describe('what waits on the person in a room', () => {
  it('lists only the requests still pending in this room, oldest first', () => {
    expect(roomPermissions(inbox, ROOM).map((item) => item.record.request.id)).toEqual(['earlier', 'later'])
    expect(roomPermissions(inbox, OTHER_ROOM).map((item) => item.record.request.id)).toEqual(['elsewhere'])
    expect(roomPermissions(null, ROOM)).toEqual([])
  })

  it("lists only this room's questions", () => {
    expect(roomQuestions(inbox, ROOM).map((item) => item.question.answer_code)).toEqual(['1A2B3C4D'])
    expect(roomQuestions(null, ROOM)).toEqual([])
  })

  it("says what a request wants in Jam's words where they are known", () => {
    expect(permissionWish('Write')).toBe('wants to change files')
    expect(permissionWish('Edit')).toBe('wants to change files')
    expect(permissionWish('Bash')).toBe('wants to run a command')
    expect(permissionWish(null)).toBe('wants permission for an operation whose type was not provided')
    expect(permissionWish('WebFetch')).toBe('wants permission for WebFetch')
  })
})

describe("a room's waiting questions, as its conversation offers them", () => {
  const atlas = { id: ATLAS, name: 'Atlas', peerKey: 'default/atlas' } as RoomAgent
  const handleOf = (peerKey: string) => `handle of ${peerKey}`

  it('keys each by its answer code in capitals, with the room and the agent that asked it', () => {
    const open = openQuestionsOf(
      [{ peerKey: 'default/atlas', question: question('1a2b3c4d') }],
      ROOM,
      [atlas],
      handleOf,
    )
    expect([...open.keys()]).toEqual(['1A2B3C4D'])
    expect(open.get('1A2B3C4D')).toMatchObject({ roomId: ROOM, agentId: ATLAS, agentName: 'Atlas' })
  })

  it("names an agent that is not among the room's own by its handle, and has no one to address", () => {
    const open = openQuestionsOf([{ peerKey: 'default/nova', question: question('5E6F7A8B') }], ROOM, [atlas], handleOf)
    expect(open.get('5E6F7A8B')).toMatchObject({ agentId: null, agentName: 'handle of default/nova' })
  })
})

describe("a room's agents", () => {
  const participants = [
    { id: PERSON, name: 'Sam Rivera', kind: 'User' },
    { id: ATLAS, name: 'Atlas', handle: 'sam-rivera/atlas', kind: 'Agent' },
    { id: NOVA, name: 'Nova', handle: 'sam-rivera/nova', kind: 'Agent' },
  ] as unknown as Participant[]
  const agents = [
    { id: ATLAS, name: 'Atlas', handle: 'sam-rivera/atlas', local: { peer_key: 'default/atlas', host: 'claudecode' } },
    { id: NOVA, name: 'Nova', handle: 'sam-rivera/nova', local: { peer_key: 'default/nova', host: 'claudecode' } },
  ] as unknown as AgentRow[]
  const sessions: Record<string, AgentSession[]> = {
    'default/atlas': [
      { id: 's1', room: OTHER_ROOM, presence: 'live' },
      { id: 's2', room: ROOM, presence: 'unknown' },
    ] as unknown as AgentSession[],
    'default/nova': [{ id: 's3', room: ROOM, presence: 'live' }] as unknown as AgentSession[],
  }
  const started = {
    id: 'm1',
    message_type: 'task',
    content: '{"event":"turn_started"}',
    sender_id: NOVA,
  } as RoomMessage

  it('are the participants that are not people, live only by a session in this room, with what waits from each', () => {
    const list = roomAgents({ roomId: ROOM, participants, agents, sessions, messages: [started], inbox })
    expect(list.map((agent) => [agent.name, agent.live, agent.working, agent.attention])).toEqual([
      ['Atlas', false, false, 1],
      ['Nova', true, true, 2],
    ])
    expect(list.map((agent) => agent.peerKey)).toEqual(['default/atlas', 'default/nova'])
    // The session Stop is sent to is one of this room's, never one the agent runs elsewhere: Atlas is live in the
    // other room and only unknown here, so what is named here is its session here.
    expect(list.map((agent) => agent.hostSession)).toEqual(['s2', 's3'])
  })

  /**
   * Stop names one session. Where the room has several of an agent's, the live one is named, because that is the one
   * running a turn; where none is live, the room's own session is named rather than nothing, so Stop can still ask.
   */
  it('names the live session of the room where there is one, and one of the room either way', () => {
    const several = {
      'default/nova': [
        { id: 'quiet', room: ROOM, presence: 'unknown' },
        { id: 'live', room: ROOM, presence: 'live' },
      ] as unknown as AgentSession[],
    }
    const withLive = roomAgents({ roomId: ROOM, participants, agents, sessions: several, messages: [], inbox })
    expect(withLive.find((agent) => agent.name === 'Nova')?.hostSession).toBe('live')

    const noneLive = {
      'default/nova': [{ id: 'quiet', room: ROOM, presence: 'unknown' }] as unknown as AgentSession[],
    }
    const without = roomAgents({ roomId: ROOM, participants, agents, sessions: noneLive, messages: [], inbox })
    expect(without.find((agent) => agent.name === 'Nova')?.hostSession).toBe('quiet')

    // An agent with no session in this room has none to name, so Stop has nothing to send and is not offered.
    expect(without.find((agent) => agent.name === 'Atlas')?.hostSession).toBeNull()
  })

  it('knows an agent owned elsewhere by its participant alone: never live here, nothing waiting from it here', () => {
    const list = roomAgents({ roomId: ROOM, participants, agents: [], sessions, messages: [], inbox })
    expect(list.map((agent) => [agent.name, agent.peerKey, agent.live, agent.attention])).toEqual([
      ['Atlas', null, false, 0],
      ['Nova', null, false, 0],
    ])
  })

  it("finds a lane's agent by its local key", () => {
    expect(agentOfLane(agents, 'default/nova')?.name).toBe('Nova')
    expect(agentOfLane(agents, 'default/someone')).toBeNull()
  })
})
