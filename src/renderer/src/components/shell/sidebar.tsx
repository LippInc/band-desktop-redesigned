import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  FolderInput,
  FolderPlus,
  ListFilter,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Settings as SettingsIcon,
  Trash2,
} from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import { SECTION_EXPERIMENTS, type Participant, type Room } from '@shared/daemon'
import { DEFAULT_SETTINGS, SETTINGS_LIMITS } from '@shared/settings'
import { commandById, useCommands } from '@/commands/use-commands'
import { BrandMark } from '@/components/shell/brand-mark'
import { IconButton } from '@/components/shell/icon-button'
import { NavButtonRow, NavLinkRow, RailButton, RailLink } from '@/components/shell/nav-row'
import { ResizeHandle } from '@/components/shell/resize-handle'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { inboxCount } from '@/lib/inbox'
import { jam } from '@/lib/platform'
import { ALL_SCOPES, allScopesOn, filterRooms, ROOM_SCOPES, type RoomScopes } from '@/lib/room-filter'
import {
  folderIdOf,
  foldersOf,
  FOLDER_NAME_MAX,
  groupRooms,
  isPinned,
  withCollapsed,
  withFolder,
  withNewFolder,
  withPinned,
} from '@/lib/room-org'
import { initialsOf, roomMoment, roomTime, sortRooms } from '@/lib/rooms'
import { useOrgProblem, useRoomOrg } from '@/lib/use-room-org'
import { SECTIONS, SETTINGS_SECTIONS, type Section } from '@/lib/sections'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'
import { useAccount, useDaemon, useExperiment, useShellPart } from '@/stores/daemon'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'

/** A folded sidebar's width on a wide window: Jam's rail of section icons. */
export const RAIL_WIDTH = 48

/**
 * ZCode's sidebar (docs/DESIGN.md, "Sidebar"), holding Jam's sections: 264 wide on the window's canvas, a 48 top row with
 * Jam's Toggle sidebar, the mark and history, the daily sections as rows, the room list where ZCode keeps its tasks,
 * Jam's Network group and Documentation above the footer, and the account with Settings at the bottom. In Settings it
 * swaps to settings navigation, as ZCode's. Folded on a wide window it leaves Jam's rail: each section as an icon.
 */
export function Sidebar({ mode, drawer }: { mode: 'workspace' | 'settings'; drawer: { open: boolean } | null }) {
  const { sidebarOpen, sidebarWidth } = useSettings((state) => state.settings)
  const update = useSettings((state) => state.update)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const width = dragWidth ?? sidebarWidth
  const open = drawer ? drawer.open : sidebarOpen
  const rail = !drawer && !open
  const aside = useRef<HTMLElement>(null)
  useDrawerFocus(aside, drawer?.open ?? false)
  useFoldFocus(aside, rail, Boolean(drawer))

  return (
    <aside
      ref={aside}
      aria-label="Sidebar"
      data-open={open}
      data-drawer={drawer ? 'true' : undefined}
      data-rail={rail ? 'true' : undefined}
      tabIndex={drawer?.open ? -1 : undefined}
      style={{
        width: open ? width : rail ? RAIL_WIDTH : 0,
        maxWidth: drawer ? '85vw' : undefined,
        ...({ '--sidebar-width': `${width}px` } as CSSProperties),
      }}
      className={cn(
        'h-full shrink-0 overflow-hidden bg-canvas outline-none',
        // On a narrow window it opens over the page, as Jam's room drawer does, above the backdrop.
        drawer ? 'absolute inset-y-0 left-0 z-40 shadow-popover' : 'relative',
        dragWidth === null && 'transition-[width] duration-200 ease-out',
      )}
    >
      {/* Folded or closed, its rows are hidden, not only clipped to no width: a clipped row still takes Tab stops, and a
          clipped top row still lays its drag region over the title bar's buttons (the window's drag regions ignore
          clipping). They hide once the fold has finished (the transition is on closing only: one on opening would start
          from hidden), and show as soon as it opens. */}
      <div
        style={{ width }}
        className={cn('flex h-full flex-col', !open && 'invisible transition-[visibility] duration-200')}
      >
        <SidebarTopRow start="toggle-mark" end={drawer ? 'hide-rooms' : 'none'} />
        {mode === 'workspace' ? <WorkspaceNavigation /> : <SettingsNavigation />}
        <SidebarFooter mode={mode} />
      </div>
      {/* The rail lies over the folding sidebar's left edge, so the fold slides the sidebar away under it. */}
      {rail ? <Rail mode={mode} /> : null}
      {open && !drawer ? (
        <ResizeHandle
          edge="right"
          label="Resize sidebar"
          width={width}
          min={SETTINGS_LIMITS.sidebarWidth.min}
          max={SETTINGS_LIMITS.sidebarWidth.max}
          defaultWidth={DEFAULT_SETTINGS.sidebarWidth}
          onResize={setDragWidth}
          onCommit={(next) => {
            setDragWidth(null)
            void update({ sidebarWidth: next })
          }}
        />
      ) : null}
    </aside>
  )
}

