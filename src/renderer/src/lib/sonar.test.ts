import { describe, expect, it } from 'vitest'
import type { DiscoveredUser } from '@shared/daemon'
import {
  agentsLine,
  agentsUnread,
  discoveryProblem,
  filterPeople,
  peopleUnread,
  personRows,
  sortPeople,
} from '@/lib/sonar'

const agent = (over: Record<string, unknown> = {}) => ({
  agent_id: 'agent-a',
  handle: 'sam-rivera/atlas',
  name: 'Atlas',
  state: 'connected',
  activity: { kind: 'working' },
  tasks: { pending: 2, in_progress: 1, completed: 4 },
  cost: 1.82,
  ...over,
})

const user = (over: Record<string, unknown> = {}) =>
  ({
    deployment_scope: 'scope-a',
    user_id: 'user-a',
    owner_handle: 'sam-rivera',
    display_name: 'Sam Rivera',
    agents: [agent()],
    teams: [],
    last_seen_ms: 1789763940000,
    online: true,
    origins: ['lan'],
    ...over,
  }) as unknown as DiscoveredUser

describe('what Sonar shows', () => {
  it("reads a person and their agents in the daemon's own words", () => {
    const [row] = personRows([user()])
    expect(row).toMatchObject({ name: 'Sam Rivera', handle: 'sam-rivera', online: true, nearby: true, teams: 0 })
    expect(row?.agents[0]).toMatchObject({
      name: 'Atlas',
      handle: 'sam-rivera/atlas',
      state: 'connected',
      connected: true,
      activity: 'working',
      tasks: { pending: 2, inProgress: 1, completed: 4 },
      cost: 1.82,
    })
  })

  // Only the daemon's own word for a connected agent counts, and a state it has never seen must not read as one.
  it('calls only "connected" connected, and puts no word of its own where the daemon sent none', () => {
    const [row] = personRows([
      user({
        agents: [agent({ state: 'disconnected' }), agent({ agent_id: 'b', state: undefined, activity: undefined })],
      }),
    ])
    expect(row?.agents[0]).toMatchObject({ state: 'disconnected', connected: false })
    expect(row?.agents[1]).toMatchObject({ state: '', connected: false, activity: '' })
  })

  // Three zeroes would state how much work someone else has done. An answer that counted none of it says
  // nothing, as it does for a cost the person does not share.
  it('counts no task the daemon did not count, and keeps a cost it did not share as absent', () => {
    const [row] = personRows([user({ agents: [agent({ tasks: undefined, cost: undefined })] })])
    expect(row?.agents[0]?.tasks).toBeNull()
    expect(row?.agents[0]?.cost).toBeNull()
    // A count the answer did make is kept, and each part of it the answer left out reads as zero.
    const [some] = personRows([user({ agents: [agent({ tasks: { pending: 3 } })] })])
    expect(some?.agents[0]?.tasks).toEqual({ pending: 3, inProgress: 0, completed: 0 })
    const [rest] = personRows([user({ agents: [agent({ tasks: { completed: 2 } })] })])
    expect(rest?.agents[0]?.tasks).toEqual({ pending: 0, inProgress: 0, completed: 2 })
    const [middle] = personRows([user({ agents: [agent({ tasks: { in_progress: 1 } })] })])
    expect(middle?.agents[0]?.tasks).toEqual({ pending: 0, inProgress: 1, completed: 0 })
  })

  // A row with no name on it says nothing about who is nearby, so a person the answer names in no way is
  // left out and counted instead - the rule Contacts already follows for a contact it cannot name.
  it('names a person by their handle, and lists no one the answer names in no way', () => {
    expect(personRows([user({ display_name: '' })])[0]?.name).toBe('sam-rivera')
    expect(personRows([user({ display_name: '', owner_handle: '' })])).toEqual([])
    expect(personRows([user({ display_name: '', owner_handle: undefined })])).toEqual([])
  })

  it('calls nearby only what the daemon found on the local network', () => {
    const rows = personRows([user(), user({ user_id: 'b', origins: [] }), user({ user_id: 'c', origins: undefined })])
    expect(rows.map((row) => row.nearby)).toEqual([true, false, false])
  })

  it("keeps everyone under All, and narrows to Jam's other filters", () => {
    const rows = personRows([
      user(),
      user({ user_id: 'b', display_name: 'Robin Vale', online: false, origins: ['lan'] }),
      user({ user_id: 'c', display_name: 'Kit Marlow', online: true, origins: [] }),
    ])
    expect(filterPeople(rows, 'All', '').map((row) => row.name)).toEqual(['Sam Rivera', 'Robin Vale', 'Kit Marlow'])
    expect(filterPeople(rows, 'Nearby', '').map((row) => row.name)).toEqual(['Sam Rivera', 'Robin Vale'])
    expect(filterPeople(rows, 'Online', '').map((row) => row.name)).toEqual(['Sam Rivera', 'Kit Marlow'])
  })

  it('searches a person by name, handle and the agents they advertise, and drops a typed @', () => {
    const rows = personRows([
      user(),
      user({ user_id: 'b', display_name: 'Robin Vale', owner_handle: 'robin', agents: [] }),
    ])
    expect(filterPeople(rows, 'All', 'atlas').map((row) => row.name)).toEqual(['Sam Rivera'])
    expect(filterPeople(rows, 'All', '@robin').map((row) => row.name)).toEqual(['Robin Vale'])
    expect(filterPeople(rows, 'All', 'VALE').map((row) => row.name)).toEqual(['Robin Vale'])
    expect(filterPeople(rows, 'All', '  ')).toHaveLength(2)
    expect(filterPeople(rows, 'All', 'nobody')).toEqual([])
  })

  it('puts the people it reports online first, each group newest-seen first', () => {
    const rows = personRows([
      user({ user_id: 'a', display_name: 'A', online: false, last_seen_ms: 30 }),
      user({ user_id: 'b', display_name: 'B', online: true, last_seen_ms: 10 }),
      user({ user_id: 'c', display_name: 'C', online: false, last_seen_ms: 40 }),
      user({ user_id: 'd', display_name: 'D', online: true, last_seen_ms: 20 }),
    ])
    expect(sortPeople(rows).map((row) => row.name)).toEqual(['D', 'B', 'C', 'A'])
    // Sorting must not change who is there.
    expect(sortPeople(rows)).toHaveLength(4)
    expect(sortPeople([])).toEqual([])
  })

  it("writes Jam's own line for a person with no agents, and counts them when there are", () => {
    expect(agentsLine(personRows([user({ agents: [] })])[0]!)).toBe('No agents advertised')
    expect(agentsLine(personRows([user()])[0]!)).toBe('1 agent')
    expect(agentsLine(personRows([user({ agents: [agent(), agent({ agent_id: 'b' })] })])[0]!)).toBe('2 agents')
  })

  it('says why discovery is not working, and nothing when it is', () => {
    expect(discoveryProblem({ discoverable: true, multicast: 'ok' })).toBeNull()
    expect(discoveryProblem({ discoverable: true })).toBeNull()
    expect(discoveryProblem({ discoverable: false, multicast: 'ok' })).toMatch(/Discovery is off/)
    // Only "ok" has ever been recorded, so any other state is reported in the daemon's own word, with the
    // advice the user guide gives - never as a diagnosis this app made up.
    const other = discoveryProblem({ discoverable: true, multicast: 'blocked' })
    expect(other).toContain('"blocked"')
    expect(other).toMatch(/firewall and network policy/)
    expect(discoveryProblem(null)).toBeNull()
  })

  // A person whose agents the answer held but this app could not read has not advertised none: saying so would be
  // a claim about them the answer never made.
  it('counts what it could not read alongside what it could', () => {
    const partly = personRows([user({ agentsOffered: 3 })])[0]!
    expect(agentsUnread(partly)).toBe(2)
    expect(agentsLine(partly)).toBe('1 agent, and 2 more in a form this app does not know')
    expect(peopleUnread({ users: [{}], usersOffered: 4 })).toBe(3)
    expect(peopleUnread({ users: [{}, {}], usersOffered: 2 })).toBe(0)
    expect(peopleUnread(null)).toBe(0)
    // A count that cannot go negative: a daemon that offered fewer than it gave says nothing was lost.
    expect(peopleUnread({ users: [{}, {}], usersOffered: 1 })).toBe(0)
  })

  it('tells a person who advertises none from one whose agents it could not read', () => {
    const none = personRows([user({ agents: [], agentsOffered: 0 })])[0]!
    const unread = personRows([user({ agents: [], agentsOffered: 2 })])[0]!
    expect(agentsLine(none)).toBe('No agents advertised')
    expect(agentsLine(unread)).toBe('2 agents in a form this app does not know')
    expect(agentsLine(personRows([user({ agents: [], agentsOffered: 1 })])[0]!)).toBe(
      '1 agent in a form this app does not know',
    )
  })

  it('counts the teams a person reports sharing', () => {
    expect(personRows([user({ teams: [] })])[0]?.teams).toBe(0)
    expect(personRows([user({ teams: [{}, {}] })])[0]?.teams).toBe(2)
    expect(personRows([user({ teams: undefined })])[0]?.teams).toBe(0)
  })

  // My org is not offered, and it must never quietly mean All: this app cannot tell which people share the
  // account's organisation, so the filter can honestly name none of them.
  it('names nobody under My org rather than everybody', () => {
    const rows = personRows([user(), user({ user_id: 'b', display_name: 'Robin Vale' })])
    expect(filterPeople(rows, 'My org', '')).toEqual([])
    expect(filterPeople(rows, 'All', '')).toHaveLength(2)
  })

  it('has nothing to list for a snapshot with no one in it', () => {
    expect(personRows([])).toEqual([])
    expect(filterPeople([], 'Online', '')).toEqual([])
  })
})
