import { describe, expect, it } from 'vitest'
import type { AgentRow, Team } from '@shared/daemon'
import { draftOf, draftProblem, emptyDraft, matchesTeam, memberName, rosterLine, teamMembers } from './teams'

const atlas: AgentRow = { id: 'agent-atlas', name: 'Atlas', handle: 'sam-rivera/atlas' }
const nova: AgentRow = { id: 'agent-nova', name: 'Nova', handle: 'sam-rivera/nova' }
const rows = [atlas, nova]

const team = (over: Partial<Team> = {}): Team => ({
  id: 'team-checkout',
  name: 'Checkout crew',
  description: 'Plans and ships the checkout flow.',
  guidelines: 'Say why in one line.',
  agent_ids: ['agent-atlas', 'agent-nova'],
  role_ids: [],
  template_id: null,
  updated_at_ms: null,
  ...over,
})

describe('what Teams shows', () => {
  it('names a team’s agents from the agent list, in the team’s order, and counts the ones it does not hold', () => {
    expect(teamMembers(team({ agent_ids: ['agent-nova', 'agent-atlas'] }), rows).members.map(memberName)).toEqual([
      'Nova',
      'Atlas',
    ])
    expect(teamMembers(team({ agent_ids: ['agent-nova', 'agent-gone'] }), rows)).toEqual({
      members: [nova],
      missing: 1,
    })
  })

  it('says Band’s "On your roster" only when every agent is on the account, and counts otherwise', () => {
    expect(rosterLine(team(), rows)).toBe('On your roster')
    expect(rosterLine(team({ agent_ids: ['agent-nova', 'agent-gone'] }), rows)).toBe('1 of 2 on your roster')
  })

  it('finds a team by its name, its description or one of its agents, ignoring case', () => {
    expect(matchesTeam(team(), rows, '')).toBe(true)
    expect(matchesTeam(team(), rows, 'CHECKOUT')).toBe(true)
    expect(matchesTeam(team(), rows, 'ships the')).toBe(true)
    expect(matchesTeam(team(), rows, 'nova')).toBe(true)
    expect(matchesTeam(team(), rows, 'sam-rivera/atlas')).toBe(true)
    expect(matchesTeam(team({ agent_ids: ['agent-atlas'] }), rows, 'nova')).toBe(false)
    expect(matchesTeam(team(), rows, 'release')).toBe(false)
  })

  it('keeps an edited team’s own roles, and gives a new one none', () => {
    expect(draftOf(team({ role_ids: ['security-reviewer'] }))).toEqual({
      name: 'Checkout crew',
      description: 'Plans and ships the checkout flow.',
      guidelines: 'Say why in one line.',
      agentIds: ['agent-atlas', 'agent-nova'],
      roleIds: ['security-reviewer'],
    })
    expect(emptyDraft().roleIds).toEqual([])
  })

  it('holds a form back without a name, then with no agent in Band’s own words, and lets a full one go', () => {
    expect(draftProblem(emptyDraft())).toBe('A team needs a name.')
    expect(draftProblem({ ...emptyDraft(), name: '   ', agentIds: ['agent-atlas'] })).toBe('A team needs a name.')
    expect(draftProblem({ ...emptyDraft(), name: 'Docs crew' })).toBe('Choose at least one agent for the team.')
    expect(draftProblem({ ...emptyDraft(), name: 'Docs crew', agentIds: ['agent-atlas'] })).toBeNull()
  })
})
