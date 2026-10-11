import { ChevronRight } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  DASHBOARD_RANGES,
  type Dashboard,
  type DashboardRange,
  type Room,
  type UsageReport,
  type UsageSessions,
} from '@shared/daemon'
import { AreaChart, BarChart, ChartLegend, Sparkline } from '@/components/chart'
import { EmptyCard, Page, PageSection, StatStrip } from '@/components/page'
import { Cell, Table } from '@/components/table'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  activityCards,
  costAmount,
  dayLabel,
  modelTotals,
  momentText,
  RANGE_LABELS,
  seriesLabels,
  seriesLines,
  sessionGroups,
  sessionTotal,
  tokenCount,
  totalTokens,
  USAGE_WINDOWS,
  windowRows,
  type GroupBy,
  type UsageWindow,
} from '@/lib/analytics'
import { unavailableFor, unavailableText } from '@/components/room/unavailable'
import { jam } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { useDaemon, useShellPart } from '@/stores/daemon'
import { useSettings } from '@/stores/settings'

/**
 * Analytics (Jam Desktop 0.4.10, read on 2026-09-20 with traffic on the account so every number could be told from the
 * others) in ZCode's frame: Jam's two tabs and its range control in one row, and Jam's cards under them. The page
 * carries no title of its own, as Jam's does not - the tabs say where you are.
 *
 * Activity reads the daemon's dashboard; Usage & Cost reads the usage report and the sessions. A tab reads when it
 * comes to the front and not before, so opening Analytics does not fetch the other one's answer; both stay mounted
 * afterwards, so moving between them keeps the range, the grouping, the folds that are open and the series hidden.
 */
export function AnalyticsPage() {
  const [tab, setTab] = useState('activity')
  const [range, setRange] = useState<DashboardRange>('7d')
  const [days, setDays] = useState<UsageWindow>(30)
  return (
    <Page>
      <Tabs value={tab} onValueChange={setTab}>
        {/* Jam's row: the two tabs on the left, the range control for the tab in front on the right. */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <TabsList aria-label="Analytics views">
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="usage">Usage &amp; Cost</TabsTrigger>
          </TabsList>
          {tab === 'activity' ? (
            <RangeRow
              label="Range"
              values={DASHBOARD_RANGES}
              chosen={range}
              onChoose={setRange}
              names={(value) => RANGE_LABELS[value]}
            />
          ) : (
            <UsageRow days={days} onChoose={setDays} />
          )}
        </div>
        <ActivityTab active={tab === 'activity'} range={range} />
        <UsageTab active={tab === 'usage'} days={days} />
      </Tabs>
    </Page>
  )
}

/** Jam's usage windows, with the write it offers beside them shown turned off. */
function UsageRow({ days, onChoose }: { days: UsageWindow; onChoose: (value: UsageWindow) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <RangeRow
        label="Usage window"
        values={USAGE_WINDOWS}
        chosen={days}
        onChoose={onChoose}
        names={(value) => `${value}d`}
      />
      {/* Jam offers Reprice estimates here. It writes: it prices what the daemon has recorded again, so it is shown
          turned off until this app makes that write (docs/jam/differences.md). */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button size="sm" variant="outline" disabled>
              Reprice estimates
            </Button>
          }
        />
        <TooltipContent>Repricing is not built yet</TooltipContent>
      </Tooltip>
    </div>
  )
}

/** A row of Jam's own range buttons: one is on, as its toggle buttons are. */
function RangeRow<T extends string | number>({
  label,
  values,
  chosen,
  onChoose,
  names,
}: {
  label: string
  values: readonly T[]
  chosen: T
  onChoose: (value: T) => void
  names: (value: T) => string
}) {
  return (
    <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label={label}>
      {values.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={value === chosen}
          onClick={() => onChoose(value)}
          className={cn(
            'rounded-full px-2.5 py-1 text-ui-sm transition-colors',
            value === chosen
              ? 'bg-primary font-medium text-brand-ink'
              : 'text-foreground-subtle hover:bg-hover hover:text-foreground',
          )}
        >
          {names(value)}
        </button>
      ))}
    </div>
  )
}

