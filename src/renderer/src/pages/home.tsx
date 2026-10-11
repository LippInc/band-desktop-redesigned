import { Link, useNavigate } from '@tanstack/react-router'
import { Archive, ArchiveRestore, ArrowUp, Bot, Check, ChevronDown, MoreHorizontal, Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { AgentRow, HostPeer, Inbox, Kickoff, Room, RoomOrg, WorkSummary } from '@shared/daemon'
import { JamMascot } from '@/components/jam-mascot'
import { Initials } from '@/components/room/chat'
import { StagedFiles } from '@/components/room/staged-files'
import { IconButton } from '@/components/shell/icon-button'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { unavailableText } from '@/components/room/unavailable'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { agentGroups, deliveryText, READINESS, type AgentChoice } from '@/lib/assign'
import {
  AttachmentError,
  clearStaged,
  dropTarget,
  homeScope,
  pasteFiles,
  setStagingSending,
  storeStaged,
  useStagedFiles,
} from '@/lib/attachments'
import { jam } from '@/lib/platform'
import { archivedCount, homeRooms, isArchived, withArchived } from '@/lib/room-org'
import { roomMoment, shortAge, sortRooms } from '@/lib/rooms'
import { useRoomOrg } from '@/lib/use-room-org'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'
import { useDaemon, useShellPart } from '@/stores/daemon'
import { useSettings } from '@/stores/settings'

/**
 * Jam's Home (user guide, "Home"; Jam Desktop's own words) in ZCode's home layout (docs/DESIGN.md, "Home"): a vertically
 * centred 672 column, Jam's mascot over its "Assign work" where ZCode greets you, the composer (a strip row over a card) where ZCode
 * starts a task, and Home's three lists below: what waits on the person (the inbox from the daemon's stream), the agents'
 * open work by room, and the rooms they work in (both from the account's work snapshot). Without agents, Jam's empty
 * words: nothing can wait on you, no work is active, and no room was started for an agent.
 */
export function HomePage() {
  const agents = useShellPart('agents')
  const work = useShellPart('work')
  const rooms = useShellPart('rooms')
  const inbox = useDaemon((state) => state.inbox)
  const inboxChanged = useDaemon((state) => state.inboxChanged)
  const now = useNow(30_000)
  const noAgents = agents.state === 'ready' && agents.data.rows.length === 0
  // Until the agents are read, Home cannot say what waits or what is active: it says why instead.
  const agentsNote =
    agents.state === 'unavailable'
      ? unavailableText('This list', agents.reason)
      : agents.state === 'idle'
        ? 'Loading…'
        : null
  const roomList = rooms.state === 'ready' ? rooms.data : []
  const { org, busy: orgBusy, change, problem: orgProblem } = useRoomOrg('home')
  // Jam: "Archive room hides a room from Home on this device", and Show archived brings the hidden ones back.
  const [showArchived, setShowArchived] = useState(false)
  const listed = org ? homeRooms(roomList, org, showArchived) : roomList
  const agentRows = agents.state === 'ready' ? agents.data.rows : []
  const attention = inbox === null ? (noAgents ? [] : null) : attentionOf(inbox, roomList)
  const active = work.state === 'ready' ? activeWorkOf(work.data, roomList, agentRows) : null
  const recent =
    work.state === 'ready'
      ? sortRooms(listed.filter((room) => work.data.rooms.some((item) => item.roomId === room.id))).slice(0, 5)
      : null
  // How many of the rooms Home would otherwise list are archived, which is what Show archived offers to bring back.
  const hiddenHere =
    org && work.state === 'ready'
      ? archivedCount(
          roomList.filter((room) => work.data.rooms.some((item) => item.roomId === room.id)),
          org,
        )
      : 0
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [peers, setPeers] = useState<HostPeer[] | null>(null)
  const [defaultPeer, setDefaultPeer] = useState<string | null>(null)
  const [chosenPeer, setChosenPeer] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [result, setResult] = useState<{ outcome: Kickoff; name: string } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const connected = useDaemon((state) => state.status.state === 'connected')
  const profile = useSettings((state) => state.settings.profile)
  const scope = homeScope(profile)
  const staged = useStagedFiles(scope)
  const statusId = useId()
  const field = useRef<HTMLTextAreaElement>(null)

  // Readiness is not in the agent list: it is settled from the host sessions this computer reports, and the account's
  // preselected agent says which one the control offers first (src/renderer/src/lib/assign.ts).
  useEffect(() => {
    const api = jam()
    if (!api || !connected) return
    let current = true
    void api.daemon
      .hostPeers()
      .then((data) => current && setPeers(data))
      .catch(() => current && setPeers(null))
    void api.daemon
      .defaultAgent({ profile })
      .then((data) => current && setDefaultPeer(data.peer))
      .catch(() => current && setDefaultPeer(null))
    return () => {
      current = false
    }
  }, [connected, profile])

  const groups = agentGroups(agentRows, peers, work.state === 'ready' ? work.data : null, roomList)
  // Who the work goes to: the agent chosen for this assignment, or the account's preselected one until then. It is
  // derived rather than kept, so an agent whose readiness changes while the menu is open shows the new one.
  const chosen = groups.mine.find((choice) => choice.peer === (chosenPeer ?? defaultPeer)) ?? null

  const canAssign = chosen !== null && draft.trim().length > 0 && !assigning
  const assign = () => {
    const api = jam()
    if (!api || !chosen || !draft.trim() || assigning) return
    setAssigning(true)
    setProblem(null)
    setResult(null)
    const name = chosen.name
    // The assignment opens its own room only when it is sent, so its files are staged unbound - the CLI's own
    // "stage unbound for a later kickoff" - and the ids the store answers are what the assignment carries
    // (user guide, "Use attachments in an assignment": "After a successful assignment, the files belong to the
    // created room and the staging strip clears"). The files cannot change while it is on its way.
    setStagingSending(scope, true)
    void (async () => {
      let attachmentIds: string[]
      try {
        attachmentIds = await storeStaged(scope, (input) => api.daemon.fileStore(input), profile, '')
      } catch (reason) {
        // No room exists yet when a file fails, so nothing was assigned and trying again is safe.
        setProblem(
          `${reason instanceof AttachmentError ? reason.message : 'A file could not be attached.'} Nothing was assigned.`,
        )
        setStagingSending(scope, false)
        setAssigning(false)
        return
      }
      try {
        const outcome = await api.daemon.kickoffWork({
          profile,
          scope: chosen.scope,
          handle: chosen.handle,
          message: draft.trim(),
          ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
        })
        setResult({ outcome, name })
        setDraft('')
        clearStaged(scope)
      } catch {
        // Jam's own guidance after a failure: do not send it again blindly, because a retry can make a second room.
        setProblem(
          'That assignment did not go through. Check Rooms before assigning it again: a retry can open a second room.',
        )
      } finally {
        setStagingSending(scope, false)
        setAssigning(false)
      }
    })()
  }
  const makeDefault = (choice: AgentChoice) => {
    const api = jam()
    if (!api) return
    setDefaultPeer(choice.peer)
    void api.daemon.setDefaultAgent({ profile, peer: choice.peer }).catch(() => setDefaultPeer(defaultPeer))
  }

  return (
    <div className="flex min-h-full flex-col items-center px-4 before:block before:min-h-[52px] before:w-full before:flex-1 after:block after:min-h-4 after:w-full after:flex-1">
      <section className="flex w-full max-w-[672px] flex-col" aria-labelledby="assign-work">
        {/* Jam's mascot sits above "Assign work", 56 across, as Jam Desktop draws it. */}
        <JamMascot className="mb-6 self-center" />
        <h1
          id="assign-work"
          className="px-4 text-center text-ui-title font-medium tracking-normal text-balance text-foreground"
        >
          Assign work
        </h1>

        <div className="mt-11 rounded-2xl bg-strip">
          <div className="flex h-10 items-center gap-1 p-1.5">
            <AgentMenu
              open={agentMenuOpen}
              onOpenChange={setAgentMenuOpen}
              groups={groups}
              chosen={chosen}
              onChoose={(choice) => setChosenPeer(choice.peer)}
              defaultPeer={defaultPeer}
              onMakeDefault={makeDefault}
              noAgents={noAgents}
            />
            {/* Jam also puts the recent agents as chips, in a group it names Quick picks (Jam Desktop 0.4.10); a chip is
                the same choice as the menu's row. */}
            {groups.recent.length > 0 ? (
              <div role="group" aria-label="Quick picks" className="contents">
                {groups.recent.map((choice) => (
                  <AgentChip
                    key={choice.peer}
                    choice={choice}
                    chosen={chosen?.peer === choice.peer}
                    onChoose={() => setChosenPeer(choice.peer)}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <div
            className="flex flex-col gap-3 rounded-2xl border border-line-strong bg-card p-3"
            {...dropTarget(staged.stage)}
          >
            <StagedFiles
              files={staged.files}
              problem={staged.problem}
              sending={staged.sending}
              statusId={statusId}
              field={field}
              onRemove={staged.remove}
            />
            <textarea
              ref={field}
              aria-label="Describe the work"
              aria-describedby={statusId}
              placeholder="Describe the work…"
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={pasteFiles(staged.stage)}
              onKeyDown={(event) => {
                // Enter assigns and Shift+Enter adds a line (user guide, "Assign work"). Nothing is assigned without a
                // chosen agent, so Enter opens the agent control instead and the draft stays.
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                event.preventDefault()
                if (chosen) assign()
                else setAgentMenuOpen(true)
              }}
              className="max-h-40 min-h-10 w-full resize-none bg-transparent text-ui-base leading-5 text-foreground outline-none select-text placeholder:text-foreground-subtlest"
            />
            {/* Jam's Home composer has no attach button: a file is pasted or dropped (user guide, "Assign work"). */}
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-right text-ui-base text-foreground-subtle">
                {chosen ? (chosen.readiness ? READINESS[chosen.readiness] : '') : 'Choose who does the work'}
              </span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button size="icon-sm" aria-label="Assign work" disabled={!canAssign} onClick={assign}>
                      <ArrowUp />
                    </Button>
                  }
                />
                <TooltipContent>Assign work</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
        {/* What became of the assignment: Jam says who took it and offers the room it opened. */}
        {problem ? (
          <p role="status" className="mt-3 text-ui-base text-foreground-subtle">
            {problem}
          </p>
        ) : result ? (
          <p role="status" className="mt-3 flex items-center gap-2 text-ui-base text-foreground-subtle">
            <span>{deliveryText(result.outcome, result.name)}</span>
            <Link
              to="/rooms/$roomId"
              params={{ roomId: result.outcome.chat_id }}
              search={{ view: 'work' }}
              className="text-brand-text underline-offset-2 hover:underline"
            >
              Open the room
            </Link>
          </p>
        ) : null}

        <div className="mt-9 grid gap-6">
          <HomeList title="Needs attention">
            {inboxChanged ? (
              <Quiet>{unavailableText('This list', 'changed')}</Quiet>
            ) : attention === null ? (
              <Quiet>{agentsNote ?? 'Loading…'}</Quiet>
            ) : attention.length === 0 ? (
              <Empty title="All clear">Nothing is waiting on you. Your agents have everything they need.</Empty>
            ) : (
              <ul aria-label="Needs attention" className="-mx-1.5 flex flex-col">
                {attention.map((item) => (
                  <AttentionRow key={item.key} item={item} now={now} />
                ))}
              </ul>
            )}
          </HomeList>
          <HomeList title="Active work">
            {noAgents ? (
              <Empty
                title="No agents yet"
                action={
                  <Link to="/agents" className={buttonVariants({ size: 'sm' })}>
                    Create an agent
                  </Link>
                }
              >
                Create an agent, then describe work above. Band opens a room and gets it started.
              </Empty>
            ) : agentsNote ? (
              <Quiet>{agentsNote}</Quiet>
            ) : active === null ? (
              <Quiet>{work.state === 'unavailable' ? unavailableText('Active work', work.reason) : 'Loading…'}</Quiet>
            ) : active.length === 0 ? (
              <Empty title="No active work">Your agents have no open tasks. Describe work above to start some.</Empty>
            ) : (
              <div className="-mx-1.5 flex flex-col gap-2">
                {active.map((group) => (
                  <ActiveRoom key={group.roomId} group={group} />
                ))}
              </div>
            )}
          </HomeList>
          {/* Recent rooms lists the rooms your local agents work in, so with none it is empty (Jam Desktop 0.4.10). */}
          <HomeList
            title="Recent rooms"
            action={
              hiddenHere > 0 || showArchived ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-ui-sm text-foreground-subtle"
                  onClick={() => setShowArchived(!showArchived)}
                >
                  {showArchived ? 'Hide archived' : `Show archived (${hiddenHere})`}
                </Button>
              ) : null
            }
          >
            {noAgents ? (
              <Quiet>No rooms yet. Assigning work creates the first one.</Quiet>
            ) : agentsNote ? (
              <Quiet>{agentsNote}</Quiet>
            ) : recent === null ? (
              <Quiet>Loading…</Quiet>
            ) : recent.length === 0 ? (
              <Quiet>No rooms yet. Assigning work creates the first one.</Quiet>
            ) : (
              <ul aria-label="Recent rooms" className="-mx-1.5 flex flex-col">
                {recent.map((room) => (
                  <li key={room.id} className="group/room relative flex items-center">
                    <Link
                      to="/rooms/$roomId"
                      params={{ roomId: room.id }}
                      className="flex h-9 min-w-0 flex-1 items-center gap-3 rounded-lg px-1.5 text-ui-base text-foreground transition-colors hover:bg-hover"
                    >
                      <Initials name={room.title} className="size-6 rounded-md" />
                      <span className="min-w-0 flex-1 truncate">{room.title}</span>
                      {roomMoment(room) !== null ? (
                        <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                          {shortAge(roomMoment(room)!, now)}
                        </span>
                      ) : null}
                    </Link>
                    {org ? (
                      <RoomArchiveActions
                        room={room}
                        archived={isArchived(org, room.id)}
                        busy={orgBusy}
                        onChange={change}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {/* Archive and Restore write the whole organisation, which the official app shares; a refusal says so. */}
            {orgProblem ? <Quiet>{orgProblem}</Quiet> : null}
          </HomeList>
        </div>
      </section>
    </div>
  )
}

/** Jam's chip for a recent agent: its dot and its name, beside the agent control. Choosing one is the menu's choice. */
function AgentChip({ choice, chosen, onChoose }: { choice: AgentChoice; chosen: boolean; onChoose(): void }) {
  return (
    <button
      type="button"
      onClick={onChoose}
      aria-pressed={chosen}
      className={cn(
        'flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-ui-base transition-colors outline-none',
        chosen ? 'bg-selected text-foreground' : 'text-foreground-subtle hover:bg-surface-hover',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 rounded-full',
          choice.readiness === 'attached' ? 'bg-primary' : 'bg-foreground-subtlest',
        )}
      />
      <span className="max-w-32 truncate">{choice.name}</span>
    </button>
  )
}

/** One agent in the control: its name, and Jam's readiness words under it. */
function AgentItem({ choice, chosen, onChoose }: { choice: AgentChoice; chosen: boolean; onChoose(): void }) {
  return (
    <DropdownMenuItem onClick={onChoose} className="h-auto items-start py-1.5">
      <Bot className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-foreground">{choice.name}</span>
        {/* Nothing is said about an agent whose host sessions have not been read (src/renderer/src/lib/assign.ts). */}
        {choice.readiness ? (
          <span className="block truncate text-ui-sm text-foreground-subtle">{READINESS[choice.readiness]}</span>
        ) : null}
      </span>
      {chosen ? <Check className="mt-0.5 text-foreground-subtle" /> : null}
    </DropdownMenuItem>
  )
}

/**
 * Jam's agent control: Recent agents and My agents, with the readiness beside each (user guide, "Assign work"). With no
 * agents Jam's menu holds My agents and "Create an agent…" alone. Choosing one says who this assignment goes to;
 * "Use this agent by default" is what keeps that choice for the assignments after it.
 */
function AgentMenu({
  open,
  onOpenChange,
  groups,
  chosen,
  onChoose,
  defaultPeer,
  onMakeDefault,
  noAgents,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  groups: { recent: AgentChoice[]; mine: AgentChoice[] }
  chosen: AgentChoice | null
  onChoose(choice: AgentChoice): void
  defaultPeer: string | null
  onMakeDefault(choice: AgentChoice): void
  noAgents: boolean
}) {
  const navigate = useNavigate()
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      {/* Jam's control says "Agent" and is named "Choose an agent" (Jam Desktop 0.4.10). Once an agent is chosen it
          says that agent's name, so the composer shows who the work is going to without opening the menu. */}
      <DropdownMenuTrigger
        aria-label="Choose an agent"
        className="flex h-7 shrink-0 items-center gap-1 rounded-full pr-2 pl-3 text-ui-base text-foreground transition-colors outline-none hover:bg-surface-hover aria-expanded:bg-surface-hover [&_svg]:size-4"
      >
        <Bot />
        <span className="max-w-40 truncate">{chosen?.name ?? 'Agent'}</span>
        <ChevronDown className="text-foreground-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        {groups.recent.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Recent agents</DropdownMenuLabel>
            {groups.recent.map((choice) => (
              <AgentItem
                key={choice.peer}
                choice={choice}
                chosen={chosen?.peer === choice.peer}
                onChoose={() => onChoose(choice)}
              />
            ))}
          </DropdownMenuGroup>
        ) : null}
        <DropdownMenuGroup>
          <DropdownMenuLabel>My agents</DropdownMenuLabel>
          {groups.mine.map((choice) => (
            <AgentItem
              key={choice.peer}
              choice={choice}
              chosen={chosen?.peer === choice.peer}
              onChoose={() => onChoose(choice)}
            />
          ))}
          {/* Choosing an agent affects this assignment only; this is what keeps it for later ones (user guide). */}
          {chosen ? (
            <DropdownMenuItem
              onClick={() => onMakeDefault(chosen)}
              disabled={defaultPeer === chosen.peer}
              closeOnClick={false}
            >
              {defaultPeer === chosen.peer ? <Check /> : <Bot />}
              Use this agent by default
            </DropdownMenuItem>
          ) : null}
          {noAgents || groups.mine.length === 0 ? (
            <DropdownMenuItem onClick={() => void navigate({ to: '/agents' })}>
              <Plus />
              Create an agent…
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface AttentionItem {
  key: string
  roomId: string
  roomTitle: string
  reason: string
  at: number | null
}

/**
 * Jam's Needs attention (user guide, "Review needs attention"; Jam Desktop 0.4.10's words): up to five rows, permission
 * requests first ("Waiting for your approval"), then questions ("An agent asked a question"), each opening its room.
 */
function attentionOf(inbox: Inbox, rooms: readonly Room[]): AttentionItem[] {
  const titleOf = (roomId: string) => rooms.find((room) => room.id === roomId)?.title ?? 'A room'
  const approvals = inbox.permissions
    .filter((item) => item.record.status === 'pending' && item.record.request.chat_id)
    .toSorted((a, b) => (b.record.request.created_at ?? 0) - (a.record.request.created_at ?? 0))
    .map((item) => ({
      key: `permission ${item.record.request.id}`,
      roomId: item.record.request.chat_id!,
      roomTitle: titleOf(item.record.request.chat_id!),
      reason: 'Waiting for your approval',
      at: item.record.request.created_at ?? null,
    }))
  const questions = inbox.questions.map((item) => ({
    key: `question ${item.question.id}`,
    roomId: item.roomId,
    roomTitle: titleOf(item.roomId),
    reason: 'An agent asked a question',
    at: null,
  }))
  return [...approvals, ...questions].slice(0, 5)
}

function AttentionRow({ item, now }: { item: AttentionItem; now: number }) {
  return (
    <li>
      <Link
        to="/rooms/$roomId"
        params={{ roomId: item.roomId }}
        aria-label={`${item.roomTitle}: ${item.reason}`}
        className="flex items-center gap-3 rounded-lg px-1.5 py-2 transition-colors hover:bg-hover"
      >
        <Initials name={item.roomTitle} className="size-8 rounded-lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui-base font-medium text-foreground">{item.roomTitle}</span>
          <span className="flex items-center gap-1.5 text-ui-sm text-foreground-subtle">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-destructive" />
            {item.reason}
          </span>
        </span>
        {item.at ? <span className="shrink-0 text-ui-xs text-foreground-subtlest">{ago(item.at, now)}</span> : null}
      </Link>
    </li>
  )
}

interface ActiveGroup {
  roomId: string
  roomTitle: string
  tasks: { id: string; subject: string; agent: string; status: string }[]
}

/** Jam's Active work: the agents' open tasks, by room (in progress first), from the account's work snapshot. */
function activeWorkOf(work: WorkSummary, rooms: readonly Room[], agents: readonly AgentRow[]): ActiveGroup[] {
  return work.rooms
    .map((item) => ({
      roomId: item.roomId,
      roomTitle: rooms.find((room) => room.id === item.roomId)?.title ?? 'A room',
      tasks: item.lanes
        .flatMap((lane) =>
          lane.tasks
            .filter((task) => task.status === 'pending' || task.status === 'in_progress')
            .map((task) => ({
              id: task.id,
              subject: task.subject,
              agent: agents.find((agent) => agent.local?.peer_key === lane.peer_id)?.name ?? 'Agent',
              status: task.status,
            })),
        )
        .toSorted((a, b) => Number(b.status === 'in_progress') - Number(a.status === 'in_progress')),
    }))
    .filter((group) => group.tasks.length > 0)
}

function ActiveRoom({ group }: { group: ActiveGroup }) {
  const [open, setOpen] = useState(true)
  return (
    <section aria-label={group.roomTitle} className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-left text-ui-sm text-foreground-subtle hover:bg-hover"
      >
        <ChevronDown aria-hidden="true" className={cn('size-3.5 transition-transform', !open && '-rotate-90')} />
        <span className="truncate">
          {group.roomTitle} ({group.tasks.length})
        </span>
      </button>
      {open ? (
        <ul className="flex flex-col">
          {group.tasks.map((task) => (
            <li key={task.id}>
              <Link
                to="/rooms/$roomId"
                params={{ roomId: group.roomId }}
                search={{ view: 'work' }}
                className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-hover"
              >
                <Initials name={task.agent} className="size-7" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui-base text-foreground">{task.subject}</span>
                  <span className="block truncate text-ui-sm text-foreground-subtle">{task.agent}</span>
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-2 text-ui-xs leading-5',
                    task.status === 'in_progress'
                      ? 'border-warning/50 bg-warning/10 text-foreground'
                      : 'border-line text-foreground-subtle',
                  )}
                >
                  {task.status === 'in_progress' ? 'In progress' : 'To-do'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/** A time as Jam writes it on Home: "just now", "2m ago", or the date. */
function ago(ms: number, now: number): string {
  const age = shortAge(ms, now)
  if (age === 'now') return 'just now'
  return /^\d+[mhdw]$/.test(age) ? `${age} ago` : age
}

/**
 * Jam's own menu on a room's row on Home: "Archive room hides a room from Home on this device. Archiving does not
 * delete the Band room or change it for other participants." An archived row, shown by Show archived, offers Restore.
 */
function RoomArchiveActions({
  room,
  archived,
  busy,
  onChange,
}: {
  room: Room
  archived: boolean
  busy: boolean
  onChange: (make: (org: RoomOrg) => RoomOrg) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton
            label={`Actions for ${room.title}`}
            size="icon-xs"
            className="shrink-0 text-foreground-subtle opacity-0 transition-opacity group-hover/room:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
          >
            <MoreHorizontal />
          </IconButton>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem disabled={busy} onClick={() => onChange((one) => withArchived(one, room.id, !archived))}>
          {archived ? <ArchiveRestore /> : <Archive />}
          {archived ? 'Restore' : 'Archive room'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function HomeList({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-h-5 items-center justify-between gap-2 px-1">
        <h2 className="text-ui-base leading-5 font-medium text-foreground-subtle">{title}</h2>
        {action}
      </div>
      <div className="rounded-xl border border-line bg-background px-3 py-2.5">{children}</div>
    </section>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-ui-base text-foreground-subtlest">{children}</p>
}

/** An empty list in Jam's words: what the state is, what it means, and the one thing to do next. */
function Empty({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-1">
      <div className="min-w-0 flex-1">
        <p className="text-ui-base font-medium text-foreground">{title}</p>
        <p className="text-ui-base text-pretty text-foreground-subtle">{children}</p>
      </div>
      {action}
    </div>
  )
}
