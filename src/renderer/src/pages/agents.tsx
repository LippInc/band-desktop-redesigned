import { ArrowLeft, ChevronDown, Folder, Plus, Search } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import type { AgentRow, AgentSession, AgentStatus, RuntimePermission } from '@shared/daemon'
import { ComingNote, EmptyCard, Page, SettingsCard, SettingsRow } from '@/components/page'
import { Initials } from '@/components/room/chat'
import { unavailableFor, unavailableText } from '@/components/room/unavailable'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AGENT_FILTERS,
  AGENT_TABS,
  agentRooms,
  agentWork,
  filterOptions,
  infoLines,
  optionCount,
  passesFilters,
  permissionRows,
  providerName,
  runtimeLines,
  type AgentFilters,
  type AgentReads,
  type AgentTab,
} from '@/lib/agents'
import { jam } from '@/lib/platform'
import { sectionById } from '@/lib/sections'
import { cn } from '@/lib/utils'
import { useDaemon, useShellPart } from '@/stores/daemon'
import { useSettings } from '@/stores/settings'
import { agentTargetOf } from '@/stores/room'

/**
 * Agents (user guide, "Agents"; Jam Desktop's own words) in the Marketplace's frame: search, filters as pills, New Jam
 * Agent as the filled button, and the agents below: Jam Desktop 0.4.10 lists the agents that run on this computer under
 * "Jam Hosted" with their count, each card with its name, handle, provider, live and total sessions, rooms, a mark
 * when it is connected and Jam's icon for an agent that reaches this machine's files. Its message, tool call and error
 * counts come from Analytics, which this app does not read yet.
 */
