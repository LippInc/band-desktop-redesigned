import type { DashboardRange, Series, UsageAgent, UsageAmounts, UsageRow, UsageSession } from '@shared/daemon'
import { shortId } from '@/lib/rooms'

/**
 * What Analytics shows, in one place. Every rule here is Jam Desktop 0.4.10's own, read from its two tabs; where its
 * behaviour could not be seen, the choice says so and `docs/jam/differences.md` carries the row.
 */

/** Jam's range names beside Analytics, in its order. */
export const RANGE_LABELS: Record<DashboardRange, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': '7D',
  '30d': '30D',
  '3m': '3M',
  '6m': '6M',
  '12m': '12M',
}

/** Jam's usage windows, in its own words, over Usage & Cost. */
export const USAGE_WINDOWS = [7, 30, 90] as const
export type UsageWindow = (typeof USAGE_WINDOWS)[number]

/** A number of tokens as Jam writes it: every digit below a thousand, then one decimal with K, M or B. */
export function tokenCount(value: number | undefined): string {
  const n = Number.isFinite(value) ? (value as number) : 0
  if (n < 1000) return String(Math.round(n))
  for (const [suffix, size] of [
    ['B', 1e9],
    ['M', 1e6],
    ['K', 1e3],
  ] as const) {
    if (n >= size) return `${(n / size).toFixed(1)}${suffix}`
  }
  return String(Math.round(n))
}

/**
 * An amount as Jam writes it: whole units with separators from a hundred up ("$6,526"), and to the cent below it
 * ("$8.57", "$0.00"). Where Jam itself turns from one to the other was not seen - it wrote $613 whole and $8.57 to the
 * cent, with nothing between them - so a hundred is this app's own line (`docs/jam/differences.md`).
 */
