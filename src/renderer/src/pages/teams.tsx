import { ArrowLeft, Check, Plus, Search } from 'lucide-react'
import { useId, useState } from 'react'
import { TEAM_LIMITS, type AgentRow, type Team, type TeamDraft } from '@shared/daemon'
import { CopyHandle } from '@/components/copy-handle'
import { ComingNote, EmptyCard, Page, PageSection, SettingsCard } from '@/components/page'
import { Initials } from '@/components/room/chat'
import { unavailableText } from '@/components/room/unavailable'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { providerName } from '@/lib/agents'
import { daemonErrorText } from '@/lib/daemon-error'
import { jam } from '@/lib/platform'
import { sectionById } from '@/lib/sections'
import { draftOf, draftProblem, emptyDraft, matchesTeam, memberName, rosterLine, teamMembers } from '@/lib/teams'
import { useDaemon, useShellPart } from '@/stores/daemon'
import { useSettings } from '@/stores/settings'

/**
 * Teams (Band Desktop 0.4.14; user guide, "Teams"): the account's teams in the Marketplace's frame, as Agents is - Band's
 * Browse Library and New team at the top right, Search teams under the title, and a card per team with its name, its
 * description, its agents and whether they are all on the account's roster. A card opens the team: its members and its
 * guidelines, with Edit team. Band's Library of ready-made teams is read from Band's servers, which this app never calls,
 * so Browse Library stays in the official app.
 */
export function TeamsPage() {
  const section = sectionById('teams')
  const teams = useShellPart('teams')
  const agents = useShellPart('agents')
  const rows = agents.state === 'ready' ? agents.data.rows : []
  const list = teams.state === 'ready' ? teams.data : []
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  // The team being written: a new one (null) or one being edited; undefined while the form is closed.
  const [editing, setEditing] = useState<Team | null | undefined>(undefined)
  const shown = list.filter((team) => matchesTeam(team, rows, query))
  const open = openId ? (list.find((team) => team.id === openId) ?? null) : null

  const form = (
    <TeamDialog
      team={editing}
      rows={rows}
      onClose={() => setEditing(undefined)}
      onSaved={(team) => {
        setEditing(undefined)
        setOpenId(team.id)
      }}
    />
  )

  if (open) {
    return (
      <>
        <TeamDetail team={open} rows={rows} onBack={() => setOpenId(null)} onEdit={() => setEditing(open)} />
        {form}
      </>
    )
  }

  return (
    <Page
      wide
      title={section.label}
      actions={
        <>
          <Button variant="outline" disabled>
            Browse Library
          </Button>
          <Button onClick={() => setEditing(null)}>
            <Plus />
            New team
          </Button>
        </>
      }
    >
      <label className="relative block">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-subtle" />
        <input
          type="search"
          placeholder="Search teams…"
          aria-label="Search teams"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-9 w-full rounded-xl border border-line bg-input py-1.5 pr-3 pl-9 text-ui-base text-foreground outline-none select-text placeholder:text-foreground-subtlest hover:border-line-strong focus:border-line-strong"
        />
      </label>
      {list.length ? (
        shown.length ? (
          <ul aria-label="Teams" className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {shown.map((team) => (
              <TeamCard key={team.id} team={team} rows={rows} onOpen={() => setOpenId(team.id)} />
            ))}
          </ul>
        ) : (
          <p className="text-ui-base text-foreground-subtle">No teams match.</p>
        )
      ) : (
        <EmptyCard
          title={
            teams.state === 'ready'
              ? 'Bring your team into harmony'
              : teams.state === 'unavailable'
                ? 'Teams are unavailable right now.'
                : 'Loading teams…'
          }
          description={
            teams.state === 'ready'
              ? 'Browse predefined teams in the Library, or create your own from agents you already have.'
              : teams.state === 'unavailable'
                ? unavailableText('Teams', teams.reason)
                : undefined
          }
          actions={
            teams.state === 'ready' ? (
              <Button variant="outline" onClick={() => setEditing(null)}>
                Create your own team
              </Button>
            ) : undefined
          }
        />
      )}
      {/* What is still Band's and not here, in this app's own words. */}
      <ComingNote>
        The Library of ready-made teams stays in the official app. A team&rsquo;s New room is not here yet.
      </ComingNote>
      {form}
    </Page>
  )
}

/** A team's agents as small marks, overlapping, the way a room's row shows its participants: four at most. */
function MemberMarks({ members, extra }: { members: readonly AgentRow[]; extra: number }) {
  const shown = members.slice(0, 4)
  const more = members.length - shown.length + extra
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center">
      {shown.map((row) => (
        <Initials key={row.id} name={memberName(row)} className="-ml-1.5 size-6 ring-2 ring-card first:ml-0" />
      ))}
      {more > 0 ? <span className="ml-1 text-ui-xs text-foreground-subtle tabular-nums">+{more}</span> : null}
    </span>
  )
}