function ActivityTab({ active, range }: { active: boolean; range: DashboardRange }) {
  const profile = useSettings((state) => state.settings.profile)
  const connected = useDaemon((state) => state.status.state === 'connected')
  const agents = useShellPart('agents')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    const api = jam()
    if (!api || !connected || !active) return
    let current = true
    api.daemon
      .dashboard({ profile, range })
      .then((data) => {
        if (!current) return
        setDashboard(data)
        setProblem(null)
      })
      .catch((error: unknown) => {
        if (!current) return
        setDashboard(null)
        setProblem(unavailableFor(error, 'Activity'))
      })
    return () => {
      current = false
    }
  }, [profile, range, connected, active])

  // Away from the daemon, or before it has answered, there is nothing to say about what was measured: the tab says
  // so rather than filling its cards with "Not tracked yet", which would claim Jam has taken no measurement.
  // Read from the answer itself, not from a flag an effect sets, so the very first frame says it too
  // rather than painting cards that claim Jam has measured nothing.
  const away = connected
    ? dashboard === null && problem === null
      ? 'Reading what Band has measured…'
      : null
    : unavailableText('Activity', 'offline')
  const counts =
    agents.state === 'ready'
      ? {
          local: agents.data.rows.filter((row) => row.local).length,
          remote: agents.data.rows.filter((row) => !row.local).length,
        }
      : null
  const cards = activityCards(dashboard, counts)
  const perAgent = seriesLines(dashboard?.messages_per_agent)
  const perType = seriesLines(dashboard?.messages_per_type)
  const days = dashboard?.messages_per_day ?? []
  const toggle = (key: string) =>
    setHidden((was) => {
      const next = new Set(was)
      if (!next.delete(key)) next.add(key)
      return next
    })

  return (
    <TabsContent value="activity" className="flex flex-col gap-8">
      {(away ?? problem) ? (
        <p className="text-ui-base text-foreground-subtle">{away ?? problem}</p>
      ) : (
        <StatStrip
          wrap
          stats={cards.map((card) => ({
            label: card.label,
            value: card.value,
            note: card.note,
            wide: card.wide,
            beside: card.spark?.length ? (
              <Sparkline values={card.spark} label={`${card.label} over the range`} />
            ) : null,
          }))}
        />
      )}
      {(away ?? problem) ? null : (
        <div className="grid gap-8 lg:grid-cols-2">
          <PageSection title="Messages per agent">
            <AreaChart
              labels={seriesLabels(dashboard?.messages_per_agent)}
              lines={perAgent}
              hidden={hidden}
              label="Messages per agent, each agent a line over the range"
            />
            <ChartLegend lines={perAgent} hidden={hidden} onToggle={toggle} label="Agents shown" />
          </PageSection>
          <PageSection title="Per message type">
            <BarChart
              labels={seriesLabels(dashboard?.messages_per_type)}
              lines={perType}
              hidden={hidden}
              label="Messages per type, stacked by day over the range"
            />
            <ChartLegend lines={perType} hidden={hidden} onToggle={toggle} label="Message types shown" />
          </PageSection>
          <PageSection title="Messages per day">
            <BarChart
              labels={days.map((day) => dayLabel(day.name))}
              lines={[{ key: 'messages', name: 'Messages', values: days.map((day) => day.value) }]}
              label="Messages per day over the range"
            />
          </PageSection>
          <PerAgentSection rows={dashboard?.per_agent ?? []} />
          {(dashboard?.tool_volume ?? []).length > 0 ? (
            <PageSection title="Top Tools">
              <ul className="flex flex-col rounded-xl border border-line bg-card">
                {(dashboard?.tool_volume ?? []).map((tool) => (
                  <li
                    key={tool.name}
                    className="flex items-center justify-between gap-4 border-t border-line px-4 py-2.5 text-ui-base first:border-t-0"
                  >
                    <span className="truncate text-foreground">{tool.name}</span>
                    <span className="shrink-0 text-foreground-subtle tabular-nums">{tool.value.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </PageSection>
          ) : null}
        </div>
      )}
    </TabsContent>
  )
}

/**
 * Per-agent summary as Jam shows it: with rows, a fold carrying the count and open to begin with; with none, a plain
 * heading over Jam's own empty words, which is how Jam drew it on an account that had measured nothing.
 */
function PerAgentSection({ rows }: { rows: NonNullable<Dashboard['per_agent']> }) {
  const [open, setOpen] = useState(true)
  if (rows.length === 0) {
    return (
      <PageSection title="Per-agent summary">
        <PerAgentSummary rows={rows} />
      </PageSection>
    )
  }
  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex w-full items-center gap-1.5 text-left"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn('size-4 shrink-0 text-foreground-subtlest transition-transform', open && 'rotate-90')}
        />
        <span className="text-ui-lg font-semibold text-foreground">Per-agent summary</span>
        <span className="text-ui-lg text-foreground-subtlest tabular-nums">{rows.length}</span>
      </button>
      {open ? <PerAgentSummary rows={rows} /> : null}
    </section>
  )
}

/** Jam's own empty words when it has measured no local-agent messages yet. */
function PerAgentSummary({ rows }: { rows: NonNullable<Dashboard['per_agent']> }) {
  if (rows.length === 0) return <EmptyCard title="Not tracked yet" description="no local-agent messages tracked yet" />
  return (
    <Table head={['Agent', 'Messages', 'Tool calls', 'Errors']} align="rrr">
      {rows.map((row) => (
        <tr key={row.agent_id ?? row.agent} className="border-t border-line">
          <Cell className="truncate text-foreground">{row.agent}</Cell>
          <Cell number>{(row.messages ?? 0).toLocaleString()}</Cell>
          <Cell number>{(row.tool_calls ?? 0).toLocaleString()}</Cell>
          <Cell number>{(row.errors ?? 0).toLocaleString()}</Cell>
        </tr>
      ))}
    </Table>
  )
}

function UsageTab({ active, days }: { active: boolean; days: UsageWindow }) {
  const connected = useDaemon((state) => state.status.state === 'connected')
  const rooms = useShellPart('rooms')
  const [by, setBy] = useState<GroupBy>('agents')
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [report, setReport] = useState<UsageReport | null>(null)
  const [sessions, setSessions] = useState<UsageSessions | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // Why each half did not arrive, in the words every screen uses for that reason (an answer of an unknown shape is not
  // a failed read).
  const [reportProblem, setReportProblem] = useState<string | null>(null)
  const [sessionsProblem, setSessionsProblem] = useState<string | null>(null)

  useEffect(() => {
    const api = jam()
    if (!api || !connected || !active) return
    let current = true
    // The two answers stand on their own: a daemon that has one and not the other keeps the half it can
    // show, and the tab says why only when neither arrives.
    void Promise.allSettled([api.daemon.usageReport({ kind: 'daily' }), api.daemon.usageSessions()]).then(
      ([usage, session]) => {
        if (!current) return
        setReport(usage.status === 'fulfilled' ? usage.value : null)
        setSessions(session.status === 'fulfilled' ? session.value : null)
        setReportProblem(usage.status === 'rejected' ? unavailableFor(usage.reason, 'Usage & Cost') : null)
        setSessionsProblem(session.status === 'rejected' ? unavailableFor(session.reason, 'Full session cost') : null)
        // Only when neither answer arrives is there nothing to show; one of the two still fills its own half.
        setProblem(
          usage.status === 'rejected' && session.status === 'rejected'
            ? unavailableFor(usage.reason, 'Usage & Cost')
            : null,
        )
      },
    )
    return () => {
      current = false
    }
  }, [connected, active])

  // Read from the answers themselves, so the first frame says it too rather than drawing measured nothings.
  const away = connected
    ? report === null && sessions === null && problem === null
      ? 'Reading what the agents on this computer used…'
      : null
    : unavailableText('Usage & Cost', 'offline')
  // A half that did not answer says so where it would have been, instead of reading as a measured nothing.
  const noReport =
    !away && problem === null && report === null ? (reportProblem ?? unavailableText('Usage & Cost', 'failed')) : null
  const noSessions =
    !away && problem === null && sessions === null
      ? (sessionsProblem ?? unavailableText('Full session cost', 'failed'))
      : null
  const rows = useMemo(() => windowRows(report?.rows ?? [], days), [report, days])
  const models = useMemo(() => modelTotals(rows), [rows])
  const titles = useMemo(
    () =>
      Object.fromEntries((rooms.state === 'ready' ? rooms.data : []).map((room: Room) => [room.id, room.title ?? ''])),
    [rooms],
  )
  const groups = useMemo(
    () => sessionGroups(sessions?.sessions ?? [], sessions?.agents ?? [], by, titles),
    [sessions, by, titles],
  )
  const spend = rows.reduce((sum, row) => sum + (row.totalCost ?? 0), 0)
  const tokens = rows.reduce((sum, row) => sum + totalTokens(row), 0)
  const total = sessionTotal(groups)

  return (
    <TabsContent value="usage" className="flex flex-col gap-8">
      {(away ?? problem) ? (
        <p className="text-ui-base text-foreground-subtle">{away ?? problem}</p>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            <p className="text-ui-base text-foreground-subtle">
              Local coding-agent usage on this machine — last {days} days
            </p>
            {/* The totals come from the report alone: without it, zeros here would say nothing was used, so the two
                parts below say why instead. */}
            {noReport ? null : (
              <>
                <StatStrip
                  stats={[
                    { label: 'Estimated equivalent', value: costAmount(spend) },
                    { label: 'Total tokens', value: tokenCount(tokens) },
                    { label: 'Models', value: String(models.length) },
                  ]}
                />
                <p className="text-ui-sm text-foreground-subtlest">
                  Catalog estimate only — not a provider invoice or subscription charge.
                </p>
              </>
            )}
          </div>
          <PageSection title="Estimated equivalent per day">
            {noReport ? (
              <EmptyCard title="Unavailable" description={noReport} />
            ) : (
              <BarChart
                labels={rows.map((row) => dayLabel(row.period))}
                lines={[{ key: 'cost', name: 'Estimated equivalent', values: rows.map((row) => row.totalCost ?? 0) }]}
                label={`Estimated equivalent per day over the last ${days} days`}
              />
            )}
          </PageSection>
          <PageSection title="Estimated equivalent per model">
            {noReport ? (
              <EmptyCard title="Unavailable" description={noReport} />
            ) : models.length === 0 ? (
              <EmptyCard title="Not tracked yet" description="no local-agent usage tracked yet" />
            ) : (
              <Table head={['Model', 'Input', 'Output', 'Estimate']} align="rrr">
                {models.map((model) => (
                  <tr key={model.key} className="border-t border-line align-top">
                    <Cell>
                      <span className="flex flex-wrap items-baseline gap-2">
                        <span className="font-medium text-foreground">{model.model}</span>
                        {model.provider ? (
                          <span className="text-ui-sm text-foreground-subtlest">{model.provider}</span>
                        ) : null}
                      </span>
                      {model.source ? (
                        <span className="mt-0.5 block text-ui-sm text-foreground-subtlest">{model.source}</span>
                      ) : null}
                    </Cell>
                    <Cell number>{tokenCount(model.input)}</Cell>
                    <Cell number>{tokenCount(model.output)}</Cell>
                    <Cell number>
                      {model.unpriced ? (
                        <span className="text-foreground-subtlest">Unpriced</span>
                      ) : (
                        costAmount(model.cost)
                      )}
                    </Cell>
                  </tr>
                ))}
              </Table>
            )}
          </PageSection>
          <PageSection
            title="Full session cost"
            note="Catalog estimate only — not a provider invoice or subscription charge."
            actions={
              <RangeRow
                label="Group by"
                values={['agents', 'rooms'] as const}
                chosen={by}
                onChoose={setBy}
                names={(value) => (value === 'agents' ? 'Agents' : 'Rooms')}
              />
            }
          >
            {/* Without the sessions there is nothing to tabulate, and an empty table would read as "no sessions". */}
            {noSessions ? <EmptyCard title="Unavailable" description={noSessions} /> : null}
            <Table
              head={[by === 'agents' ? 'Agent' : 'Room', 'Sessions', 'Tokens', 'Estimate', 'Last activity']}
              align="rrrl"
              label="Full session cost"
              hidden={noSessions !== null}
            >
              {groups.map((group) => (
                <Fragment key={group.key}>
                  <tr className="border-t border-line" title={group.note ?? undefined}>
                    <Cell>
                      <button
                        type="button"
                        aria-expanded={open.has(group.key)}
                        onClick={() =>
                          setOpen((was) => {
                            const next = new Set(was)
                            if (!next.delete(group.key)) next.add(group.key)
                            return next
                          })
                        }
                        className="-my-0.5 flex w-full items-center gap-1.5 rounded-md py-0.5 text-left text-foreground transition-colors hover:text-foreground"
                        disabled={group.children.length === 0}
                      >
                        <ChevronRight
                          aria-hidden="true"
                          className={cn(
                            'size-3.5 shrink-0 text-foreground-subtlest transition-transform',
                            open.has(group.key) && 'rotate-90',
                            group.children.length === 0 && 'invisible',
                          )}
                        />
                        <span className="truncate font-medium">{group.name}</span>
                      </button>
                    </Cell>
                    <Cell number>{group.sessions.toLocaleString()}</Cell>
                    <Cell number>{tokenCount(group.tokens)}</Cell>
                    <Cell number>{costAmount(group.cost)}</Cell>
                    <Cell className="text-foreground-subtle">
                      {group.lastActivity === null ? '' : momentText(group.lastActivity)}
                    </Cell>
                  </tr>
                  {open.has(group.key)
                    ? group.children.map((child) => (
                        <tr key={`${group.key}/${child.key}`} className="border-t border-line bg-surface">
                          <Cell className="pl-9">
                            <span className="flex flex-wrap items-baseline gap-2">
                              <span className="truncate text-foreground-subtle">{child.name}</span>
                              {child.short ? (
                                <span className="text-ui-sm text-foreground-subtlest">{child.short}</span>
                              ) : null}
                            </span>
                          </Cell>
                          <Cell number>{child.sessions.toLocaleString()}</Cell>
                          <Cell number>{tokenCount(child.tokens)}</Cell>
                          <Cell number>{costAmount(child.cost)}</Cell>
                          <Cell className="text-foreground-subtle">
                            {child.lastActivity === null ? '' : momentText(child.lastActivity)}
                          </Cell>
                        </tr>
                      ))
                    : null}
                </Fragment>
              ))}
              <tr className="border-t border-line-strong">
                <Cell className="font-medium text-foreground">{total.name}</Cell>
                <Cell number>{total.sessions.toLocaleString()}</Cell>
                <Cell number>{tokenCount(total.tokens)}</Cell>
                <Cell number>{costAmount(total.cost)}</Cell>
                <Cell />
              </tr>
            </Table>
          </PageSection>
        </>
      )}
    </TabsContent>
  )
}
