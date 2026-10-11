import {
  Crown,
  MoreHorizontal,
  UserMinus,
  Download,
  File,
  FileImage,
  FileText,
  FolderOpen,
  Hand,
  ShieldCheck,
  SquareArrowOutUpRight,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DirectoryEntry, Participant, Room, RoomFile, RoomFiles, RoomPlan } from '@shared/daemon'
import type { FileVerdict } from '@shared/ipc-contract'
import { ComingNote } from '@/components/page'
import { IconButton } from '@/components/shell/icon-button'
import { ChoosePlanFile, PlanActions, PlanText } from '@/components/room/plan-card'
import { unavailableText } from '@/components/room/unavailable'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { addedText, candidates, DIRECTORY_MIN_QUERY, DIRECTORY_TABS, type DirectoryTab } from '@/lib/directory'
import { jam } from '@/lib/platform'
import type { RoomAgent } from '@/lib/room-agents'
import { byteSize, initialsOf, sharedBy, shortAge } from '@/lib/rooms'
import { useNow } from '@/lib/use-now'
import { useRoomAgents } from '@/lib/use-room-agents'
import { usePlanProblem } from '@/lib/use-plan'
import type { Loadable } from '@/stores/daemon'
import { useAccount } from '@/stores/daemon'
import { useRoomData, useRoomStore } from '@/stores/room'
import { useSettings } from '@/stores/settings'
import { ROOM_PANELS, useUi, type RoomPanel as RoomPanelTab } from '@/stores/ui'

const PANEL_LABELS: Record<RoomPanelTab, string> = { participants: 'Participants', files: 'Files', plan: 'Plan' }

/**
 * A room's right panel in the side pane (user guide: "the right panel for participants and files", and the plan rail):
 * pill tabs over the panel, as ZCode's side pane opens its tabs (docs/DESIGN.md, "Room").
 */
