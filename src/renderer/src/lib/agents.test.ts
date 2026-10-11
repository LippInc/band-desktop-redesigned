import { describe, expect, it } from 'vitest'
import type {
  AgentRow,
  AgentRuntime,
  AgentStatus,
  Participant,
  Room,
  RuntimePermission,
  WorkSummary,
} from '@shared/daemon'
import {
  AGENT_TABS,
  agentRooms,
  agentWork,
  agentValue,
  filterOptions,
  infoLines,
  optionCount,
  passesFilters,
  permissionRows,
  permissionState,
  PROVIDER_OPTIONS,
  RUNTIME_OPTIONS,
  providerName,
  runtimeLines,
  UNSET,
  type AgentReads,
} from '@/lib/agents'

const row = (scope: string, over: Partial<AgentRow> = {}): AgentRow => ({
  id: `id-${scope}`,
  name: scope.charAt(0).toUpperCase() + scope.slice(1),
  handle: `owner/${scope}`,
  local: { peer_key: `default/${scope}`, host: 'claudecode' },
  ...over,
})

/** A status carrying one runtime per mode given, which is all the three filters read. */
const status = (modes: string[]): AgentStatus => ({
  scope: 'atlas',
  profile: null,
  agentId: null,
  name: null,
  handle: null,
  host: null,
  startedAt: null,
  identityClass: null,
  state: 'connected',
  running: true,
  warning: null,
  templates: [],
  runtimes: modes.map((mode, index) => ({ session: `s${index}`, room: null, runtime: runtime({ mode }) })),
})

const runtime = (over: Partial<AgentRuntime> = {}): AgentRuntime =>
  ({
    template_id: 'owned/claude-code-cli',
    mode: 'owned',
    transport: 'stdio',
    spawn: { runtime_version: '2.4.1', auth_mode: 'subscription', sandbox: { enabled: false } },
    claude_code: {
      model: 'sonnet',
      reasoning_effort: 'medium',
      permission_mode: 'default',
      context_mode: 'local_config',
    },
    thread: { model: null, reasoning_effort: null, approval_policy: null, sandbox_mode: null, web_search: null },
    ...over,
  }) as AgentRuntime

describe('how an agent is named on its card', () => {
  it('writes a provider as Jam does, and passes on one it has no name for', () => {
    expect(providerName('claudecode')).toBe('Claude Code')
    expect(providerName('codex')).toBe('Codex')
    expect(providerName('something-else')).toBe('something-else')
    expect(providerName(null)).toBeNull()
  })
})

describe('Jam’s three filters', () => {
  const here = row('atlas')
  const away = row('nova', { local: null })
  const reads: AgentReads = { 'default/atlas': { status: status(['owned']) } }

  it('offers Jam’s own values, always, whatever the agents in hand are', () => {
    expect(filterOptions('Where')).toEqual(['This machine', 'Elsewhere'])
    expect(filterOptions('Provider')).toEqual([...PROVIDER_OPTIONS])
    expect(filterOptions('Runtime')).toEqual(['Headless', 'Terminal attached', 'Nothing attached'])
    // Seven providers and three runtimes, as Jam Desktop lists them.
    expect(PROVIDER_OPTIONS).toHaveLength(7)
    expect(RUNTIME_OPTIONS).toHaveLength(3)
  })

  it('splits Where by whether the agent runs on this machine', () => {
    expect(agentValue(here, undefined, 'Where')).toBe('This machine')
    expect(agentValue(away, undefined, 'Where')).toBe('Elsewhere')
  })

  /** The guide: "an agent that runs elsewhere does not match either filter". That is a no, not an unknown. */
  it('never matches an agent elsewhere against Provider or Runtime', () => {
    expect(passesFilters(away, undefined, { Provider: ['Claude Code'] })).toBe(false)
    expect(passesFilters(away, undefined, { Runtime: ['Headless'] })).toBe(false)
    expect(passesFilters(away, undefined, { Where: ['Elsewhere'] })).toBe(true)
  })

  it('reads Runtime as Jam names it', () => {
    expect(agentValue(here, status([]), 'Runtime')).toBe('Nothing attached')
    expect(agentValue(here, status(['owned']), 'Runtime')).toBe('Headless')
    expect(agentValue(here, status(['attached']), 'Runtime')).toBe('Terminal attached')
  })

  it('names a provider, and marks one whose only session was attached', () => {
    expect(agentValue(here, status(['owned']), 'Provider')).toBe('Claude Code')
    expect(agentValue(here, status(['attached']), 'Provider')).toBe('Claude Code · terminal')
  })

  it('widens within one filter and narrows between them', () => {
    const owned = status(['owned'])
    // Two values of one filter: either will do.
    expect(passesFilters(here, owned, { Runtime: ['Headless', 'Nothing attached'] })).toBe(true)
    expect(passesFilters(here, owned, { Runtime: ['Terminal attached', 'Nothing attached'] })).toBe(false)
    // Two filters together: both must be answered.
    expect(passesFilters(here, owned, { Where: ['This machine'], Runtime: ['Headless'] })).toBe(true)
    expect(passesFilters(here, owned, { Where: ['Elsewhere'], Runtime: ['Headless'] })).toBe(false)
  })

  it('does not hide an agent whose status it has not read', () => {
    expect(passesFilters(here, undefined, { Runtime: ['Nothing attached'] })).toBe(true)
    expect(passesFilters(here, undefined, { Provider: ['Codex'] })).toBe(true)
  })

  it('treats an empty selection as no narrowing at all', () => {
    expect(passesFilters(away, undefined, { Provider: [] })).toBe(true)
    expect(passesFilters(here, status(['owned']), {})).toBe(true)
  })

  /** Jam counts a value "against the other filters and your search", and a 0 is still offered. */
  it('counts what a value would leave, against the other filters', () => {
    const rows = [here, away]
    expect(optionCount(rows, reads, {}, 'Where', 'This machine')).toBe(1)
    expect(optionCount(rows, reads, {}, 'Where', 'Elsewhere')).toBe(1)
    expect(optionCount(rows, reads, {}, 'Runtime', 'Headless')).toBe(1)
    // Nothing is attached to either agent, and the one elsewhere cannot match a Runtime value at all.
    expect(optionCount(rows, reads, {}, 'Runtime', 'Terminal attached')).toBe(0)
    // With Where already narrowed to Elsewhere, no Provider value can leave anything.
    expect(optionCount(rows, reads, { Where: ['Elsewhere'] }, 'Provider', 'Claude Code')).toBe(0)
  })

  it('counts against the search, because the caller counts over the rows the search left', () => {
    expect(optionCount([here], reads, {}, 'Where', 'Elsewhere')).toBe(0)
    expect(optionCount([here], reads, {}, 'Where', 'This machine')).toBe(1)
  })
})

