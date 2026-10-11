import type { DiscoveredAgent, DiscoveredUser } from '@shared/daemon'

/**
 * What Sonar shows, in one place. Jam Desktop 0.4.10 was read on 2026-09-20 with one person on the network - this
 * computer's own account - and the daemon's answer was recorded with that person's agent in it, so a user's fields
 * and an agent's are known. What Jam does with more than one person, and what its Teams tab draws, was not seen
 * (`docs/jam/differences.md`).
 */

/** Jam's filters over People, in its order; the one it starts on is All. */
export const SONAR_FILTERS = ['All', 'My org', 'Nearby', 'Online'] as const
export type SonarFilter = (typeof SONAR_FILTERS)[number]

/** The origin the daemon reports for a person found on the local network. */
const LAN = 'lan'

export interface PersonRow {
  key: string
  name: string
  handle: string | null
  online: boolean
  /** Where this person was found, in the daemon's own words ("lan"). */
  origins: string[]
  nearby: boolean
  lastSeenMs: number | null
  agents: AgentRow[]
  /** Every agent the answer held for this person, whether or not this app could read it. */
  agentsOffered: number
  /**
   * How many teams this person reports sharing. A team's own fields have never been recorded, so two people who
   * share one team cannot be told to be sharing the same one: this is memberships, not teams
   * (`docs/jam/differences.md`).
   */
  teams: number
}

export interface AgentRow {
  key: string
  name: string
  handle: string | null
  /** The daemon's own word for the agent's state with Band ("connected"). */
  state: string
  connected: boolean
  /** The daemon's own word for what it is doing ("idle", "working"). */
  activity: string
  /** What the person shares of the agent's work; absent when the answer counted none of it. */
  tasks: { pending: number; inProgress: number; completed: number } | null
  /** What the person shares of an agent's cost; absent when they do not share it. */
  cost: number | null
}

/**
 * Every person the daemon has discovered, as rows. Nothing is renamed and nothing is computed that the answer does
 * not carry: an agent's state, its activity and its task counts are printed as they came.
 */
export function personRows(users: readonly DiscoveredUser[]): PersonRow[] {
  // A person the answer names in no way is left out here and counted by the screen, as a contact the answer does
  // not name is: a row with no name on it says nothing about who is nearby.
  return users
    .filter((user) => (user.display_name || user.owner_handle || '') !== '')
    .map((user, index) => ({
      key: user.user_id || `${index}`,
      name: user.display_name || user.owner_handle || '',
      handle: user.owner_handle || null,
      online: user.online === true,
      origins: [...(user.origins ?? [])],
      nearby: (user.origins ?? []).includes(LAN),
      lastSeenMs: typeof user.last_seen_ms === 'number' ? user.last_seen_ms : null,
      agents: (user.agents ?? []).map(agentRow),
      agentsOffered: user.agentsOffered ?? (user.agents ?? []).length,
      teams: (user.teams ?? []).length,
    }))
}

function agentRow(agent: DiscoveredAgent, index: number): AgentRow {
  const state = agent.state ?? ''
  return {
    key: agent.agent_id || `${index}`,
    name: agent.name || agent.handle || '',
    handle: agent.handle || null,
    state,
    connected: state === 'connected',
    activity: agent.activity?.kind ?? '',
    // A count the daemon did not make is not made here: an agent whose work the answer counted none of shows
    // nothing, rather than three zeroes that would state how much someone else has done.
    tasks: agent.tasks
      ? {
          pending: agent.tasks.pending ?? 0,
          inProgress: agent.tasks.in_progress ?? 0,
          completed: agent.tasks.completed ?? 0,
        }
      : null,
    cost: typeof agent.cost === 'number' ? agent.cost : null,
  }
}

/**
 * The people Jam's filter and its search leave: All is everyone, Nearby is everyone the daemon found on the local
 * network, Online is everyone it reports as online. My org is not offered - the answer carries a deployment scope
 * but nothing that says which of them is this account's, so a filter built on it could quietly show the wrong set.
 */
export function filterPeople(rows: readonly PersonRow[], filter: SonarFilter, query: string): PersonRow[] {
  const kept = rows.filter((row) => {
    if (filter === 'Nearby') return row.nearby
    if (filter === 'Online') return row.online
    // My org is not offered, and if it were ever reached it must not quietly mean All: this app cannot tell which
    // people share the account's organisation, so it can honestly name none of them.
    if (filter === 'My org') return false
    return true
  })
  return kept.filter((row) => matches(row, query))
}

/** Jam searches the directory by what it shows: a person's name, their handle, and the agents they advertise. */
function matches(row: PersonRow, query: string): boolean {
  const needle = query.trim().replace(/^@/, '').toLowerCase()
  if (needle === '') return true
  const words = [row.name, row.handle ?? '', ...row.agents.flatMap((agent) => [agent.name, agent.handle ?? ''])]
  return words.some((word) => word.toLowerCase().includes(needle))
}

/** Jam's "Online first": the people it reports online, then the rest, each group newest-seen first. */
export function sortPeople(rows: readonly PersonRow[]): PersonRow[] {
  return [...rows].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1
    return (b.lastSeenMs ?? 0) - (a.lastSeenMs ?? 0)
  })
}

/**
 * What Jam writes under a person's name after their handle. With no agents it is Jam's own line, read from its
 * screen; with agents, what Jam writes there was never seen, so this app counts them in its own words.
 */
export function agentsLine(row: PersonRow): string {
  const unread = agentsUnread(row)
  // A person whose agents the answer held but this app could not read says so: Jam's "No agents advertised", and
  // any count short of what the answer gave, are claims about them the answer never made.
  if (row.agents.length === 0) {
    return unread > 0
      ? `${unread} ${unread === 1 ? 'agent' : 'agents'} in a form this app does not know`
      : 'No agents advertised'
  }
  const counted = row.agents.length === 1 ? '1 agent' : `${row.agents.length} agents`
  return unread > 0 ? `${counted}, and ${unread} more in a form this app does not know` : counted
}

/**
 * Why discovery is not working, in the app's own words, or null when it is. The only multicast state ever recorded
 * is "ok", so any other is reported in the daemon's own word rather than named as a blocked network, with the
 * advice the user guide gives for it ("Recover Sonar").
 */
export function discoveryProblem(snapshot: { discoverable?: boolean; multicast?: string } | null): string | null {
  if (!snapshot) return null
  if (snapshot.discoverable !== true) return 'Discovery is off. Nearby Band users cannot see this installation.'
  if (snapshot.multicast && snapshot.multicast !== 'ok') {
    return `Band reports local multicast as "${snapshot.multicast}". Discovery cannot work on a network that blocks it; check the local firewall and network policy.`
  }
  return null
}

/**
 * What the screen must say about people the answer held and this app could not read. Nobody nearby and nobody it
 * could read are different things, and only the first of them may be reported as an empty network.
 */
export function peopleUnread(snapshot: { users?: unknown[]; usersOffered?: number } | null): number {
  if (!snapshot) return 0
  return Math.max(0, (snapshot.usersOffered ?? 0) - (snapshot.users?.length ?? 0))
}

/** How many of a person's agents the answer held that this app could not read. */
export function agentsUnread(row: PersonRow): number {
  return Math.max(0, row.agentsOffered - row.agents.length)
}
