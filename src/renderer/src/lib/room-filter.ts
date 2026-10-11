import type { AgentRow, Participant, Room } from '@shared/daemon'

/**
 * Jam's "Filter and search rooms" (Jam Desktop 0.4.10): one field, then "Show" with four switches, all on. The field
 * looks through a room's name, its participants and its id - Jam's own placeholder says so. The four switches say which
 * rooms the list keeps.
 */

/** Jam's four, in Jam's order, with Jam's own words under each. */
export const ROOM_SCOPES = [
  { id: 'owned', label: 'Owned by me', note: 'Rooms you own' },
  { id: 'member', label: "I'm a member", note: "Rooms you're in" },
  { id: 'agentOwned', label: 'Owned by my agent', note: 'A local agent of yours owns it' },
  { id: 'hasAgents', label: 'Has my agents', note: 'A coworker agent of yours is in it' },
] as const

export type RoomScope = (typeof ROOM_SCOPES)[number]['id']

export type RoomScopes = Record<RoomScope, boolean>

/** All four on, which is how Jam opens the filter. */
export const ALL_SCOPES: RoomScopes = { owned: true, member: true, agentOwned: true, hasAgents: true }

export const allScopesOn = (scopes: RoomScopes): boolean => ROOM_SCOPES.every((scope) => scopes[scope.id])

export interface RoomFilterInputs {
  rooms: readonly Room[]
  /** The participants read for a room, by room id. A room not read yet is not in here. */
  people: Readonly<Record<string, Participant[] | undefined>>
  /** The account's own agents, to tell one of its agents from anyone else's. */
  agents: readonly AgentRow[]
  /** The account's own user id, or null when it is not known yet. */
  selfId: string | null
  text: string
  scopes: RoomScopes
}

const owner = (people: Participant[]) => people.find((person) => person.role === 'owner')
const isPerson = (person: Participant) => person.kind === undefined || person.kind === 'User'

/**
 * Which of Jam's four a room answers to. A room whose participants have not been read is `null`: nothing is known about
 * it, so no switch can speak for it.
 */
export function scopesOf(
  room: Room,
  people: Participant[] | undefined,
  agents: readonly AgentRow[],
  selfId: string | null,
): RoomScopes | null {
  if (!people || people.length === 0) return null
  const mine = new Set(agents.map((agent) => agent.id))
  const head = owner(people)
  const ownedByMe = selfId !== null && head?.id === selfId
  return {
    owned: ownedByMe,
    member: selfId !== null && !ownedByMe && people.some((person) => person.id === selfId),
    agentOwned: head !== undefined && !isPerson(head) && mine.has(head.id),
    hasAgents: people.some((person) => !isPerson(person) && person.id !== head?.id && mine.has(person.id)),
  }
}

/** Whether the words are in a room's name, in one of its participants' names or handles, or in its id. */
export function matches(room: Room, people: Participant[] | undefined, text: string): boolean {
  const needle = text.trim().toLowerCase()
  if (needle === '') return true
  if (room.title.toLowerCase().includes(needle)) return true
  if (room.id.toLowerCase().includes(needle)) return true
  return (people ?? []).some(
    (person) =>
      (person.name ?? '').toLowerCase().includes(needle) || (person.handle ?? '').toLowerCase().includes(needle),
  )
}

/**
 * The rooms the list shows. A switch narrows: a room is kept when it answers to at least one switch that is on. A room
 * whose participants are not read yet is always kept - the list never hides a room over something it has not read
 * (`docs/jam/differences.md`). With every switch on, only the words narrow anything, which is Jam's opening state.
 */
export function filterRooms({ rooms, people, agents, selfId, text, scopes }: RoomFilterInputs): Room[] {
  const everything = allScopesOn(scopes)
  return rooms.filter((room) => {
    const its = people[room.id]
    if (!matches(room, its, text)) return false
    if (everything) return true
    const answers = scopesOf(room, its, agents, selfId)
    if (answers === null) return true
    return ROOM_SCOPES.some((scope) => scopes[scope.id] && answers[scope.id])
  })
}
