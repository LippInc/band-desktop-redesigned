import { ArrowUpDown, ChevronRight, Mail } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Discovered } from '@shared/daemon'
import { CopyHandle } from '@/components/copy-handle'
import { EmptyCard, Page } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { unavailableFor, unavailableText } from '@/components/room/unavailable'
import { jam } from '@/lib/platform'
import { initialsOf } from '@/lib/rooms'
import { sectionById } from '@/lib/sections'
import {
  agentsLine,
  discoveryProblem,
  filterPeople,
  peopleUnread,
  personRows,
  SONAR_FILTERS,
  sortPeople,
  type PersonRow,
  type SonarFilter,
} from '@/lib/sonar'
import { cn } from '@/lib/utils'
import { useDaemon } from '@/stores/daemon'

/**
 * Sonar (Jam Desktop 0.4.10, read 2026-09-20) in ZCode's frame: Jam's title with Invite by email and its
 * Discoverable switch, its People and Teams tabs with their counts, its search of the directory, its four filters
 * and its Online first order, then a card per person that folds open onto the agents they advertise.
 *
 * One person was on the network when Jam was read - this computer's own account - so a user's fields and an agent's
 * are known from the daemon's own answer. What Jam draws for a second person, what its Teams tab holds and what its
 * order menu offers were not seen (`docs/jam/differences.md`).
 */
export function SonarPage() {
  const section = sectionById('sonar')
  const connected = useDaemon((state) => state.status.state === 'connected')
  const revision = useDaemon((state) => state.revision)
  const [snapshot, setSnapshot] = useState<Discovered | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [filter, setFilter] = useState<SonarFilter>('All')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    const api = jam()
    if (!api || !connected) return
    let current = true
    api.daemon
      .discovered()
      .then((data) => {
        if (!current) return
        setSnapshot(data)
        setProblem(null)
      })
      .catch((error: unknown) => {
        if (!current) return
        setSnapshot(null)
        setProblem(unavailableFor(error, 'Sonar'))
      })
    return () => {
      current = false
    }
  }, [connected, revision])

  const rows = useMemo(() => personRows(snapshot?.users ?? []), [snapshot])
  const shown = useMemo(() => sortPeople(filterPeople(rows, filter, query)), [rows, filter, query])
  // Memberships, not teams: a team's own fields have never been recorded, so two people who share one cannot
  // be told to be sharing the same one (`docs/jam/differences.md`).
  const memberships = rows.reduce((sum, row) => sum + row.teams, 0)
  const unread = peopleUnread(snapshot)
  const away = connected
    ? snapshot === null && problem === null
      ? 'Reading who is on this network…'
      : null
    : unavailableText('Sonar', 'offline')
  const note = away ?? problem
  const discovery = discoveryProblem(snapshot)
  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was)
      if (!next.delete(key)) next.add(key)
      return next
    })

  return (
    <Page
      title={section.label}
      actions={
        note ? null : (
          <div className="flex items-center gap-3">
            {/* Jam's own invitation text was never seen, and sending one leaves the app, so it waits for that text. */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button size="sm" variant="outline" disabled>
                    <Mail />
                    Invite by email
                  </Button>
                }
              />
              <TooltipContent>Inviting by email is not built yet</TooltipContent>
            </Tooltip>
            {/* Turning discovery on or off changes the daemon's own setting, which this app does not write. */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <div className="flex items-center gap-2 text-ui-base text-foreground-subtle">
                    <span>Discoverable</span>
                    <Switch aria-label="Discoverable" checked={snapshot?.discoverable === true} disabled />
                  </div>
                }
              />
              <TooltipContent>Changing this stays in the official app</TooltipContent>
            </Tooltip>
          </div>
        )
      }
    >
      {note ? (
        <p className="text-ui-base text-foreground-subtle">{note}</p>
      ) : (
        <Tabs defaultValue="people" className="flex flex-col gap-4">
          <TabsList aria-label="Sonar views">
            <TabsTrigger value="people">
              People <Count>{rows.length}</Count>
            </TabsTrigger>
            <TabsTrigger value="teams">
              Teams <Count>{memberships}</Count>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="people" className="flex flex-col gap-3">
            {discovery ? <p className="text-ui-base text-foreground-subtle">{discovery}</p> : null}
            {/* People the answer held that this app could not read are counted, never quietly dropped. */}
            {unread > 0 ? (
              <p className="text-ui-sm text-foreground-subtlest">
                {unread} {unread === 1 ? 'person is' : 'people are'} on this network in a form this app does not know
                yet, so they are not listed below.
              </p>
            ) : null}
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the directory…"
              aria-label="Search the directory"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Filter people">
                {SONAR_FILTERS.map((one) =>
                  one === 'My org' ? (
                    <Tooltip key={one}>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            disabled
                            className="rounded-full px-2.5 py-1 text-ui-sm text-foreground-subtlest"
                          >
                            {one}
                          </button>
                        }
                      />
                      <TooltipContent>
                        The answer says nothing about which people share your organisation
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <button
                      key={one}
                      type="button"
                      aria-pressed={one === filter}
                      onClick={() => setFilter(one)}
                      className={cn(
                        'rounded-full px-2.5 py-1 text-ui-sm transition-colors',
                        one === filter
                          ? 'bg-primary font-medium text-brand-ink'
                          : 'text-foreground-subtle hover:bg-hover hover:text-foreground',
                      )}
                    >
                      {one}
                    </button>
                  ),
                )}
              </div>
              {/* Jam's order control is a menu whose other choices were never seen; this says the order in force. */}
              <span className="flex items-center gap-1.5 text-ui-sm text-foreground-subtle">
                <ArrowUpDown className="size-3.5" aria-hidden />
                Online first
              </span>
            </div>
            {shown.length === 0 ? (
              <EmptyCard
                title={
                  rows.length > 0
                    ? 'No one here matches that.'
                    : unread > 0
                      ? 'No one on this network can be shown yet.'
                      : 'No one nearby yet.'
                }
                description={
                  rows.length > 0
                    ? undefined
                    : unread > 0
                      ? 'Band answered about people in a form this app does not know yet.'
                      : 'Both devices need to be on the same network with Discoverable on.'
                }
              />
            ) : (
              <ul className="flex flex-col gap-2" aria-label="People">
                {shown.map((row) => (
                  <Person key={row.key} row={row} open={open.has(row.key)} onToggle={() => toggle(row.key)} />
                ))}
              </ul>
            )}
          </TabsContent>
          <TabsContent value="teams">
            {/* Jam's Teams pane was never opened, so its own words are unknown and none are put in its mouth. */}
            <EmptyCard
              title={
                memberships === 0
                  ? 'No shared team on this network.'
                  : `${memberships} shared team ${memberships === 1 ? 'membership' : 'memberships'} reported.`
              }
              description={
                memberships === 0
                  ? 'The guide says teams group agents that share visible rooms.'
                  : "A team's own details are not in this answer, so the teams themselves cannot be listed yet."
              }
            />
          </TabsContent>
        </Tabs>
      )}
    </Page>
  )
}