function TeamCard({ team, rows, onOpen }: { team: Team; rows: readonly AgentRow[]; onOpen(): void }) {
  const { members, missing } = teamMembers(team, rows)
  return (
    <li aria-label={team.name}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${team.name}`}
        className="flex h-full w-full flex-col gap-3 rounded-xl border border-line bg-card p-4 text-left transition-colors outline-none hover:border-line-strong"
      >
        <div className="flex w-full items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-ui-base font-semibold text-foreground">{team.name}</div>
            {team.description ? (
              <p className="mt-1 line-clamp-2 text-ui-sm leading-5 text-foreground-subtle">{team.description}</p>
            ) : null}
          </div>
          <MemberMarks members={members} extra={missing} />
        </div>
        <div className="mt-auto flex w-full flex-col gap-0.5 text-ui-sm">
          <span className="truncate text-foreground">{members.map(memberName).join(', ') || 'No agents'}</span>
          <span className="text-foreground-subtle">{rosterLine(team, rows)}</span>
        </div>
      </button>
    </li>
  )
}

/**
 * One team (Band Desktop 0.4.14): its name with its description under it, Edit team, then "Members · On your roster"
 * with each agent's name, handle (Copy handle beside it, as in Band) and provider marked On roster, then Team
 * guidelines, or Add guidelines while it has none.
 */
function TeamDetail({
  team,
  rows,
  onBack,
  onEdit,
}: {
  team: Team
  rows: readonly AgentRow[]
  onBack(): void
  onEdit(): void
}) {
  const { members, missing } = teamMembers(team, rows)
  return (
    <Page
      wide
      title={team.name}
      description={team.description || undefined}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={onBack} aria-label="Back to teams">
            <ArrowLeft />
            Teams
          </Button>
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit team
          </Button>
        </>
      }
    >
      <PageSection title={`Members · ${rosterLine(team, rows)}`}>
        <SettingsCard>
          <ul aria-label="Members">
            {members.map((row) => {
              const provider = providerName(row.local?.host)
              return (
                <li key={row.id} className="flex items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
                  <Initials name={memberName(row)} className="size-8 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-ui-base font-medium text-foreground">{memberName(row)}</div>
                    <div className="flex min-w-0 items-center gap-2">
                      {row.handle ? (
                        <>
                          <span className="truncate font-mono text-ui-sm text-foreground-subtle">{row.handle}</span>
                          <CopyHandle handle={row.handle} />
                        </>
                      ) : null}
                      {provider ? (
                        <span className="shrink-0 rounded-full border border-line px-2 text-ui-sm leading-5 text-foreground">
                          {provider}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-ui-sm text-success">
                    <Check className="size-3.5" />
                    On roster
                  </span>
                </li>
              )
            })}
            {missing > 0 ? (
              <li className="border-t border-line px-4 py-3 text-ui-sm text-foreground-subtle first:border-t-0">
                {missing === 1
                  ? 'One of this team’s agents is not on this account’s roster.'
                  : `${missing} of this team’s agents are not on this account’s roster.`}
              </li>
            ) : null}
          </ul>
        </SettingsCard>
      </PageSection>
      <PageSection title="Team guidelines">
        {team.guidelines ? (
          <SettingsCard>
            <p className="px-4 py-3 text-ui-base leading-6 whitespace-pre-wrap text-foreground">{team.guidelines}</p>
          </SettingsCard>
        ) : (
          <div>
            <Button variant="outline" size="sm" onClick={onEdit}>
              Add guidelines
            </Button>
          </div>
        )}
      </PageSection>
    </Page>
  )
}

/**
 * New team and Edit team (user guide, "Create your own team"): a name, a description, any guidelines the team should
 * follow, and its agents, chosen from the account's own (an edited team's agents the account does not hold are listed as
 * Not on your roster, to keep or take out); then Create team, or Save for a team being edited. Band refuses a team
 * without an agent, and so does the form, in Band's words, before anything is sent.
 */
function TeamDialog({
  team,
  rows,
  onClose,
  onSaved,
}: {
  team: Team | null | undefined
  rows: readonly AgentRow[]
  onClose(): void
  onSaved(team: Team): void
}) {
  // Closing, the dialog keeps what it showed, so it never shrinks away empty.
  const [last, setLast] = useState(team)
  if (team !== undefined && team !== last) setLast(team)
  const shown = team === undefined ? last : team
  // While a save is on its way the dialog stays open, so what Band answers (the team, or its refusal) is never lost.
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={team !== undefined} onOpenChange={(open) => (open || busy ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        {shown !== undefined ? (
          <TeamForm
            key={shown?.id ?? 'new'}
            team={shown}
            rows={rows}
            busy={busy}
            setBusy={setBusy}
            onClose={onClose}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

const FIELD =
  'w-full resize-none rounded-lg border border-line bg-input px-2.5 py-1.5 text-ui-base text-foreground outline-none select-text placeholder:text-foreground-subtlest hover:border-line-strong focus:border-line-strong'

function TeamForm({
  team,
  rows,
  busy,
  setBusy,
  onClose,
  onSaved,
}: {
  team: Team | null
  rows: readonly AgentRow[]
  busy: boolean
  setBusy(busy: boolean): void
  onClose(): void
  onSaved(team: Team): void
}) {
  const profile = useSettings((state) => state.settings.profile)
  const nameId = useId()
  const [draft, setDraft] = useState<TeamDraft>(() => (team ? draftOf(team) : emptyDraft()))
  const [error, setError] = useState<string | null>(null)
  const problem = draftProblem(draft)
  const set = (part: Partial<TeamDraft>) => setDraft((current) => ({ ...current, ...part }))
  const choose = (id: string, on: boolean) =>
    set({ agentIds: on ? [...draft.agentIds, id] : draft.agentIds.filter((one) => one !== id) })
  // The team's agents the agent list does not hold (one removed since, or one this account cannot see): listed so they
  // can be seen and taken out, never kept or dropped without a word.
  const onRoster = new Set(rows.map((row) => row.id))
  const offRoster = team ? team.agent_ids.filter((id) => !onRoster.has(id)) : []

  const save = async () => {
    const api = jam()
    if (!api || problem) return
    setBusy(true)
    setError(null)
    try {
      const saved = team
        ? await api.daemon.updateTeam({ profile, teamId: team.id, draft })
        : await api.daemon.createTeam({ profile, draft })
      await useDaemon.getState().refresh(profile)
      onSaved(saved)
    } catch (reason) {
      setError(daemonErrorText(reason))
      // A team Band made or saved, but whose answer this app could not read, still reaches the list behind the dialog.
      void useDaemon.getState().refresh(profile)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{team ? 'Edit team' : 'New team'}</DialogTitle>
        <DialogDescription>A group of agents that work together, with optional shared guidelines.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className="text-ui-sm font-medium text-foreground">
            Name
          </label>
          <Input
            id={nameId}
            value={draft.name}
            maxLength={TEAM_LIMITS.name}
            onChange={(event) => set({ name: event.target.value })}
          />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-ui-sm font-medium text-foreground">Description</span>
          <textarea
            rows={2}
            value={draft.description}
            maxLength={TEAM_LIMITS.description}
            onChange={(event) => set({ description: event.target.value })}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-ui-sm font-medium text-foreground">Guidelines</span>
          <textarea
            rows={3}
            value={draft.guidelines}
            maxLength={TEAM_LIMITS.guidelines}
            placeholder="Anything the team should follow"
            onChange={(event) => set({ guidelines: event.target.value })}
            className={FIELD}
          />
        </label>
        <div role="group" aria-label="Agents" className="flex flex-col gap-1.5">
          <span className="text-ui-sm font-medium text-foreground">Agents</span>
          {rows.length || offRoster.length ? (
            <ul className="max-h-52 overflow-y-auto rounded-lg border border-line">
              {rows.map((row) => (
                <li key={row.id} className="border-t border-line first:border-t-0">
                  <Checkbox
                    checked={draft.agentIds.includes(row.id)}
                    onCheckedChange={(on) => choose(row.id, on === true)}
                    className="w-full px-3 py-2 hover:bg-hover"
                  >
                    <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                      <span className="truncate text-ui-base text-foreground">{memberName(row)}</span>
                      {row.handle ? (
                        <span className="truncate font-mono text-ui-sm text-foreground-subtle">{row.handle}</span>
                      ) : null}
                    </span>
                  </Checkbox>
                </li>
              ))}
              {offRoster.map((id) => (
                <li key={id} className="border-t border-line first:border-t-0">
                  <Checkbox
                    checked={draft.agentIds.includes(id)}
                    onCheckedChange={(on) => choose(id, on === true)}
                    className="w-full px-3 py-2 hover:bg-hover"
                  >
                    <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                      <span className="truncate text-ui-base text-foreground-subtle">Not on your roster</span>
                      <span className="truncate font-mono text-ui-sm text-foreground-subtle">{id.slice(0, 8)}</span>
                    </span>
                  </Checkbox>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ui-sm text-foreground-subtle">
              No agents yet. A team is made from agents you already have.
            </p>
          )}
        </div>
        {error ? (
          <p role="alert" className="text-ui-sm text-destructive">
            {error}
          </p>
        ) : problem && (draft.name || draft.agentIds.length) ? (
          <p className="text-ui-sm text-foreground-subtle">{problem}</p>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={problem !== null || busy} onClick={() => void save()}>
          {team ? 'Save' : 'Create team'}
        </Button>
      </DialogFooter>
    </>
  )
}
