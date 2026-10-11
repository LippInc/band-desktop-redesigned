import type { AgentRow, HostPeer, Kickoff, Room, WorkSummary } from '@shared/daemon'
import { roomMoment } from './rooms'

/**
 * What Home's "Assign work" needs to know: which agents to offer and in what order, how ready each one is, and what to
 * say once an assignment has been made. Jam's own words throughout (its user guide, "Assign work").
 */

/**
 * Jam's three readiness words, beside an agent in the agent control. The guide gives each one's meaning:
 * Attached, a live coding session can receive the assignment; Ready, Jam can start the configured runtime when the
 * assignment arrives; Needs setup, the identity exists but no session can perform the work.
 */
export const READINESS = {
  attached: 'Attached · available now',
  ready: 'Ready · Band starts it',
  setup: 'Needs setup · Attach a coding session',
} as const

export type Readiness = keyof typeof READINESS

/**
 * How ready one agent is, read from the host sessions this computer reports (`/v1/list`). The agent list itself carries
 * no readiness, so it is settled here from what the sessions say: a live session under a running host for the agent's
 * own peer key means a session can take the work now; an agent that runs here without one means Jam has a runtime to
 * start; an agent with no local peer key runs nowhere on this computer, which is Jam's third case.
 */
export function readinessOf(agent: AgentRow, peers: readonly HostPeer[] | null): Readiness | null {
  const key = agent.local?.peer_key
  if (!key) return 'setup'
  // Until the host sessions answer - and if they never do - nothing here has been read, so nothing is claimed. Saying
  // "Ready" would be a statement about this computer that nobody looked at.
  if (peers === null) return null
  const mine = peers.filter((entry) => `${entry.peer.profile ?? ''}/${entry.peer.scope ?? ''}` === key)
  const live = mine.some(
    (entry) => entry.running !== false && entry.peer.host_sessions.some((session) => session.presence === 'live'),
  )
  return live ? 'attached' : 'ready'
}

/** An agent as the control offers it. */
export interface AgentChoice {
  /** The agent's local peer key (`<profile>/<scope>`), which is how the daemon names it. */
  peer: string
  scope: string
  handle: string
  name: string
  /** null until the host sessions have been read: no readiness is claimed before then. */
  readiness: Readiness | null
}

/** An agent the daemon can be asked to work: it runs on this computer and its handle is its Band one. */
export function choiceOf(agent: AgentRow, peers: readonly HostPeer[] | null): AgentChoice | null {
  const peer = agent.local?.peer_key
  const scope = peer?.split('/')[1]
  if (!peer || !scope || !agent.handle) return null
  return {
    peer,
    scope,
    handle: agent.handle,
    name: agent.name ?? agent.handle,
    readiness: readinessOf(agent, peers),
  }
}

/**
 * The agents the control offers, split into Jam's two groups. **Recent agents** are those that have worked in the rooms
 * touched most recently, newest room first; Jam's own rule for what makes an agent recent was not seen, so this app
 * says it in the plainest way the data supports (`docs/jam/differences.md`). Every agent that can take work appears
 * under **My agents**, in the order the daemon lists them.
 */
export function agentGroups(
  agents: readonly AgentRow[],
  peers: readonly HostPeer[] | null,
  work: WorkSummary | null,
  rooms: readonly Room[],
  max = 3,
): { recent: AgentChoice[]; mine: AgentChoice[] } {
  const mine = agents.map((agent) => choiceOf(agent, peers)).filter((choice): choice is AgentChoice => choice !== null)
  if (!work) return { recent: [], mine }
  const byRoom = new Map(rooms.map((room) => [room.id, roomMoment(room) ?? 0]))
  const latest = new Map<string, number>()
  for (const entry of work.rooms) {
    const when = byRoom.get(entry.roomId) ?? 0
    for (const lane of entry.lanes) {
      if (when > (latest.get(lane.peer_id) ?? -1)) latest.set(lane.peer_id, when)
    }
  }
  const recent = mine
    .filter((choice) => latest.has(choice.peer))
    .toSorted((a, b) => (latest.get(b.peer) ?? 0) - (latest.get(a.peer) ?? 0))
    .slice(0, max)
  return { recent, mine }
}

/**
 * Jam's word for how an assignment reached a session (user guide, "Assign work"). The daemon answers `delivery`:
 * "bound" is the one this build has seen, and it is the case where a session took the room. Any other word the daemon
 * sends falls to Jam's third result, which is what it means for a room, task and message to exist with no session on
 * them yet; the middle result, several live windows, is not checked against Jam (`docs/jam/differences.md`).
 *
 * Jam has three results and no more, so nothing here invents a fourth: `runs_elsewhere` is not spoken to, because no
 * wording of Jam's for it has ever been seen.
 */
export function deliveryText(outcome: Kickoff, name: string): string {
  if (outcome.delivery === 'bound') return `${name} is on it.`
  return `Waiting for ${name}.`
}