/** Jam's count beside a tab's name. */
function Count({ children }: { children: number }) {
  return (
    <span className="ml-1.5 rounded-full bg-strip px-1.5 text-ui-xs text-foreground-subtle tabular-nums">
      {children}
    </span>
  )
}

/**
 * One person Jam found: their initials with the dot it puts on an online one, their name over their handle and what
 * they advertise, and the origins the daemon reported. Jam's own row opens the person; this one folds open onto the
 * agents they advertise, which is what the answer carries about them (`docs/jam/differences.md`).
 */
function Person({ row, open, onToggle }: { row: PersonRow; open: boolean; onToggle: () => void }) {
  return (
    <li className="overflow-hidden rounded-xl border border-line bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-hover"
      >
        <span className="relative shrink-0">
          <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-ui-sm font-medium text-foreground">
            {initialsOf(row.name)}
          </span>
          {row.online ? (
            <span
              aria-hidden
              className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card bg-primary"
            />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span data-slot="person-name" className="truncate font-medium text-foreground">
            {row.name}
          </span>
          <span className="truncate text-ui-sm text-foreground-subtle">
            {row.handle ? <span className="font-mono">@{row.handle}</span> : null}
            {row.handle ? ' · ' : null}
            {agentsLine(row)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {row.origins.map((origin) => (
            <span
              key={origin}
              className="rounded-md border border-line px-1.5 py-0.5 text-ui-xs tracking-wide text-foreground-subtle uppercase"
            >
              {origin}
            </span>
          ))}
          <ChevronRight
            aria-hidden
            className={cn('size-4 text-foreground-subtle transition-transform', open && 'rotate-90')}
          />
        </span>
      </button>
      {open ? (
        <ul
          className="flex flex-col gap-2 border-t border-line bg-surface px-3 py-2.5"
          aria-label={`${row.name}'s agents`}
        >
          {/* The guide lists shared-team membership among what a person's own view holds, so it is here too. */}
          <li className="text-ui-sm text-foreground-subtlest">
            {row.teams === 0 ? 'No shared team' : `${row.teams} shared ${row.teams === 1 ? 'team' : 'teams'} reported`}
          </li>
          {row.agents.length === 0 ? <li className="text-ui-sm text-foreground-subtle">{agentsLine(row)}</li> : null}
          {row.agents.map((agent) => (
            <li
              key={agent.key}
              data-slot="advertised-agent"
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-ui-sm"
            >
              <span className="font-medium text-foreground">{agent.name}</span>
              {agent.handle ? (
                <span className="flex items-baseline gap-1">
                  <span className="font-mono text-foreground-subtle">@{agent.handle}</span>
                  {/* Jam's Copy handle: its guide makes this step 3 of reaching a nearby person, before Contacts. */}
                  <CopyHandle handle={agent.handle} />
                </span>
              ) : null}
              <span className="flex items-center gap-1.5 text-foreground-subtle">
                <span
                  aria-hidden
                  className={cn('size-2 rounded-full', agent.connected ? 'bg-primary' : 'bg-foreground-subtlest')}
                />
                {agent.state}
              </span>
              {agent.activity ? <span className="text-foreground-subtle">{agent.activity}</span> : null}
              {agent.tasks ? (
                <span className="text-foreground-subtlest tabular-nums">
                  {agent.tasks.pending} pending · {agent.tasks.inProgress} in progress · {agent.tasks.completed} done
                </span>
              ) : null}
              {agent.cost === null ? null : (
                <span className="text-foreground-subtlest tabular-nums">${agent.cost.toFixed(2)}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}
