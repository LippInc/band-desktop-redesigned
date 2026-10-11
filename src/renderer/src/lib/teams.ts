import type { AgentRow, Team, TeamDraft } from '@shared/daemon'

/**
 * What Teams shows (Band Desktop 0.4.14's Teams; user guide, "Teams"): a team is a group of the account's agents with
 * a name, a description and optional shared guidelines. Its agents are named by their Band ids, so each is looked up in
 * the agent list; one the list does not hold is counted, never invented.
 */

/** A team's agents as the agent list knows them, in the team's order, and how many of its ids the list does not hold. */
export function teamMembers(team: Team, rows: readonly AgentRow[]): { members: AgentRow[]; missing: number } {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const members = team.agent_ids.flatMap((id) => {
    const row = byId.get(id)
    return row ? [row] : []
  })
  return { members, missing: team.agent_ids.length - members.length }
}

/** An agent's name as Teams writes it: its name, else its handle. */
export function memberName(row: AgentRow): string {
  return row.name || row.handle || 'Agent'
}

/**
 * Band's line for a team whose agents are all on the account ("On your roster"). For one with agents the list does not
 * hold, this app's own count (Band's words for that state were never seen).
 */
export function rosterLine(team: Team, rows: readonly AgentRow[]): string {
  const { members, missing } = teamMembers(team, rows)
  if (missing === 0) return 'On your roster'
  return `${members.length} of ${team.agent_ids.length} on your roster`
}

/** Whether a team matches what was typed in Search teams: its name, its description, or one of its agents. */
export function matchesTeam(team: Team, rows: readonly AgentRow[], query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const words = [team.name, team.description ?? '']
  for (const row of teamMembers(team, rows).members) words.push(row.name ?? '', row.handle ?? '')
  return words.some((word) => word.toLowerCase().includes(needle))
}

/** A new team's empty form: no roles, as a team made by hand has none. */
export function emptyDraft(): TeamDraft {
  return { name: '', description: '', guidelines: '', agentIds: [], roleIds: [] }
}

/** A team in its edit form, with its own roles kept, so saving it never drops them. */
export function draftOf(team: Team): TeamDraft {
  return {
    name: team.name,
    description: team.description ?? '',
    guidelines: team.guidelines ?? '',
    agentIds: [...team.agent_ids],
    roleIds: [...team.role_ids],
  }
}

/**
 * Why a form cannot be sent yet, or null. The agent rule is Band's own refusal, in its words; a name is this app's own
 * rule, because a team without one would have nothing to show on its card.
 */
export function draftProblem(draft: TeamDraft): string | null {
  if (!draft.name.trim()) return 'A team needs a name.'
  if (draft.agentIds.length === 0) return 'Choose at least one agent for the team.'
  return null
}
