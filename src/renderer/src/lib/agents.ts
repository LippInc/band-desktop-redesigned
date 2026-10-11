import type {
  AgentRow,
  AgentRuntime,
  AgentSession,
  AgentStatus,
  Participant,
  Room,
  RuntimePermission,
  WorkSummary,
} from '@shared/daemon'

/** What one agent's own reads answered, by its local peer key. */
export type AgentReads = Readonly<Record<string, { sessions?: AgentSession[]; status?: AgentStatus } | undefined>>

/**
 * What the Agents screen shows: the three filters over the list, and what each tab of one agent's details carries.
 * Jam's own words throughout (its user guide, "Find an agent" and "Read agent details").
 */

/** A provider's name as Jam Desktop writes it on a card (0.4.10: "Claude Code"). */
export const PROVIDERS: Record<string, string> = {
  claudecode: 'Claude Code',
  codex: 'Codex',
  copilot: 'GitHub Copilot',
}

export const providerName = (host: string | null | undefined): string | null =>
  host ? (PROVIDERS[host] ?? host) : null

/**
 * Jam's three filters over the list, in Jam's order, with Jam's own values and Jam's own rules for them (its user
 * guide, "Find an agent"): "Where selects agents on this machine or elsewhere. Provider selects the coding agent
 * behind them. Runtime selects Headless (Jam starts it on demand), Terminal attached (you attached a coding session),
 * or Nothing attached (no coding session yet). Select as many values as you want. Values inside one filter widen the
 * list, and separate filters narrow it." Every value is always offered, because "a value showing 0 stays selectable -
 * selecting it is how you widen a selection that has become too narrow".
 */
export const AGENT_FILTERS = ['Where', 'Provider', 'Runtime'] as const
export type AgentFilter = (typeof AGENT_FILTERS)[number]

export const WHERE_OPTIONS = ['This machine', 'Elsewhere'] as const

/**
 * The providers Jam offers, in Jam's order. A terminal-attached session is its own value beside the runtime Jam owns,
 * which is why each provider appears twice.
 */
export const PROVIDER_OPTIONS = [
  'Claude Code',
  'GitHub Copilot',
  'Codex',
  'Command-line session',
  'Claude Code · terminal',
  'GitHub Copilot · terminal',
  'Codex · terminal',
] as const

export const RUNTIME_OPTIONS = ['Headless', 'Terminal attached', 'Nothing attached'] as const

/** Every value a filter offers. They are Jam's fixed lists, not what the agents in hand happen to have. */
export function filterOptions(filter: AgentFilter): readonly string[] {
  if (filter === 'Where') return WHERE_OPTIONS
  if (filter === 'Provider') return PROVIDER_OPTIONS
  return RUNTIME_OPTIONS
}

/** Which values of each filter are selected. An empty or missing list means the filter is not narrowing anything. */
export type AgentFilters = Readonly<Partial<Record<AgentFilter, readonly string[]>>>

/**
 * The one value an agent has for a filter, or null when this app cannot say.
 *
 * Null is not "no": it is "not known here", and it never hides an agent, the way the room list's own filter never
 * hides a room it has read nothing about. Jam's guide settles the one case that is a real no rather than an unknown:
 * "Provider and Runtime describe how an agent runs on this machine, so an agent that runs elsewhere does not match
 * either filter."
 */
export function agentValue(row: AgentRow, status: AgentStatus | undefined, filter: AgentFilter): string | null {
  if (filter === 'Where') return row.local ? 'This machine' : 'Elsewhere'
  // An agent that runs elsewhere matches no Provider and no Runtime value at all, which is a no and not an unknown.
  if (!row.local) return ''
  if (status === undefined) return null
  // A session Jam starts on demand is "owned"; any other session is one that was attached. An agent with no session
  // at all is Jam's "Nothing attached".
  const owned = status.runtimes.some((one) => one.runtime.mode === 'owned')
  const attached = status.runtimes.some((one) => one.runtime.mode !== 'owned')
  if (filter === 'Runtime') {
    if (status.runtimes.length === 0) return 'Nothing attached'
    return owned ? 'Headless' : 'Terminal attached'
  }
  const provider = providerName(row.local.host)
  if (!provider) return null
  return attached && !owned ? `${provider} · terminal` : provider
}

/**
 * Whether one agent answers every filter that is narrowing. Within a filter the chosen values widen (any of them
 * will do); between filters they narrow (each must be answered). A value this app cannot judge never hides an agent.
 */
export function passesFilters(row: AgentRow, status: AgentStatus | undefined, filters: AgentFilters): boolean {
  for (const filter of AGENT_FILTERS) {
    const chosen = filters[filter]
    if (!chosen || chosen.length === 0) continue
    const value = agentValue(row, status, filter)
    if (value === null) continue
    if (!chosen.includes(value)) return false
  }
  return true
}

/**
 * How many agents a value would leave. Jam counts it "against the other filters and your search", so the filter the
 * value belongs to is replaced by that value alone and every other narrowing stays where it is.
 */
export function optionCount(
  rows: readonly AgentRow[],
  reads: AgentReads,
  filters: AgentFilters,
  filter: AgentFilter,
  value: string,
): number {
  const asked: AgentFilters = { ...filters, [filter]: [value] }
  return rows.filter((row) => passesFilters(row, reads[row.local?.peer_key ?? '']?.status, asked)).length
}

/** Jam's tabs on one agent, in Jam's order. Only the ones this app has a recorded read for are here. */
export const AGENT_TABS = ['Overview', 'Sessions', 'Permissions', 'Runtime', 'Rooms', 'Work', 'Info'] as const
export type AgentTab = (typeof AGENT_TABS)[number]