const perm = (over: Partial<RuntimePermission> = {}): RuntimePermission =>
  ({
    id: 'p1',
    roomId: null,
    action: 'Write',
    description: 'Write the checklist',
    askedAt: 1000,
    expiresAt: null,
    rule: null,
    status: 'resolved',
    outcome: 'allow_once',
    decidedAt: 2000,
    reason: null,
    ...over,
  }) as RuntimePermission

/** The one row a fixture lists, proven to be there before it is asked about. */
const first = <T>(rows: T[]): T => {
  const one = rows[0]
  if (!one) throw new Error('the fixture built no row')
  return one
}

describe('what the Permissions tab says', () => {
  it('writes each outcome the daemon answers', () => {
    expect(permissionState(perm({ outcome: 'allow_once' }))).toBe('Allowed once')
    expect(permissionState(perm({ outcome: 'deny_once' }))).toBe('Denied')
    expect(permissionState(perm({ outcome: 'deny_always' }))).toBe('Denied always')
    expect(permissionState(perm({ outcome: 'expired' }))).toBe('Expired')
  })

  it('passes on an outcome it has no word for, rather than calling it something else', () => {
    expect(permissionState(perm({ outcome: 'something_new' }))).toBe('something_new')
  })

  it('says a request nobody has answered is still waiting', () => {
    expect(permissionState(perm({ outcome: null, status: 'pending' }))).toBe('Waiting')
    expect(permissionState(perm({ outcome: null, status: null }))).toBe('Waiting')
  })

  it('lists the newest first, by when it was decided or else when it was asked', () => {
    const rows = permissionRows(
      [
        perm({ id: 'old', decidedAt: 100, askedAt: 50 }),
        perm({ id: 'new', decidedAt: 900, askedAt: 800 }),
        perm({ id: 'waiting', outcome: null, decidedAt: null, askedAt: 500, status: 'pending' }),
      ],
      [],
    )
    expect(rows.map((one) => one.id)).toEqual(['new', 'waiting', 'old'])
  })

  it('names the room when it knows it, and says nothing when it does not', () => {
    const rooms = [{ id: 'r1', title: 'Checkout flow redesign' }] as Room[]
    expect(first(permissionRows([perm({ roomId: 'r1' })], rooms)).roomTitle).toBe('Checkout flow redesign')
    expect(first(permissionRows([perm({ roomId: 'gone' })], rooms)).roomTitle).toBeNull()
    expect(first(permissionRows([perm({ roomId: null })], rooms)).roomTitle).toBeNull()
  })

  it('falls back when the answer carried no action', () => {
    expect(first(permissionRows([perm({ action: null })], [])).action).toBe('A request')
  })
})