/**
 * An open drawer takes focus, as a dialog does, and gives it back when it closes: where it was, or, when nothing had it
 * or that is gone, to the title bar's Toggle sidebar, which opens the drawer. Focus that moved on to something outside
 * the drawer meanwhile stays where it is.
 */
function useDrawerFocus(drawer: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    const node = drawer.current
    if (!open || !node) return
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    node.focus({ preventScroll: true })
    return () => {
      const now = document.activeElement
      if (now !== null && now !== document.body && !node.contains(now)) return
      const back =
        before?.isConnected && before !== document.body
          ? before
          : document.querySelector<HTMLElement>('header [data-sidebar-toggle]')
      back?.focus({ preventScroll: true })
    }
  }, [drawer, open])
}

/**
 * When the sidebar folds or opens under the keyboard's focus (its toggle, a row, Ctrl+B pressed there), focus moves to
 * the toggle that shows now: the rows hide 200 ms after a fold, and the rail leaves at once when the sidebar opens, and
 * either would drop focus to the page's body. Focus elsewhere (a field on the page) stays where it is.
 */
function useFoldFocus(aside: RefObject<HTMLElement | null>, rail: boolean, drawer: boolean) {
  const inside = useRef(false)
  useEffect(() => {
    const node = aside.current
    if (!node || drawer) return
    const onIn = () => {
      inside.current = true
    }
    // A focused control that is removed (the rail leaving as the sidebar opens) loses focus in the middle of React's
    // commit, before the layout effect below hands focus on; so whether focus left is settled after that, not here.
    const onOut = () => {
      queueMicrotask(() => {
        inside.current = node.contains(document.activeElement)
      })
    }
    node.addEventListener('focusin', onIn)
    node.addEventListener('focusout', onOut)
    return () => {
      node.removeEventListener('focusin', onIn)
      node.removeEventListener('focusout', onOut)
    }
  }, [aside, drawer])
  useLayoutEffect(() => {
    const node = aside.current
    if (!node || drawer || !inside.current) return
    const toggle = rail
      ? node.querySelector<HTMLElement>('[data-slot=rail] [data-sidebar-toggle]')
      : node.querySelector<HTMLElement>(':scope > div:first-child [data-sidebar-toggle]')
    toggle?.focus({ preventScroll: true })
  }, [aside, rail, drawer])
}

/**
 * The sidebar's top row, 48 tall in the drag region: Jam's Toggle sidebar first, where it stays in every state (the
 * rail's top and the title bar of a narrow window hold it at the same place, as Jam's and ZCode's toggles stay put), the
 * mark, then back and forward, 28 each and 4 apart (the command registry's, shortcut included), and in the drawer of a
 * narrow window Jam's "Hide rooms" at the end. The title bar reuses it while the sidebar is not beside the page: history
 * alone beside the rail, and the toggle first on a narrow window, which opens the drawer.
 */