export function costAmount(value: number | undefined): string {
  const n = Number.isFinite(value) ? (value as number) : 0
  return Math.abs(n) >= 100 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`
}

/** Every token an amount counts: what was sent, what came back, what was written to the cache and what was read. */
export function totalTokens(amounts: UsageAmounts | undefined): number {
  if (!amounts) return 0
  const parts = [
    amounts.inputTokens,
    amounts.outputTokens,
    amounts.cacheCreationTokens,
    amounts.cacheReadTokens,
    amounts.reasoningTokens,
  ]
  return parts.reduce((sum: number, part) => sum + (Number.isFinite(part) ? (part as number) : 0), 0)
}

export interface StatCard {
  label: string
  value: string
  /** The line under the number, where Jam has one. */
  note?: string
  /** The Activity card draws what it counts beside the number. */
  spark?: number[]
  /**
   * Two cells of the strip instead of one. Seven totals leave a short last row in any grid narrow enough to show
   * Jam's names in full; one double cell makes them eight units, which fill four columns and two without a hole.
   * It is set here and not from the card's contents, so a range the daemon sends no sparkline for still fills.
   */
  wide?: true
}

/** Jam shows "Not tracked yet" where it has no measurement; a number it does have is shown even when it is zero. */
function shown(value: number | undefined): string {
  return value === undefined ? 'Not tracked yet' : value.toLocaleString()
}

/**
 * Jam's seven cards over Activity, read from Jam Desktop with an agent's traffic on the account so each could be told
 * from the others: Activity counts everything said, which is what its sparkline draws (113 = 27 sent + 86 received),
 * and Executions counts what came back from the agents. Local and remote agents are not in the dashboard's answer:
 * Jam counts them from the agent list, where an agent that runs on this computer carries a local key.
 */
export function activityCards(
  snapshot: {
    executions?: number
    active_chats?: number
    activity_spark?: number[]
    human_sent?: number
    human_recv?: number
  } | null,
  agents: { local: number; remote: number } | null,
): StatCard[] {
  const sent = snapshot?.human_sent
  const received = snapshot?.human_recv
  const activity = sent === undefined && received === undefined ? undefined : (sent ?? 0) + (received ?? 0)
  return [
    { label: 'Local Agents', value: shown(agents?.local) },
    { label: 'Remote Agents', value: shown(agents?.remote) },
    { label: 'Chat Rooms', value: shown(snapshot?.active_chats) },
    { label: 'Executions', value: shown(snapshot?.executions) },
    // Jam wrote this line under Activity in every state it was read, with and without traffic on the account, so what
    // it says when the average is ready was never seen (`docs/jam/differences.md`). It is the card with the most in
    // it - a sparkline beside the number and a line under the label - so it is the one given the double cell.
    {
      label: 'Activity',
      value: shown(activity),
      note: 'avg / 5h window pending',
      spark: snapshot?.activity_spark,
      wide: true,
    },
    { label: 'You Sent', value: shown(sent) },
    { label: 'You Received', value: shown(received) },
  ]
}

export interface SeriesLine {
  key: string
  name: string
  values: number[]
}

/**
 * A series as its lines: one per name, with that name's value at each point. The daemon gives ids for the agents and
 * none for the message types, so a line with no id is keyed by its own name.
 */
export function seriesLines(series: Series | undefined): SeriesLine[] {
  if (!series) return []
  return series.series.map((name, index) => ({
    key: series.series_keys[index] || name,
    name,
    values: series.points.map((point) => point.values[index] ?? 0),
  }))
}

/** The label under each point of a series, shortened the way a chart writes it. */
export function seriesLabels(series: Series | undefined): string[] {
  return series?.points.map((point) => dayLabel(point.label)) ?? []
}

/** A day under a chart, as Jam writes it: the month and the day, with the year left off ("2026-03-09" is "03-09"). */
export function dayLabel(label: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(label) ? label.slice(5) : label
}

/**
 * The daily rows inside the chosen window, oldest first. The window is counted back from the newest day the daemon
 * reports, not from today, so a gap at the end does not empty the chart; a day with no usage has no row at all.
 */
export function windowRows(rows: readonly UsageRow[], days: UsageWindow): UsageRow[] {
  const dated = rows.filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.period))
  const newest = dated
    .map((row) => row.period)
    .toSorted()
    .at(-1)
  if (!newest) return []
  const from = new Date(`${newest}T00:00:00Z`)
  from.setUTCDate(from.getUTCDate() - (days - 1))
  const first = from.toISOString().slice(0, 10)
  return dated.filter((row) => row.period >= first).toSorted((a, b) => (a.period < b.period ? -1 : 1))
}

export interface ModelTotal {
  key: string
  model: string
  provider: string | null
  input: number
  output: number
  cost: number
  /** The catalogue does not price this model, so it is explained instead of being given an amount. */
  unpriced: boolean
  /** Where the amount came from, in the daemon's own words ("Estimated USD via usage_import"). */
  source: string | null
}

/**
 * Every model the chosen days used, its heaviest spend first. Each column is the sum of the same column of the days'
 * own rows, which is how the daemon's answer is built, so the table adds up to the chart above it.
 */
export function modelTotals(rows: readonly UsageRow[]): ModelTotal[] {
  const totals = new Map<string, ModelTotal>()
  for (const row of rows) {
    for (const model of row.models ?? []) {
      const key = `${model.provider ?? ''}/${model.model}`
      const found = totals.get(key) ?? {
        key,
        model: model.model,
        provider: model.provider ?? null,
        input: 0,
        output: 0,
        cost: 0,
        unpriced: true,
        source: sourceOf(model),
      }
      found.input += model.inputTokens ?? 0
      found.output += model.outputTokens ?? 0
      found.cost += model.cost ?? model.totalCost ?? 0
      // A model is only unpriced when nothing it did was priced: one unpriced day must not hide what the rest cost,
      // which would take that amount out of the table while the total above still counted it.
      found.unpriced = found.unpriced && model.missingPricing === true
      found.source = found.source ?? sourceOf(model)
      totals.set(key, found)
    }
  }
  return [...totals.values()].toSorted((a, b) => b.cost - a.cost || a.model.localeCompare(b.model))
}

/**
 * Where an amount came from, as the daemon says it: the kind of cost, its currency and the source it was imported
 * from. Jam writes a fourth part, "catalog metadata unavailable", on every model; no field of the answer says when it
 * would be absent, so this app leaves it out rather than repeat it blindly (`docs/jam/differences.md`).
 */
function sourceOf(amounts: UsageAmounts): string | null {
  const pricing = amounts.pricing?.[0]
  if (!pricing) return null
  const kind = pricing.costKind === 'estimated_equivalent' ? 'Estimated' : (pricing.costKind ?? null)
  const words = [kind, pricing.currency, pricing.source ? `via ${pricing.source}` : null].filter(Boolean)
  return words.length > 0 ? words.join(' ') : null
}

export type GroupBy = 'agents' | 'rooms'

export interface SessionRow {
  key: string
  name: string
  short: string | null
  sessions: number
  tokens: number
  cost: number
  lastActivity: number | null
}
export interface SessionGroup extends SessionRow {
  /** What Jam names the row carrying what it could not attribute: the row's title, not a line on screen. */
  note: string | null
  children: SessionRow[]
}

const UNATTRIBUTED = '(unattributed)'
/**
 * What Jam calls the row that carries usage it could not attach to an agent. In Jam this is the row's own
 * name, not a line written under it, so it is given to the row as its title rather than put on screen.
 */
export const UNATTRIBUTED_NOTE = 'Usage not linked to a Band agent.'

/** The owner's prefix is dropped from a peer's name, as Jam drops it ("workshop/atlas" is shown as "atlas"). */
export function peerLabel(name: string): string {
  if (name === UNATTRIBUTED) return name
  const last = name.split('/').at(-1)
  return last && last.length > 0 ? last : name
}

function moment(at: string | null | undefined): number | null {
  if (!at) return null
  const ms = Date.parse(at)
  return Number.isFinite(ms) ? ms : null
}

function rowOf(key: string, name: string, short: string | null, list: readonly UsageSession[]): SessionRow {
  return {
    key,
    name,
    short,
    sessions: list.length,
    tokens: list.reduce((sum, one) => sum + totalTokens(one), 0),
    cost: list.reduce((sum, one) => sum + (one.totalCost ?? 0), 0),
    lastActivity: list.reduce<number | null>((latest, one) => {
      const at = moment(one.lastActivity)
      return at !== null && (latest === null || at > latest) ? at : latest
    }, null),
  }
}

/**
 * Full session cost: a row per agent, folding open to the sessions under it, with what the daemon could not attribute
 * on its own row. The agents' own totals are the daemon's, not a sum of the sessions, because it counts sessions it no
 * longer lists one by one. Grouping by room was never seen in Jam, only the control that offers it, so its rows are
 * built from the same sessions and listed as not checked (`docs/jam/differences.md`).
 */
export function sessionGroups(
  sessions: readonly UsageSession[],
  agents: readonly UsageAgent[],
  by: GroupBy,
  roomTitles: Readonly<Record<string, string>>,
): SessionGroup[] {
  const groups: SessionGroup[] = []
  if (by === 'agents') {
    for (const agent of agents) {
      const own = sessions.filter((one) =>
        // A session the daemon attributed to no one, or to no one it can name, belongs on the row for usage with no
        // agent behind it; it must not fall between the rows and be listed under none of them.
        agent.peerName === UNATTRIBUTED ? !one.attribution?.peerName : one.attribution?.peerName === agent.peerName,
      )
      groups.push({
        key: agent.peerName,
        name: peerLabel(agent.peerName),
        short: null,
        sessions: agent.sessionCount ?? own.length,
        tokens: totalTokens(agent),
        cost: agent.totalCost ?? 0,
        lastActivity: moment(agent.lastActivity),
        note: agent.peerName === UNATTRIBUTED ? UNATTRIBUTED_NOTE : null,
        // A session is named by the room it worked in, with the head of its own id beside it, as Jam names it.
        children: own.map((one) => rowOf(one.sessionId, roomOf(one, roomTitles), shortId(one.sessionId), [one])),
      })
    }
    return groups
  }
  const byRoom = new Map<string, UsageSession[]>()
  for (const one of sessions) {
    const room = one.attribution?.chatId ?? ''
    byRoom.set(room, [...(byRoom.get(room) ?? []), one])
  }
  for (const [room, own] of byRoom) {
    const name = room ? roomTitles[room] || shortId(room) : UNATTRIBUTED
    groups.push({
      ...rowOf(room || UNATTRIBUTED, name, null, own),
      note: name === UNATTRIBUTED ? UNATTRIBUTED_NOTE : null,
      children: own.map((one) =>
        rowOf(one.sessionId, peerLabel(one.attribution?.peerName ?? UNATTRIBUTED), shortId(one.sessionId), [one]),
      ),
    })
  }
  return groups.toSorted((a, b) => b.cost - a.cost || a.name.localeCompare(b.name))
}

/**
 * The room a session worked in, by its title. A session whose room is not in the account's list - an archived one,
 * say - is named by the head of that room's id: it has an agent, so calling it unattributed would be untrue.
 */
function roomOf(session: UsageSession, roomTitles: Readonly<Record<string, string>>): string {
  const room = session.attribution?.chatId
  if (!room) return UNATTRIBUTED
  return roomTitles[room] || shortId(room)
}

/**
 * A moment in full, as Jam writes Last activity: the date and the clock together, in this computer's own
 * format. A room's short form would lose the time of day on every row but today's.
 */
export function momentText(ms: number): string {
  return new Date(ms).toLocaleString()
}

/** The total row under Full session cost. */
export function sessionTotal(groups: readonly SessionGroup[]): SessionRow {
  return {
    key: 'total',
    name: 'Total',
    short: null,
    sessions: groups.reduce((sum, group) => sum + group.sessions, 0),
    tokens: groups.reduce((sum, group) => sum + group.tokens, 0),
    cost: groups.reduce((sum, group) => sum + group.cost, 0),
    lastActivity: null,
  }
}