describe('how a runtime reads', () => {
  it('shows what the provider was given when the thread says nothing', () => {
    const lines = runtimeLines(runtime())
    expect(lines.find((line) => line.label === 'Model')?.value).toBe('sonnet')
    expect(lines.find((line) => line.label === 'Approval policy')?.value).toBe('default')
    expect(lines.find((line) => line.label === 'Sandbox policy')?.value).toBe('Off')
  })

  it('lets the thread’s own values win where it has them', () => {
    const lines = runtimeLines(
      runtime({
        thread: {
          model: 'opus',
          reasoning_effort: 'high',
          approval_policy: 'never',
          sandbox_mode: 'strict',
          web_search: true,
        },
      } as Partial<AgentRuntime>),
    )
    expect(lines.find((line) => line.label === 'Model')?.value).toBe('opus')
    expect(lines.find((line) => line.label === 'Sandbox policy')?.value).toBe('strict')
    expect(lines.find((line) => line.label === 'Web search')?.value).toBe('On')
  })

  it('says a setting is not set rather than leaving it blank or guessing', () => {
    const lines = runtimeLines({
      template_id: null,
      mode: null,
      transport: null,
      spawn: null,
      claude_code: null,
      thread: null,
    })
    expect(lines.every((line) => line.value !== '')).toBe(true)
    expect(lines.find((line) => line.label === 'Model')?.value).toBe(UNSET)
    expect(lines.find((line) => line.label === 'Web search')?.value).toBe(UNSET)
    expect(lines.find((line) => line.label === 'Sandbox policy')?.value).toBe(UNSET)
  })

  it('names the tools the agent may not use, with how many', () => {
    const lines = runtimeLines(
      runtime({ claude_code: { disallowed_tools: ['WebFetch', 'WebSearch'] } } as Partial<AgentRuntime>),
    )
    expect(lines.find((line) => line.label === 'Tools it may not use')?.value).toBe('2: WebFetch, WebSearch')
  })

  it('leaves that line out when the agent may use everything', () => {
    expect(runtimeLines(runtime()).some((line) => line.label === 'Tools it may not use')).toBe(false)
  })
})

describe('an agent’s rooms and work', () => {
  const rooms = [
    { id: 'a', title: 'Checkout' },
    { id: 'b', title: 'Billing' },
  ] as Room[]
  const people: Record<string, Participant[]> = {
    a: [{ id: 'id-atlas', kind: 'Agent' }],
    b: [{ id: 'id-nova', kind: 'Agent' }],
  }

  it('lists only the rooms it is a participant of', () => {
    expect(agentRooms(row('atlas'), rooms, people).map((one) => one.title)).toEqual(['Checkout'])
  })

  it('says nothing about a room whose participants are not read', () => {
    expect(agentRooms(row('atlas'), rooms, {})).toEqual([])
  })

  it('counts its own lane’s tasks by room, and leaves out a room with none', () => {
    const work: WorkSummary = {
      boards: 0,
      lanes: 2,
      rooms: [
        {
          roomId: 'a',
          lanes: [
            {
              peer_id: 'default/atlas',
              active: true,
              tasks: [
                { status: 'in_progress' },
                { status: 'completed' },
                { status: 'pending' },
              ] as WorkSummary['rooms'][number]['lanes'][number]['tasks'],
            },
          ],
        },
        { roomId: 'b', lanes: [{ peer_id: 'default/nova', active: true, tasks: [{ status: 'pending' }] as never }] },
      ],
    }
    expect(agentWork(row('atlas'), work, rooms)).toEqual([{ roomId: 'a', roomTitle: 'Checkout', open: 2, done: 1 }])
  })

  it('has no work before the snapshot is read, or for an agent that runs elsewhere', () => {
    expect(agentWork(row('atlas'), null, rooms)).toEqual([])
    expect(agentWork(row('atlas', { local: null }), { boards: 0, lanes: 0, rooms: [] }, rooms)).toEqual([])
  })
})

describe('what Info says', () => {
  it('falls back to the agent list when its status has not been read', () => {
    const lines = infoLines(row('atlas'), null)
    expect(lines.find((line) => line.label === 'Name')?.value).toBe('Atlas')
    expect(lines.find((line) => line.label === 'Scope')?.value).toBe('atlas')
    expect(lines.find((line) => line.label === 'Kind')?.value).toBe(UNSET)
  })

  it('says a runtime that is not running rather than naming a provider that is not there', () => {
    const lines = infoLines(row('atlas'), { running: false } as AgentStatus)
    expect(lines.find((line) => line.label === 'Runs on')?.value).toBe('This computer, not running')
  })
})

describe('the detail’s tabs', () => {
  it('are the ones this app has a recorded read behind, in Jam’s order', () => {
    expect([...AGENT_TABS]).toEqual(['Overview', 'Sessions', 'Permissions', 'Runtime', 'Rooms', 'Work', 'Info'])
  })
})