/** Jam's own word for a runtime setting the agent has not been given. */
export const UNSET = 'Not set'

const said = (value: string | null | undefined): string => (value && value.trim() !== '' ? value : UNSET)

/** One line of the Runtime tab. */
export interface RuntimeLine {
  label: string
  value: string
}

/**
 * How one session's runtime is set up, as lines. Jam's Runtime tab names the model, the reasoning effort, the approval
 * policy and the sandbox policy; the thread's own values win where it has them, and the provider's stand in where it
 * does not, which is what the daemon's two blocks mean.
 */
export function runtimeLines(runtime: AgentRuntime): RuntimeLine[] {
  const thread = runtime.thread ?? null
  const code = runtime.claude_code ?? null
  const sandbox = runtime.spawn?.sandbox ?? null
  const lines: RuntimeLine[] = [
    { label: 'Model', value: said(thread?.model ?? code?.model) },
    { label: 'Reasoning effort', value: said(thread?.reasoning_effort ?? code?.reasoning_effort) },
    { label: 'Approval policy', value: said(thread?.approval_policy ?? code?.permission_mode) },
    {
      label: 'Sandbox policy',
      value: thread?.sandbox_mode
        ? thread.sandbox_mode
        : sandbox
          ? sandbox.enabled
            ? (sandbox.name ?? 'On')
            : 'Off'
          : UNSET,
    },
    {
      label: 'Web search',
      value: thread?.web_search === null || thread?.web_search === undefined ? UNSET : thread.web_search ? 'On' : 'Off',
    },
    { label: 'Configuration', value: said(code?.context_mode) },
    { label: 'Mode', value: said(runtime.mode) },
    { label: 'Transport', value: said(runtime.transport) },
    { label: 'Runtime version', value: said(runtime.spawn?.runtime_version) },
    { label: 'Sign-in', value: said(runtime.spawn?.auth_mode) },
  ]
  const blocked = code?.disallowed_tools ?? null
  if (blocked && blocked.length > 0) {
    lines.push({ label: 'Tools it may not use', value: `${blocked.length}: ${blocked.join(', ')}` })
  }
  return lines
}

/** The rooms an agent is a participant of, newest first, out of the rooms whose participants have been read. */
export function agentRooms(
  row: AgentRow,
  rooms: readonly Room[],
  people: Readonly<Record<string, Participant[] | undefined>>,
): Room[] {
  return rooms.filter((room) => people[room.id]?.some((person) => person.id === row.id))
}

/** What an agent has open across the account's rooms: its own lane's tasks, by room. */
export function agentWork(
  row: AgentRow,
  work: WorkSummary | null,
  rooms: readonly Room[],
): { roomId: string; roomTitle: string; open: number; done: number }[] {
  const key = row.local?.peer_key
  if (!work || !key) return []
  return work.rooms
    .map((entry) => {
      const tasks = entry.lanes.filter((lane) => lane.peer_id === key).flatMap((lane) => lane.tasks)
      return {
        roomId: entry.roomId,
        roomTitle: rooms.find((room) => room.id === entry.roomId)?.title ?? 'A room',
        open: tasks.filter((task) => task.status === 'pending' || task.status === 'in_progress').length,
        done: tasks.filter((task) => task.status === 'completed').length,
      }
    })
    .filter((entry) => entry.open + entry.done > 0)
}

/**
 * What the Permissions tab shows: every permission this agent's sessions have asked for on this computer, newest
 * first, with what was asked, where, and how it ended.
 *
 * The outcomes the daemon answers are its own words (`allow_once`, `deny_once`, `deny_always`, `expired`). Jam's own
 * wording for a request that has already been decided was never seen - its tab was never opened - so these are this
 * app's words, and `docs/jam/differences.md` says so. Jam's three buttons on a request that is still waiting are
 * matched exactly where they do appear, in the room.
 */
export const PERMISSION_STATES: Record<string, string> = {
  allow_once: 'Allowed once',
  allow_always: 'Allowed always',
  deny_once: 'Denied',
  deny_always: 'Denied always',
  expired: 'Expired',
}

export interface PermissionRow {
  id: string
  action: string
  description: string | null
  roomTitle: string | null
  state: string
  at: number | null
}

/** A permission's own state: what it was decided, or that it is still waiting. */
export function permissionState(one: RuntimePermission): string {
  if (one.outcome) return PERMISSION_STATES[one.outcome] ?? one.outcome
  return one.status === 'pending' || one.status === null ? 'Waiting' : one.status
}

export function permissionRows(list: readonly RuntimePermission[], rooms: readonly Room[]): PermissionRow[] {
  return [...list]
    .map((one) => ({
      id: one.id,
      action: one.action ?? 'A request',
      description: one.description,
      roomTitle: one.roomId ? (rooms.find((room) => room.id === one.roomId)?.title ?? null) : null,
      state: permissionState(one),
      at: one.decidedAt ?? one.askedAt,
    }))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
}

/** One line of the Info tab: what names this agent, and where it runs. */
export function infoLines(row: AgentRow, status: AgentStatus | null): RuntimeLine[] {
  return [
    { label: 'Name', value: said(status?.name ?? row.name) },
    { label: 'Handle', value: said(status?.handle ?? row.handle) },
    { label: 'Agent id', value: said(status?.agentId ?? row.id) },
    {
      label: 'Runs on',
      value:
        status?.running === false ? 'This computer, not running' : said(providerName(status?.host ?? row.local?.host)),
    },
    { label: 'Account profile', value: said(status?.profile ?? row.local?.peer_key?.split('/')[0]) },
    { label: 'Scope', value: said(status?.scope ?? row.local?.peer_key?.split('/')[1]) },
    { label: 'Kind', value: said(status?.identityClass) },
  ]
}