export function RoomPanel({ room }: { room: Room }) {
  const data = useRoomData(room)
  const agents = useRoomAgents(room)
  const tab = useUi((state) => state.roomPanel)
  const setTab = useUi((state) => state.setRoomPanel)
  const now = useNow()
  const counts: Record<RoomPanelTab, string | null> = {
    participants: data.participants.state === 'ready' ? String(data.participants.data.length) : null,
    files:
      data.files.state === 'ready'
        ? `${shownFiles(data.files.data, data.moreFiles).length}${lastPage(data.files.data, data.moreFiles).has_more ? '+' : ''}`
        : null,
    plan: null,
  }

  return (
    <div className="flex h-full flex-col" aria-label="Room details">
      <div className="flex shrink-0 items-center px-3 pt-3 pb-2">
        <Tabs value={tab} onValueChange={(value) => setTab(value as RoomPanelTab)}>
          <TabsList aria-label="Room details">
            {ROOM_PANELS.map((id) => (
              <TabsTrigger key={id} value={id} data-panel={id}>
                {PANEL_LABELS[id]}
                {counts[id] !== null ? (
                  <span className="text-foreground-subtlest tabular-nums">{counts[id]}</span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {/* Jam keeps Add participants in this header, beside the panel's tabs (Jam Desktop 0.4.10). */}
        {tab === 'participants' ? (
          <AddParticipants
            roomId={room.id}
            present={data.participants.state === 'ready' ? data.participants.data : []}
          />
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {tab === 'participants' ? (
          <Loaded part={data.participants} what="Participants">
            {(participants) => <ParticipantList participants={participants} agents={agents} roomId={room.id} />}
          </Loaded>
        ) : tab === 'files' ? (
          <Loaded part={data.files} what="Files">
            {(files) => <FileList page={files} more={data.moreFiles} now={now} roomId={room.id} />}
          </Loaded>
        ) : (
          <Loaded part={data.plan} what="The plan">
            {(plan) => <PlanView plan={plan} roomId={room.id} now={now} />}
          </Loaded>
        )}
      </div>
    </div>
  )
}

/** One part of the panel: its content once read, a quiet line while it loads, and why it is missing otherwise. */
function Loaded<T>({ part, what, children }: { part: Loadable<T>; what: string; children: (data: T) => ReactNode }) {
  if (part.state === 'ready') return <>{children(part.data)}</>
  return (
    <p className="px-2 py-3 text-ui-base text-foreground-subtle">
      {part.state === 'unavailable' ? unavailableText(what, part.reason) : 'Loading…'}
    </p>
  )
}

/**
 * Jam's "Add participants": its two tabs, a search of Band's own directory, several chosen at once, and what it says
 * when some of them could not be added. `src/renderer/src/lib/directory.ts` holds the rules and why Jam's
 * "Show unavailable" is not here.
 */
function AddParticipants({ roomId, present }: { roomId: string; present: Participant[] }) {
  const profile = useSettings((state) => state.settings.profile)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<DirectoryTab>('Agents')
  const [query, setQuery] = useState('')
  /**
   * What came back, remembered against the search and the tab it came back for. An answer is shown only while it
   * still answers what is being asked: switching tab or typing another letter does not leave the last list on screen
   * as though it were this one's.
   */
  const [answered, setAnswered] = useState<{
    q: string
    kind: string
    result: { entries: DirectoryEntry[]; truncated: boolean } | null
  } | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [said, setSaid] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const kind = DIRECTORY_TABS.find((one) => one.label === tab)?.kind ?? 'agent'
  const asked = query.trim()
  const asking = asked.length >= DIRECTORY_MIN_QUERY
  const fresh = answered && answered.q === asked && answered.kind === kind ? answered.result : undefined
  const found = fresh ?? null
  const shown = found ? candidates(found.entries, present) : []

  // Band is asked only once the search is worth asking about, and never on the render that starts it.
  useEffect(() => {
    const api = jam()
    if (!open || !api || !asking) return
    let current = true
    const timer = setTimeout(() => {
      api.daemon
        .searchDirectory({ profile, kind, q: asked })
        .then((result) => current && setAnswered({ q: asked, kind, result }))
        .catch(() => current && setAnswered({ q: asked, kind, result: null }))
    }, 250)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [open, profile, kind, asked, asking])

  const add = () => {
    const api = jam()
    if (!api || adding || chosen.length === 0) return
    setAdding(true)
    setSaid(null)
    // Each is added on its own, because Jam "keeps the successful additions and reports how many failed".
    Promise.allSettled(chosen.map((participantId) => api.daemon.addRoomParticipant({ profile, roomId, participantId })))
      .then((results) => {
        const failed = results.filter((one) => one.status === 'rejected').length
        const text = addedText(results.length - failed, failed)
        void useRoomStore.getState().load(profile, roomId)
        setChosen([])
        if (text === null) setOpen(false)
        else setSaid(text)
      })
      .finally(() => setAdding(false))
  }

  return (
    <>
      <IconButton
        label="Add participants"
        size="icon-xs"
        className="ml-auto text-foreground-subtle"
        onClick={() => {
          setQuery('')
          setAnswered(null)
          setChosen([])
          setSaid(null)
          setOpen(true)
        }}
      >
        <UserPlus />
      </IconButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-110">
          <DialogHeader>
            <DialogTitle>Add participants</DialogTitle>
          </DialogHeader>
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(value as DirectoryTab)
            }}
          >
            <TabsList aria-label="What to add">
              {DIRECTORY_TABS.map((one) => (
                <TabsTrigger key={one.label} value={one.label}>
                  {one.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <input
            type="search"
            value={query}
            aria-label="Search by name, handle, or email"
            placeholder="Search by name, handle, or email"
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 w-full rounded-xl border border-line bg-input px-3 text-ui-base text-foreground outline-none select-text placeholder:text-foreground-subtlest"
          />
          <div className="max-h-70 min-h-20 overflow-y-auto">
            {!asking ? (
              <p className="px-1 py-2 text-ui-base text-foreground-subtle">
                Type a name, a handle or an email to search.
              </p>
            ) : fresh === undefined ? (
              <p className="px-1 py-2 text-ui-base text-foreground-subtle">Searching…</p>
            ) : shown.length === 0 ? (
              <p className="px-1 py-2 text-ui-base text-foreground-subtle">
                {found === null ? 'That search could not be run.' : 'Nobody here matches that.'}
              </p>
            ) : (
              <ul className="flex flex-col">
                {shown.map((one) => (
                  <li key={one.id}>
                    <Checkbox
                      checked={chosen.includes(one.id)}
                      onCheckedChange={(on) =>
                        setChosen(on === true ? [...chosen, one.id] : chosen.filter((id) => id !== one.id))
                      }
                      className="w-full rounded-lg px-1 py-1.5 hover:bg-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ui-base text-foreground">{one.name}</span>
                        {one.handle ? (
                          <span className="block truncate text-ui-sm text-foreground-subtle">{one.handle}</span>
                        ) : null}
                      </span>
                    </Checkbox>
                  </li>
                ))}
              </ul>
            )}
            {found?.truncated ? (
              <p className="px-1 py-2 text-ui-sm text-foreground-subtlest">
                Band had more matches than it sent. Narrow the search to see the rest.
              </p>
            ) : null}
          </div>
          {said ? (
            <p role="status" className="text-ui-sm text-foreground-subtle">
              {said}
            </p>
          ) : null}
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={add} disabled={chosen.length === 0 || adding}>
              Add participants
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Jam's participant cards (Jam Desktop 0.4.10): people under "Users (N)", each with its name (a crown for the owner) over
 * its handle; agents under "Agents (N)", each with a dot when its runtime in this room is live, a hand with the count of
 * what waits on the person from it, and, while it works, the tool it is using in place of its handle.
 */
function ParticipantList({
  participants,
  agents,
  roomId,
}: {
  participants: Participant[]
  agents: RoomAgent[]
  roomId: string
}) {
  const profile = useSettings((state) => state.settings.profile)
  const selfId = useAccount(profile)?.identity?.user_id ?? null
  const removal = useRemoval(profile, roomId)
  if (participants.length === 0) {
    return <p className="px-2 py-3 text-ui-base text-foreground-subtle">Nobody is in this room.</p>
  }
  const users = participants.filter((participant) => !participant.kind || participant.kind === 'User')
  // Jam's own rule (user guide, "Organize and manage rooms"): a participant may remove another, but never themselves
  // and never the room's owner. It draws no line between a person and an agent, so an agent's card is held to the same
  // rule and offers the same Remove - though the write has only been made live against a person, which is listed as
  // not checked (`docs/jam/differences.md`). Band refuses the two cases it forbids, so neither is offered.
  const owners = new Set(participants.filter((one) => one.role === 'owner').map((one) => one.id))
  const removable = (id: string) => !owners.has(id) && id !== selfId
  return (
    <>
      {users.length ? (
        <>
          <h3 className="px-2 pt-1 pb-1.5 text-ui-sm font-medium text-foreground-subtle">Users ({users.length})</h3>
          <ParticipantRows label="Participants" participants={users} removable={removable} removal={removal} />
        </>
      ) : null}
      {agents.length ? (
        <>
          <h3 className="px-2 pt-4 pb-1.5 text-ui-sm font-medium text-foreground-subtle">Agents ({agents.length})</h3>
          <ul aria-label="Agents" className="flex flex-col gap-0.5">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} removable={removable(agent.id)} removal={removal} />
            ))}
          </ul>
        </>
      ) : null}
      {removal.said ? (
        <p role="status" className="px-2 pt-2 text-ui-sm text-foreground-subtle">
          {removal.said}
        </p>
      ) : null}
    </>
  )
}

interface Removal {
  /** Which participant a removal is on its way for, so nothing else can be removed from the same reading. */
  busy: string | null
  said: string | null
  remove: (id: string) => void
}

/**
 * Removing a participant: `removeRoomParticipant`, the one operation for it, whichever card asked - a person's row or
 * an agent's. The room is read again afterwards, so what is listed is what Jam holds rather than what this app hoped.
 *
 * The flag that lets one removal through at a time is a ref, not the state the cards are drawn from: state read from
 * a render's closure is as old as that render, so two dispatches before the next one could both pass it. The state
 * beside it exists only to switch the menus off.
 */
function useRemoval(profile: string, roomId: string): Removal {
  const [busy, setBusy] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const inFlight = useRef<string | null>(null)
  return {
    busy,
    said,
    remove: (id: string) => {
      const api = jam()
      if (!api || inFlight.current) return
      inFlight.current = id
      setBusy(id)
      setSaid(null)
      api.daemon
        .removeRoomParticipant({ profile, roomId, participantId: id })
        .then(() => void useRoomStore.getState().load(profile, roomId))
        .catch(() => setSaid('Band did not remove that participant.'))
        .finally(() => {
          inFlight.current = null
          setBusy(null)
        })
    },
  }
}

/** Jam's Remove, on the card of a participant that may be removed: the same menu on a person's row and an agent's. */
function RemoveMenu({ id, name, removal }: { id: string; name: string; removal: Removal }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${name}`}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-subtle opacity-0 transition-opacity outline-none group-hover/person:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 [&_svg]:size-4"
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {/* Every Remove waits while one is on its way, rather than one card taking a click that does nothing. */}
        <DropdownMenuItem disabled={removal.busy !== null} onClick={() => removal.remove(id)}>
          <UserMinus />
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AgentCard({ agent, removable, removal }: { agent: RoomAgent; removable: boolean; removal: Removal }) {
  return (
    <li aria-label={agent.name} className="group/person flex items-center gap-3 rounded-lg px-2 py-2">
      <span className="relative inline-flex shrink-0">
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full bg-secondary text-ui-sm font-semibold text-foreground"
        >
          {initialsOf(agent.name)}
        </span>
        {agent.live ? (
          <span
            role="img"
            aria-label="Online"
            className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-success ring-2 ring-background"
          />
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-ui-base font-semibold text-foreground">{agent.name}</span>
        </div>
        {agent.tool ? (
          <div className="truncate text-ui-sm text-info">{agent.tool}</div>
        ) : agent.handle ? (
          <div className="truncate font-mono text-ui-sm text-foreground-subtle">{agent.handle}</div>
        ) : null}
      </div>
      {agent.attention > 0 ? (
        <span
          role="img"
          aria-label={agent.attention === 1 ? '1 waiting on you' : `${agent.attention} waiting on you`}
          className="flex shrink-0 items-center gap-1 rounded-full border border-warning/50 bg-warning/10 px-1.5 text-ui-xs leading-5 text-foreground"
        >
          <Hand aria-hidden="true" className="size-3" />
          {agent.attention}
        </span>
      ) : null}
      {removable ? <RemoveMenu id={agent.id} name={agent.name} removal={removal} /> : null}
    </li>
  )
}

function ParticipantRows({
  label,
  participants,
  removable,
  removal,
}: {
  label: string
  participants: Participant[]
  removable: (id: string) => boolean
  removal: Removal
}) {
  return (
    <ul aria-label={label} className="flex flex-col gap-0.5">
      {participants.map((participant) => {
        const name = participant.name || participant.handle || 'Unnamed participant'
        return (
          <li key={participant.id} className="group/person flex items-center gap-3 rounded-lg px-2 py-2">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-ui-sm font-semibold text-foreground"
            >
              {initialsOf(participant.name || participant.handle)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-ui-base font-semibold text-foreground">{name}</span>
                {participant.role === 'owner' ? (
                  <Crown role="img" aria-label="Owner" className="size-3.5 shrink-0 text-foreground-subtle" />
                ) : null}
              </div>
              <div className="truncate font-mono text-ui-sm text-foreground-subtle">
                {[participant.handle, captionOf(participant)].filter(Boolean).join(' · ')}
              </div>
            </div>
            {removable(participant.id) ? <RemoveMenu id={participant.id} name={name} removal={removal} /> : null}
          </li>
        )
      })}
    </ul>
  )
}

/** What the card says beside the handle: an agent's kind as Jam names it, and a status other than active. */
function captionOf(participant: Participant): string | null {
  const parts = [
    participant.kind && participant.kind !== 'User' ? participant.kind : null,
    participant.status && participant.status !== 'active' ? participant.status : null,
  ]
  return parts.filter(Boolean).join(' · ') || null
}

/** What a checksum check found, in this app's words: Jam's own were never seen (`docs/jam/differences.md`). */
const VERDICTS: Record<FileVerdict, string> = {
  matches: 'This copy matches its checksum.',
  differs: 'This copy does not match its checksum.',
  missing: 'This computer has no copy of this file.',
  unknown: 'Band recorded no checksum for this file.',
  'too-large': 'This file is too large to check here.',
  unavailable: 'Band did not answer, so this file was not checked.',
}

/** One of Jam's five actions on a file, as a small button that says what it does. */
function FileActionButton({
  label,
  icon,
  onAct,
  busy,
}: {
  label: string
  icon: ReactNode
  onAct(): void
  busy: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            disabled={busy}
            onClick={onAct}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-subtle transition-colors outline-none hover:bg-hover hover:text-foreground disabled:opacity-50 [&_svg]:size-4"
          >
            {icon}
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** The page whose `has_more` and `next_cursor` the Load more control reads: the last one asked for. */
export function lastPage(page: RoomFiles, more: readonly RoomFiles[]): RoomFiles {
  return more.at(-1) ?? page
}

/**
 * Every file listed: the first page and the ones read after it, each file once. A room re-read answers page one
 * again, so the same file can arrive twice; it is kept where it first appeared.
 */
export function shownFiles(page: RoomFiles, more: readonly RoomFiles[]): RoomFile[] {
  const seen = new Set<string>()
  const all: RoomFile[] = []
  for (const file of [...page.files, ...more.flatMap((one) => one.files)]) {
    if (seen.has(file.id)) continue
    seen.add(file.id)
    all.push(file)
  }
  return all
}

function FileList({
  page,
  more,
  now,
  roomId,
}: {
  page: RoomFiles
  more: readonly RoomFiles[]
  now: number
  roomId: string
}) {
  const profile = useSettings((state) => state.settings.profile)
  const [loading, setLoading] = useState(false)
  const files = shownFiles(page, more)
  const tail = lastPage(page, more)
  const onMore = () => {
    if (loading) return
    setLoading(true)
    void useRoomStore
      .getState()
      .readMoreFiles(profile, roomId)
      .finally(() => setLoading(false))
  }

  return (
    <div className="flex flex-col gap-2">
      {page.status === 'local_partial' ? (
        <Note>
          Only the files stored on this computer are listed: Band could not reach its servers for the room&apos;s
          complete file list.
        </Note>
      ) : null}
      {files.length === 0 ? (
        <p className="px-2 py-3 text-ui-base text-foreground-subtle">
          No files yet. Files attached in Chat or from Home appear here.
        </p>
      ) : (
        <ul aria-label="Files" className="flex flex-col gap-0.5">
          {files.map((file) => (
            <FileRow key={file.id} file={file} now={now} roomId={roomId} />
          ))}
        </ul>
      )}
      {/* Jam's own control for the rest of a room's catalogue (user guide, "Files"): it adds the next page to the
          ones already listed. Without a cursor there is no next page to ask for, so it says so instead. */}
      {tail.has_more ? (
        <div className="px-2">
          {tail.next_cursor ? (
            <Button variant="outline" size="sm" disabled={loading} onClick={onMore}>
              Load more files
            </Button>
          ) : (
            <ComingNote>This room has more files than are listed here.</ComingNote>
          )}
        </div>
      ) : null}
    </div>
  )
}

function FileRow({ file, now, roomId }: { file: RoomFile; now: number; roomId: string }) {
  const Icon = file.mime?.startsWith('image/') ? FileImage : file.mime?.startsWith('text/') ? FileText : File
  const profile = useSettings((state) => state.settings.profile)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  // Jam Desktop's line under a file's name: who shared it, its age, then its size ("from You · 9h · 192 B"). The type
  // is not repeated there: the icon carries it.
  const details = [
    sharedBy(file),
    file.created_at ? shortAge(file.created_at, now) : null,
    file.bytes !== undefined ? byteSize(file.bytes) : null,
  ].filter(Boolean)

  const run = (act: () => Promise<string | null>) => {
    if (busy) return
    setBusy(true)
    setSaid(null)
    act()
      .then((message) => setSaid(message))
      .catch(() => setSaid('That did not work. The file may be gone, or the daemon may not have answered.'))
      .finally(() => setBusy(false))
  }

  const act = (action: 'open' | 'reveal') =>
    run(async () => {
      const api = jam()
      if (!api) return null
      const result = await api.files.act({ profile, id: file.id, action })
      if (result.done) return null
      // Opening is what runs a program, so this app shows a runnable file in its folder instead and says why.
      if (result.reason === 'runnable') return 'This file would run rather than open, so it is shown in its folder.'
      // Jam not answering is not the same as this computer having no copy, and is never reported as one.
      if (result.reason === 'unavailable') return 'Band did not answer, so this file was not opened.'
      if (result.reason === 'elsewhere') return 'This file is not stored on this computer.'
      // A copy that is here and will not open is a different thing from no copy, and is never reported as one.
      if (result.reason === 'unopenable') return 'This computer could not open this file.'
      return 'This computer has no copy of this file.'
    })

  return (
    <li className="group/file flex flex-col gap-1 rounded-lg px-2 py-2">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-foreground-subtle [&_svg]:size-4">
          <Icon aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-ui-base font-medium text-foreground">{file.name}</div>
          <div className="truncate text-ui-sm text-foreground-subtle">{details.join(' · ')}</div>
        </div>
        {/* Jam's five actions, in its order: Open, Verify, Save a copy, Reveal, Delete. Delete stands only for a file
            this computer alone holds (user guide, "Files"). */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/file:opacity-100 focus-within:opacity-100">
          <FileActionButton
            label={`Open ${file.name}`}
            icon={<SquareArrowOutUpRight />}
            busy={busy}
            onAct={() => act('open')}
          />
          <FileActionButton
            label={`Verify ${file.name}`}
            icon={<ShieldCheck />}
            busy={busy}
            onAct={() =>
              run(async () => {
                const api = jam()
                if (!api) return null
                return VERDICTS[await api.files.verify({ profile, id: file.id })]
              })
            }
          />
          <FileActionButton
            label={`Save a copy of ${file.name}`}
            icon={<Download />}
            busy={busy}
            onAct={() =>
              run(async () => {
                const api = jam()
                if (!api) return null
                await api.daemon.fileSaveCopy({ profile, id: file.id })
                return 'Saved a copy to Downloads.'
              })
            }
          />
          <FileActionButton
            label={`Reveal ${file.name}`}
            icon={<FolderOpen />}
            busy={busy}
            onAct={() => act('reveal')}
          />
          {file.local_only ? (
            <FileActionButton
              label={`Delete ${file.name}`}
              icon={<Trash2 />}
              busy={busy}
              onAct={() => setDeleting(true)}
            />
          ) : null}
        </div>
      </div>
      {said ? (
        <p role="status" className="pl-11 text-ui-sm text-foreground-subtle">
          {said}
        </p>
      ) : null}
      {/* Deleting this computer's only copy cannot be undone, so it is asked about, as Delete room is. */}
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent className="max-w-110">
          <DialogHeader>
            <DialogTitle>Delete this file?</DialogTitle>
          </DialogHeader>
          <p className="text-ui-base text-foreground-subtle">
            {file.name} is stored only on this computer. Deleting it cannot be undone, and earlier local links to it
            stop working.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => {
                setDeleting(false)
                run(async () => {
                  const api = jam()
                  if (!api) return null
                  // What a delete would break is read first, so a file a room takes its plan from is never lost blind.
                  const preview = await api.daemon.fileDeletePreview({ profile, id: file.id })
                  if (preview.plans > 0) {
                    const rooms =
                      preview.plans === 1 ? 'a room takes its plan' : `${preview.plans} rooms take their plan`
                    return `Not deleted: ${rooms} from this file. Remove the plan from it first.`
                  }
                  await api.daemon.fileDelete({ profile, id: file.id, impactToken: preview.impactToken })
                  // The room is read again for page one, and the file is taken out of the pages read after it -
                  // those are kept across a read on purpose, so it would otherwise sit there deleted.
                  useRoomStore.getState().forgetFile(profile, roomId, file.id)
                  void useRoomStore.getState().load(profile, roomId)
                  return 'Deleted from this computer. Earlier local links to it stop working.'
                })
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  )
}

/** The plan rail's content: the plan's label, where it comes from, any error, and its text. */
function PlanView({ plan, roomId, now }: { plan: RoomPlan; roomId: string; now: number }) {
  const profile = useSettings((state) => state.settings.profile)
  const problem = usePlanProblem('pane', roomId)
  if (!plan.source && !plan.cache) {
    return (
      <div className="flex flex-col items-start gap-2 px-2 py-3">
        <p className="text-ui-base font-medium text-foreground">No plan yet</p>
        <p className="text-ui-base text-pretty text-foreground-subtle">
          Each room can have one plan: Markdown text, an architecture diagram, or both.
        </p>
        <ChoosePlanFile profile={profile} roomId={roomId} where="pane" />
        {problem ? (
          <p role="status" className="text-ui-sm text-foreground-subtle">
            {problem}
          </p>
        ) : null}
      </div>
    )
  }
  const details = [
    plan.source?.kind === 'markdown' ? 'Markdown' : plan.source?.kind,
    plan.source?.snapshot ? 'Snapshot' : plan.source ? 'Follows its file' : null,
    plan.updated_at ? `updated ${shortAge(plan.updated_at, now)}` : null,
  ].filter(Boolean)
  return (
    <article aria-label="Plan" className="flex flex-col gap-3 px-2 pt-2">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-ui-lg font-semibold text-foreground">{plan.source?.label || 'Plan'}</h2>
          {details.length > 0 ? <p className="text-ui-sm text-foreground-subtle">{details.join(' · ')}</p> : null}
        </div>
        <PlanActions plan={plan} profile={profile} roomId={roomId} where="pane" />
      </header>
      {problem ? (
        <p role="status" className="text-ui-sm text-foreground-subtle">
          {problem}
        </p>
      ) : null}
      {plan.refreshFailed ? (
        <Note>
          {plan.cache
            ? 'Band could not refresh this plan from its file, so the last good copy is shown.'
            : 'Band could not read this plan from its file.'}
        </Note>
      ) : null}
      <PlanText plan={plan} />
    </article>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-surface px-3 py-2 text-ui-sm text-pretty text-foreground-subtle">{children}</p>
}