export function SidebarTopRow({
  className,
  slot = 'window-start',
  start,
  end,
}: {
  className?: string
  /** Where the row starts on the window, for the room macOS's window buttons take there (globals.css). */
  slot?: 'window-start' | 'window-start-after-rail'
  start: 'toggle-mark' | 'toggle' | 'none'
  end: 'hide-rooms' | 'none'
}) {
  const commands = useCommands()
  const setDrawerOpen = useUi((state) => state.setDrawerOpen)
  return (
    <div data-slot={slot} className={cn('flex h-12 shrink-0 items-center gap-1 px-2 drag-region', className)}>
      {start === 'none' ? null : <SidebarToggle />}
      {start === 'toggle-mark' ? <Mark /> : null}
      {['go:back', 'go:forward'].map((id) => {
        const command = commandById(commands, id)
        return (
          <IconButton
            key={id}
            label={command.label}
            shortcut={command.shortcut}
            className="text-foreground-subtle no-drag"
            onClick={command.run}
          >
            <command.icon />
          </IconButton>
        )
      })}
      {end === 'hide-rooms' ? (
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-foreground-subtle no-drag"
          onClick={() => setDrawerOpen(false)}
        >
          Hide rooms
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Jam's Toggle sidebar, a panel button (Jam Desktop 0.4.10): it folds the sidebar to the rail and back, or opens and
 * closes the drawer of a narrow window. The registry's command, with its label and shortcut. A closed drawer gives focus
 * back to the title bar's, and a fold to the one that shows (`data-sidebar-toggle`).
 */
function SidebarToggle() {
  const command = commandById(useCommands(), 'panels:sidebar')
  return (
    <IconButton
      label={command.label}
      shortcut={command.shortcut}
      className="text-foreground-subtle no-drag"
      onClick={command.run}
      data-sidebar-toggle=""
    >
      <command.icon />
    </IconButton>
  )
}

/**
 * The mark, Band's mascot. It no longer folds the sidebar, as ZCode's Z does: Jam's own button does that,
 * and two controls with one name would repeat each other (docs/DESIGN.md, "Deliberate differences from ZCode").
 */
function Mark() {
  return (
    <span data-slot="mark" className="flex size-7 shrink-0 items-center justify-center">
      <BrandMark />
    </span>
  )
}

/**
 * Jam's rail, left by a folded sidebar on a wide window: Toggle sidebar in the top row, then each section as an icon in
 * the sidebar's order, a line where Jam's Network group starts, and Documentation and Settings at the foot. Rooms opens
 * the sidebar, where the room list lives. In Settings it holds Back to home and the settings pages.
 */
function Rail({ mode }: { mode: 'workspace' | 'settings' }) {
  return (
    <div data-slot="rail" className="absolute inset-y-0 left-0 z-10 flex w-12 flex-col items-center bg-canvas">
      <div data-slot="rail-top" className="flex h-12 w-full shrink-0 items-center justify-center drag-region">
        <SidebarToggle />
      </div>
      {mode === 'workspace' ? <WorkspaceRail /> : <SettingsRail />}
    </div>
  )
}

function WorkspaceRail() {
  const commands = useCommands()
  const home = commandById(commands, 'go:home')
  const search = commandById(commands, 'search')
  const toggle = commandById(commands, 'panels:sidebar')
  const shown = useShownSection()
  const inRooms = useRouterState({ select: (state) => state.location.pathname.startsWith('/rooms') })
  const rooms = SECTIONS.find((section) => section.id === 'rooms')
  const daily = SECTIONS.filter((section) => section.group === 'daily' && shown(section))
  const network = SECTIONS.filter((section) => section.group === 'network' && shown(section))
  const advanced = SECTIONS.filter((section) => section.group === 'advanced' && shown(section))
  const more = SECTIONS.filter((section) => section.group === 'more' && shown(section))
  return (
    <nav
      aria-label="Sections"
      className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto pt-2 pb-3"
    >
      {daily.slice(0, 1).map((section) => (
        <RailLink
          key={section.id}
          to={section.path}
          icon={section.icon}
          label={section.label}
          shortcut={home.shortcut}
        />
      ))}
      <RailButton icon={search.icon} label={search.label} shortcut={search.shortcut} onClick={search.run} />
      {/* Jam's rail order: Home, Agents, Rooms, Analytics, then its Network and Advanced groups. */}
      {daily
        .slice(1)
        .filter((section) => section.id !== 'analytics')
        .map((section) => (
          <RailLink key={section.id} to={section.path} icon={section.icon} label={section.label} />
        ))}
      {rooms ? <RailButton icon={rooms.icon} label={rooms.label} active={inRooms} onClick={toggle.run} /> : null}
      {daily
        .filter((section) => section.id === 'analytics')
        .map((section) => (
          <RailLink key={section.id} to={section.path} icon={section.icon} label={section.label} />
        ))}
      <div aria-hidden="true" className="my-1.5 h-px w-5 shrink-0 bg-line" />
      {network.map((section) => (
        <RailLink
          key={section.id}
          to={section.path}
          icon={section.icon}
          label={section.label}
          badge={section.id === 'sonar' ? <SonarDot className="absolute top-1 right-1" /> : null}
        />
      ))}
      {advanced.map((section) => (
        <RailLink key={section.id} to={section.path} icon={section.icon} label={section.label} />
      ))}
      <span className="flex-1" />
      {more.map((section) => (
        <RailLink key={section.id} to={section.path} icon={section.icon} label={section.label} />
      ))}
      <RailLink to="/settings/$section" params={{ section: 'account' }} icon={SettingsIcon} label="Settings" />
    </nav>
  )
}

function SettingsRail() {
  return (
    <nav
      aria-label="Settings"
      className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto pt-2 pb-3"
    >
      <RailLink to="/" icon={ArrowLeft} label="Back to home" />
      <div aria-hidden="true" className="my-1.5 h-px w-5 shrink-0 bg-line" />
      {SETTINGS_GROUPS.flatMap((group) => group.ids).map((id) => {
        const page = SETTINGS_SECTIONS.find((item) => item.id === id)
        if (!page) return null
        return (
          <RailLink
            key={page.id}
            to="/settings/$section"
            params={{ section: page.id }}
            icon={page.icon}
            label={page.label}
          />
        )
      })}
    </nav>
  )
}

/** Whether a section shows: always, or while its experiment is on, as in the official app. */
function useShownSection() {
  const inbox = useExperiment(SECTION_EXPERIMENTS.inbox)
  const sessions = useExperiment(SECTION_EXPERIMENTS.sessions)
  return (section: Section) =>
    !section.experiment ||
    (section.experiment === SECTION_EXPERIMENTS.inbox && inbox) ||
    (section.experiment === SECTION_EXPERIMENTS.sessions && sessions)
}

function WorkspaceNavigation() {
  const commands = useCommands()
  const home = commandById(commands, 'go:home')
  const search = commandById(commands, 'search')
  const shown = useShownSection()
  const advanced = SECTIONS.filter((section) => section.group === 'advanced' && shown(section))
  const inbox = useDaemon((state) => state.inbox)
  const inboxWaiting = useMemo(() => inboxCount(inbox), [inbox])
  const daily = SECTIONS.filter((section) => section.group === 'daily' && shown(section))
  const network = SECTIONS.filter((section) => section.group === 'network' && shown(section))
  const more = SECTIONS.filter((section) => section.group === 'more' && shown(section))

  return (
    <>
      <nav aria-label="Primary" className="flex shrink-0 flex-col gap-1 p-2">
        {daily.slice(0, 1).map((section) => (
          <NavLinkRow
            key={section.id}
            to={section.path}
            icon={section.icon}
            label={section.label}
            shortcut={home.shortcut}
          />
        ))}
        <NavButtonRow icon={search.icon} label={search.label} shortcut={search.shortcut} onClick={search.run} />
        {daily.slice(1).map((section) => (
          <NavLinkRow key={section.id} to={section.path} icon={section.icon} label={section.label} />
        ))}
      </nav>
      <RoomList />
      <nav aria-label="Network" className="flex shrink-0 flex-col gap-1 px-2 pb-2">
        <h2 className="flex h-7 items-center px-2.5 text-ui-base font-medium text-foreground-subtlest">Network</h2>
        {network.map((section) => (
          <NavLinkRow
            key={section.id}
            to={section.path}
            icon={section.icon}
            label={section.label}
            trailing={section.id === 'sonar' ? <SonarDot /> : null}
          />
        ))}
      </nav>
      {advanced.length > 0 ? (
        <nav aria-label="Advanced" className="flex shrink-0 flex-col gap-1 px-2 pb-2">
          <h2 className="flex h-7 items-center px-2.5 text-ui-base font-medium text-foreground-subtlest">Advanced</h2>
          {advanced.map((section) => (
            <NavLinkRow key={section.id} to={section.path} icon={section.icon} label={section.label} />
          ))}
        </nav>
      ) : null}
      <nav aria-label="More sections" className="flex shrink-0 flex-col gap-1 px-2 pb-2">
        {more.map((section) => (
          <NavLinkRow
            key={section.id}
            to={section.path}
            icon={section.icon}
            label={section.label}
            // Jam counts what waits in Inbox beside its name, visible and queued alike (user guide, "Inbox").
            count={section.id === 'inbox' && inboxWaiting > 0 ? inboxWaiting : undefined}
          />
        ))}
      </nav>
    </>
  )
}

/** Jam's green dot beside Sonar (on its icon in the rail): this computer is discoverable on the local network. */
function SonarDot({ className = 'mr-0.5' }: { className?: string }) {
  const discoverable = useDaemon((state) => state.sonar.state === 'ready' && state.sonar.data.discoverable)
  if (!discoverable) return null
  // Named as Jam Desktop names it.
  return (
    <span role="img" aria-label="Discovery on" className={cn('size-1.5 shrink-0 rounded-full bg-success', className)} />
  )
}

/**
 * The room list, where ZCode lists its tasks: the rooms the account is in, newest first (user guide, "Room order"), under
 * Jam Desktop's heading "Rooms", a 28 tall heading that folds; each row a title with its short age on the right, as
 * ZCode's task rows. Jam Desktop 0.4.10 shows this one list, with an agent in a room too (its guide also names Agent
 * rooms, rooms of the account's local agents the person only observes; none has been seen). The pinned rooms and the
 * folders come from the account's room organisation, which the official Jam app shares (`@/lib/room-org`).
 */
function RoomList() {
  const rooms = useShellPart('rooms')
  const agents = useShellPart('agents')
  const people = useDaemon((state) => state.roomPeople)
  const navigate = useNavigate()
  const now = useNow()
  const profile = useSettings((state) => state.settings.profile)
  const selfId = useAccount(profile)?.identity?.user_id ?? null
  const [text, setText] = useState('')
  const [scopes, setScopes] = useState<RoomScopes>(ALL_SCOPES)
  const [making, setMaking] = useState(false)
  const [makeProblem, setMakeProblem] = useState<string | null>(null)
  // A change to the organisation is made from any of several controls in this list; whichever failed, it says so
  // once, here. A refusal from Home's own Archive belongs to Home and is said there.
  const orgProblem = useOrgProblem('rooms')

  const sorted = useMemo(() => (rooms.state === 'ready' ? sortRooms(rooms.data) : []), [rooms])
  const shown = useMemo(
    () =>
      filterRooms({
        rooms: sorted,
        people,
        agents: agents.state === 'ready' ? agents.data.rows : [],
        selfId,
        text,
        scopes,
      }),
    [sorted, people, agents, selfId, text, scopes],
  )
  const narrowed = text.trim() !== '' || !allScopesOn(scopes)

  // Jam opens a new room and shows it at once: a room with no message takes its place from when it was made, which is
  // the top of the list (user guide, "Room order"). It is called "New Session" until it is renamed.
  const newRoom = () => {
    const api = jam()
    if (!api || making) return
    setMaking(true)
    setMakeProblem(null)
    api.daemon
      .createRoom({ profile })
      .then((room) => {
        void useDaemon.getState().refresh(profile)
        void navigate({ to: '/rooms/$roomId', params: { roomId: room.id } })
      })
      .catch(() => setMakeProblem('Band could not make that room.'))
      .finally(() => setMaking(false))
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-2" aria-label="Rooms">
      <RoomSection
        title="Rooms"
        action={
          <>
            <IconButton label="New room" size="icon-xs" className="text-foreground-subtle" onClick={newRoom}>
              <Plus />
            </IconButton>
            <NewFolderButton />
            <RoomFilter text={text} onText={setText} scopes={scopes} onScopes={setScopes} narrowed={narrowed} />
          </>
        }
      >
        {rooms.state === 'ready' ? (
          shown.length > 0 ? (
            <RoomBands rooms={shown} now={now} profile={profile} selfId={selfId} />
          ) : (
            <MutedRow>{narrowed ? 'No rooms match' : 'No rooms yet'}</MutedRow>
          )
        ) : (
          <MutedRow>{rooms.state === 'unavailable' ? 'Rooms are unavailable' : 'Loading…'}</MutedRow>
        )}
        {makeProblem ? <MutedRow>{makeProblem}</MutedRow> : null}
        {orgProblem ? <MutedRow>{orgProblem}</MutedRow> : null}
      </RoomSection>
    </div>
  )
}

/**
 * The rooms in their bands: the pinned ones at the top, then each folder with the rooms filed in it, then the rest.
 * A pinned room keeps its own row, marked, rather than sitting under a heading: Jam's own heading for that band, if
 * it has one, was never seen, and inventing one would put a word on screen that Jam does not say.
 */
function RoomBands({
  rooms,
  now,
  profile,
  selfId,
}: {
  rooms: readonly Room[]
  now: number
  profile: string
  selfId: string | null
}) {
  const { org, busy, change } = useRoomOrg('rooms')
  if (!org) {
    return rooms.map((room) => <RoomRow key={room.id} room={room} now={now} profile={profile} selfId={selfId} />)
  }
  const groups = groupRooms(rooms, org)
  const row = (room: Room, pinned = false) => (
    <RoomRow key={room.id} room={room} now={now} profile={profile} selfId={selfId} pinned={pinned} />
  )
  return (
    <>
      {groups.pinned.map((room) => row(room, true))}
      {groups.folders.map(({ folder, rooms: inside, collapsed }) => (
        <li key={folder.id} className="list-none">
          <button
            type="button"
            disabled={busy}
            data-folder={folder.id}
            aria-expanded={!collapsed}
            onClick={() => change((one) => withCollapsed(one, folder.id, !collapsed))}
            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-ui-sm text-foreground-subtle hover:bg-hover"
          >
            {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            <Folder className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            <span className="tabular-nums">{inside.length}</span>
          </button>
          {collapsed ? null : <ul className="pl-3">{inside.map((room) => row(room))}</ul>}
        </li>
      ))}
      {groups.loose.map((room) => row(room))}
    </>
  )
}

/** Jam's New folder, beside New room in the room list's header. Jam's own naming step was never seen. */
function NewFolderButton() {
  const { org, busy, change } = useRoomOrg('rooms')
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const make = () => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    change((one) => withNewFolder(one, trimmed, crypto.randomUUID()).org)
    setNaming(false)
    setName('')
  }
  return (
    <>
      <IconButton
        label="New folder"
        size="icon-xs"
        className="text-foreground-subtle"
        disabled={org === null || busy}
        onClick={() => {
          setName('')
          setNaming(true)
        }}
      >
        <FolderPlus />
      </IconButton>
      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent className="max-w-100">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
          </DialogHeader>
          <input
            value={name}
            maxLength={FOLDER_NAME_MAX}
            aria-label="Folder name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && make()}
            className="h-9 w-full rounded-xl border border-line bg-input px-3 text-ui-base text-foreground outline-none select-text"
          />
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={make} disabled={name.trim() === '' || busy}>
              Create folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Jam's "Filter and search rooms": one field over "Show" and its four switches, all on until one is turned off. */
function RoomFilter({
  text,
  onText,
  scopes,
  onScopes,
  narrowed,
}: {
  text: string
  onText(text: string): void
  scopes: RoomScopes
  onScopes(scopes: RoomScopes): void
  narrowed: boolean
}) {
  return (
    <Popover>
      {/* A plain button, not IconButton: that one is already a tooltip trigger, and two triggers cannot share one
          element - the popover would never open. */}
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Filter and search rooms"
            className={narrowed ? 'text-brand-text' : 'text-foreground-subtle'}
          >
            <ListFilter />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-72 p-2">
        <input
          type="search"
          aria-label="Rooms, participants, id"
          placeholder="Rooms, participants, id"
          value={text}
          onChange={(event) => onText(event.target.value)}
          className="h-8 w-full rounded-lg border border-line bg-background px-2.5 text-ui-base text-foreground outline-none select-text placeholder:text-foreground-subtlest"
        />
        <p className="px-1 pt-3 pb-1.5 text-ui-sm text-foreground-subtle">Show</p>
        <ul className="flex flex-col">
          {ROOM_SCOPES.map((scope) => (
            <li key={scope.id}>
              <Checkbox
                checked={scopes[scope.id]}
                onCheckedChange={(on) => onScopes({ ...scopes, [scope.id]: on === true })}
                className="w-full rounded-lg px-1 py-1.5 hover:bg-hover"
              >
                <span className="min-w-0">
                  <span className="block text-ui-base text-foreground">{scope.label}</span>
                  <span className="block text-ui-sm text-foreground-subtle">{scope.note}</span>
                </span>
              </Checkbox>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/**
 * A room row: ZCode's task row, the title in line with the rows' labels above it, then what Jam Desktop's own room row
 * carries — its people's avatars and the time of its newest message.
 */
function RoomRow({
  room,
  now,
  profile,
  selfId,
  pinned = false,
}: {
  room: Room
  now: number
  profile: string
  selfId: string | null
  /** A pinned room keeps its own row at the top of the list, marked so it is clear why it is there. */
  pinned?: boolean
}) {
  const moment = roomMoment(room)
  const people = useDaemon((state) => state.roomPeople[room.id])
  return (
    <li className="group/room relative">
      {/* In the row's own left gutter, so a pinned room does not sit wider than the rest. */}
      {pinned ? (
        <>
          <Pin aria-hidden className="pointer-events-none absolute top-2.5 left-3 size-3 text-foreground-subtlest" />
          <span className="sr-only">Pinned</span>
        </>
      ) : null}
      <Link
        to="/rooms/$roomId"
        params={{ roomId: room.id }}
        className="flex h-8 items-center gap-2 rounded-lg pr-2.5 pl-8.5 text-ui-base text-foreground transition-colors outline-none"
        activeProps={{ className: 'bg-selected', 'aria-current': 'page' }}
        inactiveProps={{ className: 'hover:bg-surface-hover' }}
      >
        <span data-slot="room-title" className="min-w-0 flex-1 truncate">
          {room.title}
        </span>
        <RoomAvatars people={people} />
        {moment !== null ? (
          <span className="shrink-0 text-ui-xs text-foreground-subtlest tabular-nums">{roomTime(moment, now)}</span>
        ) : null}
      </Link>
      <RoomActions room={room} profile={profile} selfId={selfId} known={people} />
    </li>
  )
}

/**
 * Jam's own menu on a room's row, which it calls "Session actions" (Jam Desktop 0.4.10): Rename, then Pin, Move to
 * folder, New with same participants, Open beside and Open in new window, then Delete room. What this app offers of
 * that, and why the rest is not here yet, is in `docs/jam/differences.md`.
 */
function RoomActions({
  room,
  profile,
  selfId,
  known,
}: {
  room: Room
  profile: string
  selfId: string | null
  /** The participants the sidebar already had for this room, if it is one of the newest it reads. */
  known: Participant[] | undefined
}) {
  const navigate = useNavigate()
  const openRoom = useRouterState({ select: (state) => state.location.pathname })
  const { org, busy: orgBusy, change } = useRoomOrg('rooms')
  const pinned = org ? isPinned(org, room.id) : false
  const folders = org ? foldersOf(org) : []
  const inFolder = org ? folderIdOf(org, room.id) : null
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [title, setTitle] = useState(room.title)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  /** What a room made from this one could not carry over, which Jam reports rather than leaving to be noticed. */
  const [missed, setMissed] = useState<string | null>(null)
  // The sidebar reads the participants of only the newest rooms (stores/daemon.ts), so an older room has none in
  // hand and nothing here could be said about it. The menu asks for that one room's when it opens, rather than
  // leaving Rename and Delete room switched off for the owner of a room that happens to be far down the list.
  const [asked, setAsked] = useState<Participant[] | null>(null)
  const people = known ?? asked ?? undefined
  const readPeople = () => {
    const api = jam()
    if (!api || known || asked) return
    void api.daemon
      .roomParticipants({ profile, roomId: room.id })
      .then((list) => setAsked(list))
      .catch(() => {})
  }

  const owned = selfId !== null && people?.some((person) => person.role === 'owner' && person.id === selfId) === true
  const unread = people === undefined
  /** Who a room made from this one would carry over: the same list the action itself uses. */
  const carryOver = (people ?? []).filter((person) => person.role !== 'owner' && person.id !== selfId)

  const done = () => {
    setBusy(false)
    void useDaemon.getState().refresh(profile)
  }

  const rename = () => {
    const api = jam()
    if (!api || !title.trim() || busy) return
    setBusy(true)
    setProblem(null)
    api.daemon
      .renameRoom({ profile, roomId: room.id, title: title.trim() })
      .then(() => {
        setRenaming(false)
        done()
      })
      .catch(() => {
        setBusy(false)
        setProblem('Band could not rename this room. Only its owner can.')
      })
  }

  const remove = () => {
    const api = jam()
    if (!api || busy) return
    setBusy(true)
    setProblem(null)
    api.daemon
      .deleteRoom({ profile, roomId: room.id })
      .then(() => {
        setDeleting(false)
        done()
        // Only the room being read is left; deleting another from the list must not throw the person out of it.
        if (openRoom === `/rooms/${room.id}`) void navigate({ to: '/' })
      })
      .catch(() => {
        setBusy(false)
        setProblem('Band could not delete this room. Only its owner can.')
      })
  }

  // Jam's "New with same participants": a new room with the same people and agents, its owner aside.
  const withSamePeople = () => {
    const api = jam()
    // Jam carries over "the same non-owner participants" (user guide). The person themselves is not among them:
    // they own the room that was just made. In a room they do not own, the owner is someone else and stays behind,
    // which is Jam's own rule rather than an oversight.
    const others = (people ?? []).filter((person) => person.role !== 'owner' && person.id !== selfId)
    // A room with nobody in it is not "the same participants": without them in hand, or with none to carry over,
    // this does nothing rather than opening an empty room under that name.
    if (!api || busy || people === undefined || others.length === 0) return
    setBusy(true)
    setProblem(null)
    api.daemon
      .createRoom({ profile })
      .then(async (made) => {
        let missed = 0
        for (const person of others) {
          const added = await api.daemon
            .addRoomParticipant({ profile, roomId: made.id, participantId: person.id })
            .then(() => true)
            .catch(() => false)
          if (!added) missed += 1
        }
        done()
        void navigate({ to: '/rooms/$roomId', params: { roomId: made.id } })
        // Jam reports a partial failure rather than leaving the person to notice it; so does this.
        if (missed > 0) {
          setMissed(
            missed === others.length
              ? 'The room was made, but nobody could be added to it.'
              : `The room was made, but ${missed} of ${others.length} could not be added to it.`,
          )
        }
      })
      .catch(() => {
        setBusy(false)
        setProblem('Band could not make that room.')
      })
  }

  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && readPeople()}>
        <DropdownMenuTrigger
          render={
            <IconButton
              label="Session actions"
              size="icon-xs"
              className="absolute top-1 right-1 text-foreground-subtle opacity-0 transition-opacity group-hover/room:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
            >
              <MoreHorizontal />
            </IconButton>
          }
        />
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem
            disabled={unread || !owned}
            onClick={() => {
              setTitle(room.title)
              setProblem(null)
              setRenaming(true)
            }}
          >
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Jam's own order on this menu: Rename, then Pin and Move to folder, then New with same participants. */}
          <DropdownMenuItem
            disabled={org === null || orgBusy}
            onClick={() => change((one) => withPinned(one, room.id, !pinned))}
          >
            {pinned ? <PinOff /> : <Pin />}
            {pinned ? 'Unpin' : 'Pin'}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={org === null || orgBusy}>
              <FolderInput />
              Move to folder
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              {folders.length === 0 ? (
                <DropdownMenuItem disabled>No folders yet</DropdownMenuItem>
              ) : (
                folders.map((folder) => (
                  <DropdownMenuItem
                    key={folder.id}
                    onClick={() => change((one) => withFolder(one, room.id, folder.id))}
                  >
                    {inFolder === folder.id ? <Check /> : <span className="size-4" />}
                    {folder.name}
                  </DropdownMenuItem>
                ))
              )}
              {inFolder === null ? null : (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => change((one) => withFolder(one, room.id, null))}>
                    <span className="size-4" />
                    Remove from folder
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onClick={withSamePeople} disabled={unread || busy || carryOver.length === 0}>
            <Copy />
            New with same participants
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={unread || !owned}
            onClick={() => {
              setProblem(null)
              setDeleting(true)
            }}
          >
            <Trash2 />
            Delete room
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={missed !== null} onOpenChange={(open) => !open && setMissed(null)}>
        <DialogContent className="max-w-110">
          <DialogHeader>
            <DialogTitle>Not everyone came across</DialogTitle>
          </DialogHeader>
          <p className="text-ui-base text-foreground-subtle">
            {missed} You are in the new room; add the rest from Band, or try again from the room this one was made from.
          </p>
          <DialogFooter>
            <Button size="sm" onClick={() => setMissed(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="max-w-100">
          <DialogHeader>
            <DialogTitle>Rename room</DialogTitle>
          </DialogHeader>
          <input
            aria-label="Room name"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') rename()
            }}
            className="h-9 w-full rounded-lg border border-line bg-background px-2.5 text-ui-base text-foreground outline-none select-text"
          />
          {problem ? <p className="text-ui-sm text-foreground-subtle">{problem}</p> : null}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={rename} disabled={busy || !title.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent className="max-w-110">
          <DialogHeader>
            <DialogTitle>Delete this room?</DialogTitle>
          </DialogHeader>
          {/* Jam deletes the Band room for everyone in it, and this cannot be undone (user guide, "Organize and
              manage rooms"). What Jam then asks about the room's local files is not built: this app deletes a local
              file only from the Files panel, one at a time (`docs/jam/differences.md`). */}
          <p className="text-ui-base text-foreground-subtle">
            It goes for everyone in it, and it cannot be undone. Files this computer holds are left where they are.
          </p>
          {problem ? <p className="text-ui-sm text-foreground-subtle">{problem}</p> : null}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={remove} disabled={busy}>
              Delete room
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * How many avatars a room's row shows. Jam Desktop overlaps one per participant; a busy room's row was not seen, so
 * this app stops at three and the row's label names everyone (docs/jam/differences.md).
 */
const ROW_AVATARS = 3

/** The room's people as overlapping initials, in the order the daemon lists them (its owner first). */
function RoomAvatars({ people }: { people: Participant[] | undefined }) {
  if (!people?.length) return null
  const names = people.map((person) => person.name || person.handle || 'Participant')
  return (
    <span role="img" aria-label={names.join(', ')} className="flex shrink-0 -space-x-1">
      {people.slice(0, ROW_AVATARS).map((person, index) => (
        <span
          key={person.id}
          aria-hidden="true"
          className="flex size-4.5 items-center justify-center rounded-full bg-secondary text-ui-xs leading-none font-semibold text-foreground-subtle ring-1 ring-background"
          style={{ zIndex: ROW_AVATARS - index }}
        >
          {initialsOf(names[index])}
        </span>
      ))}
    </span>
  )
}

function RoomSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const open = useUi((state) => !state.foldedSections.includes(title))
  const toggleSection = useUi((state) => state.toggleSection)
  return (
    <section className="mb-3">
      <h2 className="group flex h-7 items-center">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => toggleSection(title)}
          className="flex h-7 min-w-0 flex-1 items-center gap-1 px-2.5 text-left text-ui-base font-medium text-foreground-subtlest transition-colors outline-none hover:text-foreground-subtle"
        >
          <span className="truncate">{title}</span>
          <ChevronDown
            className={cn(
              'size-3.5 transition-[opacity,transform]',
              open ? 'opacity-0 group-hover:opacity-100' : '-rotate-90',
            )}
          />
        </button>
        <span className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          {action}
        </span>
      </h2>
      {open ? <ul className="space-y-0.5">{children}</ul> : null}
    </section>
  )
}

function MutedRow({ children }: { children: ReactNode }) {
  return <li className="flex h-8 items-center px-2.5 text-ui-base text-foreground-subtlest">{children}</li>
}

const SETTINGS_GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Account and app', ids: ['account', 'general', 'appearance', 'notifications'] },
  { label: 'Coding agents', ids: ['integrations', 'runtime'] },
  { label: 'Support', ids: ['logs', 'experiments', 'learn-more'] },
]

/** ZCode's settings navigation: "Back to home", then group labels over rows. */
function SettingsNavigation() {
  return (
    <nav aria-label="Settings" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
      <Link
        to="/"
        className="mx-1 mt-4 mb-4 flex h-8 items-center gap-2 rounded-xl px-1.5 text-ui-base text-foreground-subtle transition-colors outline-none hover:bg-surface-hover hover:text-foreground [&_svg]:size-4"
      >
        <ArrowLeft />
        Back to home
      </Link>
      {SETTINGS_GROUPS.map((group) => (
        <div key={group.label} className="mb-3 flex flex-col gap-1">
          <div className="px-2.5 pb-1 text-ui-sm font-medium text-foreground-subtlest">{group.label}</div>
          {group.ids.map((id) => {
            const page = SETTINGS_SECTIONS.find((item) => item.id === id)
            if (!page) return null
            return (
              <Link
                key={page.id}
                to="/settings/$section"
                params={{ section: page.id }}
                className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-ui-base text-foreground transition-colors outline-none [&_svg]:size-4 [&_svg]:shrink-0"
                activeProps={{ className: 'bg-selected', 'aria-current': 'page' }}
                inactiveProps={{ className: 'hover:bg-surface-hover' }}
              >
                <page.icon className="text-foreground-subtle" />
                {page.label}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

const GEAR =
  'flex size-8 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors outline-none hover:bg-hover [&_svg]:size-4'

/** The account the screens show, and Settings (ZCode's footer: avatar 32, name at 600, a pill badge, a 32 gear). */
function SidebarFooter({ mode }: { mode: 'workspace' | 'settings' }) {
  const profile = useSettings((state) => state.settings.profile)
  const account = useAccount(profile)
  const status = useDaemon((state) => state.status)
  const fake = useDaemon((state) => state.appInfo?.fakeDaemon ?? false)
  const name = account?.identity
    ? [account.identity.first_name, account.identity.last_name].filter(Boolean).join(' ') ||
      account.identity.handle ||
      account.profile
    : status.state === 'connected'
      ? 'Not signed in'
      : 'Not connected'
  const initials = account?.identity ? initialsOf(name) : '?'

  return (
    <div className="flex h-16 shrink-0 items-center gap-1 px-4">
      <Link
        to="/settings/$section"
        params={{ section: 'account' }}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg outline-none"
        aria-label={`Account: ${name}`}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-ui-sm font-semibold text-foreground">
          {initials}
        </span>
        <span className="min-w-0 truncate text-ui-base font-semibold text-foreground">{name}</span>
        {fake ? (
          <span className="shrink-0 rounded-full border border-line px-1.5 text-ui-xs leading-4 text-foreground-subtle">
            Fixtures
          </span>
        ) : null}
      </Link>
      {mode === 'settings' ? (
        <Link to="/" aria-label="Back to home" className={cn(GEAR, 'bg-surface')}>
          <SettingsIcon />
        </Link>
      ) : (
        <Link to="/settings/$section" params={{ section: 'account' }} aria-label="Settings" className={GEAR}>
          <SettingsIcon />
        </Link>
      )}
    </div>
  )
}