export function AgentsPage() {
  const section = sectionById('agents')
  const agents = useShellPart('agents')
  const rows = agents.state === 'ready' ? agents.data.rows : []
  const count = agents.state === 'ready' ? rows.length : null
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<AgentFilters>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const reads = useAgentReads(rows)
  const needle = query.trim().toLowerCase()
  const found = needle
    ? rows.filter((row) => [row.name, row.handle].some((text) => text?.toLowerCase().includes(needle)))
    : rows
  const shown = found.filter((row) => passesFilters(row, reads[row.local?.peer_key ?? '']?.status, filters))
  const hosted = shown.filter((row) => row.local)
  const elsewhere = shown.filter((row) => !row.local)
  const open = openId ? (rows.find((row) => row.id === openId) ?? null) : null

  if (open) {
    return <AgentDetail row={open} reads={reads} onBack={() => setOpenId(null)} />
  }

  return (
    <Page
      wide
      title={section.label}
      actions={
        // Jam Desktop 0.4.10 shows "New agent", named "New Jam Agent", and no Manage beside it (with agents or without).
        <Button disabled aria-label="New agent">
          <Plus />
          New agent
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-subtle" />
          <input
            type="search"
            placeholder="Search agents…"
            aria-label="Search agents"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 w-full rounded-xl border border-line bg-input py-1.5 pr-3 pl-9 text-ui-base text-foreground outline-none select-text placeholder:text-foreground-subtlest hover:border-line-strong focus:border-line-strong"
          />
        </label>
        <div className="flex items-center gap-1.5">
          {AGENT_FILTERS.map((filter) => {
            const options = filterOptions(filter)
            const chosen = filters[filter] ?? []
            const set = (value: string, on: boolean) =>
              setFilters({
                ...filters,
                [filter]: on ? [...chosen, value] : chosen.filter((one) => one !== value),
              })
            return (
              <Popover key={filter}>
                {/* A plain Button, not IconButton: that one is already a tooltip trigger and two triggers cannot
                    share one element. */}
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn('rounded-full px-3', chosen.length > 0 && 'text-brand-text')}
                      aria-label={chosen.length > 0 ? `${filter}: ${chosen.join(', ')}` : filter}
                    >
                      {chosen.length > 0 ? `${filter} (${chosen.length})` : filter}
                      <ChevronDown className="text-foreground-subtle" />
                    </Button>
                  }
                />
                <PopoverContent align="start" className="w-64 p-2">
                  <ul className="flex flex-col">
                    {options.map((option) => (
                      <li key={option}>
                        <Checkbox
                          checked={chosen.includes(option)}
                          onCheckedChange={(on) => set(option, on === true)}
                          className="w-full rounded-lg px-1 py-1.5 hover:bg-hover"
                        >
                          <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
                            <span className="truncate text-ui-base text-foreground">{option}</span>
                            {/* What the value would leave, counted against the other filters and the search. A 0
                                stays selectable: it is how a selection that has become too narrow is widened. */}
                            <span className="shrink-0 text-ui-sm text-foreground-subtle tabular-nums">
                              {optionCount(found, reads, filters, filter, option)}
                            </span>
                          </span>
                        </Checkbox>
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )
          })}
        </div>
      </div>
      {count ? (
        <>
          {hosted.length ? <AgentGroup title="Band Hosted" rows={hosted} reads={reads} onOpen={setOpenId} /> : null}
          {elsewhere.length ? <AgentGroup title="Elsewhere" rows={elsewhere} reads={reads} onOpen={setOpenId} /> : null}
          {shown.length === 0 ? <p className="text-ui-base text-foreground-subtle">No agents match.</p> : null}
        </>
      ) : (
        <EmptyCard
          title={
            count === 0
              ? 'No agents yet. Create one to see it here.'
              : agents.state === 'unavailable'
                ? 'Agents are unavailable right now.'
                : 'Loading agents…'
          }
          // Why, under it, as a room's card says it for its rooms and its work, in the words every screen shares.
          description={agents.state === 'unavailable' ? unavailableText('Agents', agents.reason) : undefined}
        />
      )}
      {/* What is still Jam's and not here: creating an agent, and the three of its detail tabs this app has no
          recorded read for (docs/jam/differences.md). */}
      <ComingNote>Creating an agent, and its Contacts, Errors and Activity, are not here yet.</ComingNote>
    </Page>
  )
}

/**
 * How often an agent's own two reads are made again while its screen is open. The shell reads again on every event in
 * the stream, which in a busy room is several a second; an agent's sessions and its runtime settle far more slowly
 * than that, so this screen keeps Sessions' own clock instead of following the stream.
 */
const AGENT_READ_MS = 45_000

/** Each local agent's own two reads - its sessions and its status - made when the list changes, then on that clock. */
function useAgentReads(rows: readonly AgentRow[]): AgentReads {
  const connected = useDaemon((state) => state.status.state === 'connected')
  const [reads, setReads] = useState<AgentReads>({})
  const keys = rows.map((row) => row.local?.peer_key ?? '').join(' ')
  useEffect(() => {
    const api = jam()
    if (!api || !connected) return
    let current = true
    const read = () =>
      void Promise.all(
        rows.flatMap((row) => {
          const target = agentTargetOf(row)
          const key = row.local?.peer_key
          if (!target || !key) return []
          return [
            Promise.all([
              api.daemon.agentSessions(target).catch(() => undefined),
              api.daemon.agentStatus(target).catch(() => undefined),
            ]).then(([sessions, status]) => [key, { sessions, status }] as const),
          ]
        }),
      ).then((entries) => {
        if (current) setReads(Object.fromEntries(entries))
      })
    read()
    const timer = setInterval(read, AGENT_READ_MS)
    return () => {
      current = false
      clearInterval(timer)
    }
    // oxlint-disable-next-line react/exhaustive-deps -- read again when the agents change, and on the clock above
  }, [keys, connected])
  return reads
}

function AgentGroup({
  title,
  rows,
  reads,
  onOpen,
}: {
  title: string
  rows: readonly AgentRow[]
  reads: AgentReads
  onOpen(id: string): void
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="flex items-center text-ui-base font-medium text-foreground">
        {title}
        <span className="ml-auto text-ui-sm text-foreground-subtle tabular-nums">{rows.length}</span>
      </h2>
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {rows.map((row) => (
          <AgentCard
            key={row.id}
            row={row}
            sessions={row.local ? reads[row.local.peer_key]?.sessions : undefined}
            onOpen={() => onOpen(row.id)}
          />
        ))}
      </ul>
    </section>
  )
}

function AgentCard({ row, sessions, onOpen }: { row: AgentRow; sessions: AgentSession[] | undefined; onOpen(): void }) {
  const name = row.name || row.handle || 'Agent'
  const provider = providerName(row.local?.host)
  const live = sessions?.filter((session) => session.presence === 'live').length ?? 0
  const rooms = sessions?.filter((session) => session.room).length ?? 0
  return (
    <li aria-label={name}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${name}`}
        className="flex w-full flex-col gap-3 rounded-xl border border-line bg-card p-4 text-left transition-colors outline-none hover:border-line-strong"
      >
        <div className="flex items-center gap-3">
          <Initials name={name} className="size-10 rounded-lg text-ui-sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-ui-base font-semibold text-foreground">{name}</div>
            {row.handle ? (
              <div className="truncate font-mono text-ui-sm text-foreground-subtle">{row.handle}</div>
            ) : null}
          </div>
          {/* Jam Desktop marks a connected agent at the card's top right; the mark itself is this app's own dot. */}
          {live > 0 ? <span role="img" aria-label="Connected" className="size-2 rounded-full bg-success" /> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-ui-sm text-foreground-subtle">
          {provider ? (
            <span className="rounded-full border border-line px-2 leading-5 text-foreground">{provider}</span>
          ) : null}
          {sessions ? (
            <>
              <span>
                {live}/{sessions.length} sessions
              </span>
              <span>{rooms === 1 ? '1 room' : `${rooms} rooms`}</span>
              {/* Jam's own icon after the rooms, for an agent that reaches this machine's files. Jam names the folder it
                works in; this app says only that it has the access, and keeps the path off the page. */}
              <Folder role="img" aria-label="Can read and write this machine's files" className="size-4" />
            </>
          ) : null}
        </div>
      </button>
    </li>
  )
}

/** A settings card with Jam's tab name over it, which is how the detail's tabs draw their content. */
function CardTitled({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-ui-base font-medium text-foreground">{title}</h2>
      <SettingsCard>{children}</SettingsCard>
    </section>
  )
}

/**
 * One agent in full (user guide, "Read agent details"). Jam's tabs are Overview, Sessions, Permissions, Runtime,
 * Rooms, Contacts, Errors, Work, Activity and Info; the seven here are the ones this app has a recorded read behind.
 * The three it leaves out, and why, are in `docs/jam/differences.md`: nothing is shown turned off and nothing invented.
 */
function AgentDetail({ row, reads, onBack }: { row: AgentRow; reads: AgentReads; onBack(): void }) {
  const sessions = reads[row.local?.peer_key ?? '']?.sessions
  const profile = useSettings((state) => state.settings.profile)
  const revision = useDaemon((state) => state.revision)
  const rooms = useShellPart('rooms')
  const work = useShellPart('work')
  const people = useDaemon((state) => state.roomPeople)
  const [tab, setTab] = useState<AgentTab>('Overview')
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const name = row.name || row.handle || 'Agent'

  useEffect(() => {
    const api = jam()
    const target = agentTargetOf(row)
    if (!api || !target) return
    let current = true
    api.daemon
      .agentStatus(target)
      .then((answer) => {
        if (!current) return
        setStatus(answer)
        setProblem(null)
      })
      .catch((error: unknown) => {
        if (!current) return
        setStatus(null)
        setProblem(unavailableFor(error, 'This agent'))
      })
    return () => {
      current = false
    }
    // oxlint-disable-next-line react/exhaustive-deps -- read again when the shell's reads change
  }, [row.id, profile, revision])

  /**
   * Every permission this agent's sessions have asked for, read only once the tab is opened: it is one call per
   * session, and nobody who never opens the tab should pay for them.
   */
  const [permissions, setPermissions] = useState<RuntimePermission[] | null>(null)
  const [permissionProblem, setPermissionProblem] = useState<string | null>(null)
  const sessionIds = (sessions ?? []).map((session) => session.id).join(' ')
  useEffect(() => {
    const api = jam()
    const target = agentTargetOf(row)
    if (tab !== 'Permissions' || !api || !target || sessionIds === '') return
    let current = true
    Promise.all(
      sessionIds
        .split(' ')
        .map((hostSession) =>
          api.daemon.runtimePermissions({ ...target, hostSession }).catch(() => null as RuntimePermission[] | null),
        ),
    ).then((answers) => {
      if (!current) return
      const read = answers.filter((one): one is RuntimePermission[] => one !== null)
      setPermissions(read.flat())
      // Every session refusing is the only case worth saying anything about: one that does is simply not counted.
      setPermissionProblem(read.length === 0 ? 'This agent’s permissions are unavailable.' : null)
    })
    return () => {
      current = false
    }
  }, [tab, row.id, profile, sessionIds, revision])

  const roomList = rooms.state === 'ready' ? rooms.data : []
  const its = agentRooms(row, roomList, people)
  const open = agentWork(row, work.state === 'ready' ? work.data : null, roomList)
  const live = sessions?.filter((session) => session.presence === 'live').length ?? 0

  return (
    <Page
      wide
      title={name}
      actions={
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft />
          Agents
        </Button>
      }
    >
      <Tabs value={tab} onValueChange={(value) => setTab(value as AgentTab)}>
        <TabsList>
          {AGENT_TABS.map((one) => (
            <TabsTrigger key={one} value={one}>
              {one}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === 'Overview' ? (
        <CardTitled title="Overview">
          <SettingsRow label="Handle" description={row.handle ?? undefined}>
            <span className="text-ui-base text-foreground-subtle">{providerName(row.local?.host) ?? '—'}</span>
          </SettingsRow>
          <SettingsRow label="Sessions" description="Live now, of all this agent has here">
            <span className="text-ui-base text-foreground-subtle tabular-nums">
              {live}/{sessions?.length ?? 0}
            </span>
          </SettingsRow>
          <SettingsRow label="Rooms" description="Rooms whose participants have been read">
            <span className="text-ui-base text-foreground-subtle tabular-nums">{its.length}</span>
          </SettingsRow>
          <SettingsRow label="Connection" description={status?.warning || undefined}>
            <span className="text-ui-base text-foreground-subtle">
              {problem ? problem : status ? (status.running === false ? 'Not running' : (status.state ?? '—')) : '…'}
            </span>
          </SettingsRow>
          {row.description ? (
            <SettingsRow label="Description">
              <span className="text-ui-base text-foreground-subtle">{row.description}</span>
            </SettingsRow>
          ) : null}
        </CardTitled>
      ) : null}

      {tab === 'Sessions' ? (
        <CardTitled title="Sessions">
          {(sessions ?? []).length === 0 ? (
            <SettingsRow label="No active sessions yet" />
          ) : (
            (sessions ?? []).map((session) => (
              <SettingsRow
                key={session.id}
                label={
                  session.room
                    ? (roomList.find((one) => one.id === session.room)?.title ?? 'A room')
                    : 'Parked template'
                }
                description={`${session.presence ?? 'unknown'} · ${session.binding ?? '—'}`}
              >
                <span className="text-ui-base text-foreground-subtle">{session.provider ?? '—'}</span>
              </SettingsRow>
            ))
          )}
        </CardTitled>
      ) : null}

      {tab === 'Permissions' ? (
        <CardTitled title="Permissions">
          {permissions === null ? (
            <SettingsRow label={permissionProblem ?? 'Reading this agent’s permissions…'} />
          ) : permissions.length === 0 ? (
            <SettingsRow label="No permission has been asked for yet" />
          ) : (
            permissionRows(permissions, roomList).map((one) => (
              <SettingsRow
                key={one.id}
                label={one.description ?? one.action}
                description={[one.action, one.roomTitle].filter(Boolean).join(' · ')}
              >
                <span className="text-ui-base text-foreground-subtle">{one.state}</span>
              </SettingsRow>
            ))
          )}
        </CardTitled>
      ) : null}

      {tab === 'Runtime' ? (
        status === null ? (
          <EmptyCard title={problem ?? 'Reading this agent’s runtime…'} />
        ) : status.runtimes.length === 0 ? (
          <EmptyCard title="This agent has no runtime on this computer." />
        ) : (
          status.runtimes.map((entry) => (
            <CardTitled
              key={entry.session}
              title={
                entry.room ? (roomList.find((one) => one.id === entry.room)?.title ?? 'A room') : 'Parked template'
              }
            >
              {runtimeLines(entry.runtime).map((line) => (
                <SettingsRow key={line.label} label={line.label}>
                  <span className="text-ui-base text-foreground-subtle">{line.value}</span>
                </SettingsRow>
              ))}
            </CardTitled>
          ))
        )
      ) : null}

      {tab === 'Rooms' ? (
        <CardTitled title="Rooms">
          {its.length === 0 ? (
            <SettingsRow
              label="No rooms yet"
              description="Rooms this agent is in appear here once they have been read."
            />
          ) : (
            its.map((room) => (
              <SettingsRow key={room.id} label={room.title}>
                <Link
                  to="/rooms/$roomId"
                  params={{ roomId: room.id }}
                  className="text-ui-base text-brand-text underline-offset-2 hover:underline"
                >
                  Open
                </Link>
              </SettingsRow>
            ))
          )}
        </CardTitled>
      ) : null}

      {tab === 'Work' ? (
        <CardTitled title="Work">
          {open.length === 0 ? (
            <SettingsRow label="No work yet" description="Tasks in this agent’s own lane appear here." />
          ) : (
            open.map((entry) => (
              <SettingsRow
                key={entry.roomId}
                label={entry.roomTitle}
                description={`${entry.open} open · ${entry.done} done`}
              >
                <Link
                  to="/rooms/$roomId"
                  params={{ roomId: entry.roomId }}
                  search={{ view: 'work' }}
                  className="text-ui-base text-brand-text underline-offset-2 hover:underline"
                >
                  Open
                </Link>
              </SettingsRow>
            ))
          )}
        </CardTitled>
      ) : null}

      {tab === 'Info' ? (
        <CardTitled title="Info">
          {infoLines(row, status).map((line) => (
            <SettingsRow key={line.label} label={line.label}>
              <span className="truncate font-mono text-ui-sm text-foreground-subtle">{line.value}</span>
            </SettingsRow>
          ))}
        </CardTitled>
      ) : null}
    </Page>
  )
}
