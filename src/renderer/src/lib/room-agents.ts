import type {
  AgentQuestion,
  AgentRow,
  AgentSession,
  Inbox,
  Participant,
  PermissionRecord,
  RoomMessage,
} from '@shared/daemon'
import { currentTool, workingAgents } from '@/lib/messages'

/** An agent in a room, as the room shows it: who it is, whether it runs here now, and what waits on the person. */
export interface RoomAgent {
  /** Its participant id (its Band agent id). */
  id: string
  name: string
  handle: string | null
  /** Its local key (`<profile>/<scope>`) when it runs on this computer; null for an agent owned elsewhere. */
  peerKey: string | null
  /** Its runtime in this room is live. */
  live: boolean
  /** Its host session for THIS room, which is what Stop interrupts; null when it has none here. */
  hostSession: string | null
  /** Its turn is running. */
  working: boolean
  /** The tool it is using now, while its turn runs. */
  tool: string | null
  /** Permission requests and questions from it in this room, waiting on the person. */
  attention: number
}

export interface RoomAgentInputs {
  roomId: string
  participants: readonly Participant[]
  agents: readonly AgentRow[]
  sessions: Record<string, readonly AgentSession[]>
  messages: readonly RoomMessage[]
  inbox: Inbox | null
}

/** The room's agents: its participants that are not people, with what the account and the stream know of each. */
export function roomAgents({ roomId, participants, agents, sessions, messages, inbox }: RoomAgentInputs): RoomAgent[] {
  const working = workingAgents(messages)
  return participants
    .filter((participant) => participant.kind !== undefined && participant.kind !== 'User')
    .map((participant) => {
      const row = agents.find((agent) => agent.id === participant.id)
      const peerKey = row?.local?.peer_key ?? null
      const here = peerKey ? (sessions[peerKey] ?? []).filter((session) => session.room === roomId) : []
      const live = here.some((session) => session.presence === 'live')
      const hostSession = here.find((session) => session.presence === 'live')?.id ?? here[0]?.id ?? null
      const attention = peerKey
        ? roomPermissions(inbox, roomId).filter((item) => item.peerKey === peerKey).length +
          roomQuestions(inbox, roomId).filter((item) => item.peerKey === peerKey).length
        : 0
      return {
        id: participant.id,
        name: participant.name || row?.name || participant.handle || 'Agent',
        handle: participant.handle ?? row?.handle ?? null,
        peerKey,
        live,
        hostSession,
        working: working.has(participant.id),
        tool: working.has(participant.id) ? currentTool(messages, participant.id) : null,
        attention,
      }
    })
}

/** The permission requests waiting on the person in one room, oldest first. */
export function roomPermissions(inbox: Inbox | null, roomId: string): { peerKey: string; record: PermissionRecord }[] {
  return (inbox?.permissions ?? [])
    .filter((item) => item.record.request.chat_id === roomId && item.record.status === 'pending')
    .toSorted((a, b) => (a.record.request.created_at ?? 0) - (b.record.request.created_at ?? 0))
}

/** The questions waiting on the person in one room. */
export function roomQuestions(inbox: Inbox | null, roomId: string): { peerKey: string; question: AgentQuestion }[] {
  return (inbox?.questions ?? []).filter((item) => item.roomId === roomId)
}

/** A question still waiting on the person: what the inbox holds for its code, and who asked it. */
export interface OpenQuestion {
  question: AgentQuestion
  /** The room it was asked in: Inbox answers a question without its room being open. */
  roomId: string
  agentId: string | null
  agentName: string
}

/**
 * A room's waiting questions by their answer code (upper case), as its conversation offers them: each with the agent
 * that asked it among the room's own agents, or its handle when that agent is not one of them.
 */
export function openQuestionsOf(
  questions: readonly { peerKey: string; question: AgentQuestion }[],
  roomId: string,
  agents: readonly RoomAgent[],
  handleOf: (peerKey: string) => string,
): Map<string, OpenQuestion> {
  return new Map(
    questions.map(({ peerKey, question }) => {
      const agent = agents.find((one) => one.peerKey === peerKey)
      return [
        question.answer_code.toUpperCase(),
        { question, roomId, agentId: agent?.id ?? null, agentName: agent?.name ?? handleOf(peerKey) },
      ]
    }),
  )
}

/** What a permission request asks, in Jam's words where they are known (Jam Desktop 0.4.10: a Write "change files"). */
export function permissionWish(action: string | null | undefined): string {
  switch (action) {
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'wants to change files'
    case 'Bash':
      return 'wants to run a command'
    case undefined:
    case null:
    case '':
      return 'wants permission for an operation whose type was not provided'
    default:
      return `wants permission for ${action}`
  }
}

/** A lane's agent, from its key (`peer_id`, as agent-list's `local.peer_key`). */
export function agentOfLane(agents: readonly AgentRow[], peerId: string): AgentRow | null {
  return agents.find((agent) => agent.local?.peer_key === peerId) ?? null
}
