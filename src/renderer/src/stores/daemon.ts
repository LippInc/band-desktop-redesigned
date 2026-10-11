import { create } from 'zustand'
import {
  isEnabled,
  type Account,
  type AgentList,
  type Discovered,
  type Experiments,
  type Inbox,
  type Participant,
  type Room,
  type RoomOrg,
  type Team,
  type WorkSummary,
} from '@shared/daemon'
import type { DaemonStatus } from '@shared/daemon-api'
import type { AppInfo } from '@shared/ipc-contract'
import { daemonErrorCode } from '@/lib/daemon-error'
import { jam } from '@/lib/platform'
import { sortRooms } from '@/lib/rooms'

/** One piece of daemon data: not asked yet, loaded, or unavailable with the reason the page shows. */
export type Loadable<T> =
  | { state: 'idle' }
  | { state: 'ready'; data: T }
  | { state: 'unavailable'; reason: 'offline' | 'unsupported' | 'changed' | 'failed' }

export interface DaemonState {
  status: DaemonStatus
  appInfo: AppInfo | null
  accounts: Loadable<Account[]>
  experiments: Loadable<Experiments>
  rooms: Loadable<Room[]>
  /**
   * Each listed room's participants, for the avatars Jam Desktop shows on a room's row. The room list carries none, so
   * each room is read on its own: once, and again when something has happened in the room since (a participant joining
   * is itself an event there), for the newest rooms only.
   */
  roomPeople: Record<string, Participant[]>
  /** What each of those rooms looked like when it was last asked about, and when the ask failed. */
  roomPeopleAsked: Record<string, { version: string; failedAt?: number }>
  roomOrg: Loadable<RoomOrg>
  agents: Loadable<AgentList>
  /** The account's teams (Band Desktop 0.4.14's Teams): groups of its agents. */
  teams: Loadable<Team[]>
  /** How many task boards and agent task lanes the account has, across its rooms (Home's Active work, a room's Work). */
  work: Loadable<WorkSummary>
  /** Sonar's snapshot: the sidebar's dot shows whether this computer is discoverable. */
  sonar: Loadable<Discovered>
  /**
   * What waits on the person (permission requests and questions), from the daemon's stream; null until the daemon has
   * sent it on this connection (it does when the stream opens, and on every change), and null while it is changed.
   */
  inbox: Inbox | null
  /** The daemon's latest inbox did not fit its schema: what waits on the person cannot be shown. */
  inboxChanged: boolean
  /** Counts completed reads, so a screen with its own data (an open room) reads again with the shell. */
  revision: number
  /** Starts listening to the daemon and loads what the shell needs. */
  start(): Promise<void>
  /** Reads the shell's data again (on connect, on focus, after events). */
  refresh(profile: string): Promise<void>
  reconnect(): Promise<void>
}

/** A part that cannot be shown, and why (Loadable's own unavailable arm). */
export type Unavailable = Extract<Loadable<unknown>, { state: 'unavailable' }>

/** Why a read failed, in the words every screen uses for it. */
export function unavailableFor(error: unknown): Unavailable {
  return unavailable(error)
}

function unavailable(error: unknown): {
  state: 'unavailable'
  reason: 'offline' | 'unsupported' | 'changed' | 'failed'
} {
  const code = daemonErrorCode(error)
  if (code === 'offline' || code === 'timeout') return { state: 'unavailable', reason: 'offline' }
  if (code === 'unsupported') return { state: 'unavailable', reason: 'unsupported' }
  if (code === 'invalid-answer') return { state: 'unavailable', reason: 'changed' }
  return { state: 'unavailable', reason: 'failed' }
}

/** Runs one read and turns its outcome into the state a screen shows. */
export async function load<T>(read: () => Promise<T>): Promise<Loadable<T>> {
  try {
    return { state: 'ready', data: await read() }
  } catch (error) {
    return unavailable(error)
  }
}

let profileInUse = 'default'
let refreshTimer: ReturnType<typeof setTimeout> | undefined
/** The read under way, if any; asking again meanwhile makes one more read after it, never a second one alongside. */
let refreshing: Promise<void> | null = null
let refreshAgain = false

/** The parts of the shell's data that one read fills in. */
export type ShellPart = 'accounts' | 'experiments' | 'rooms' | 'roomOrg' | 'agents' | 'teams' | 'work' | 'sonar'

/**
 * How many rooms' participants the sidebar's avatars are read for, newest first: an account with hundreds of rooms
 * shows the avatars on the rows a person actually reaches, and asks the daemon once per room rather than for all.
 */
const ROOM_PEOPLE_MAX = 40

/** How many of those reads are in flight at once, so the avatars never crowd out what a screen is waiting for. */
const ROOM_PEOPLE_AT_ONCE = 6

/** How long a room whose participants could not be read is left alone before it is asked about again. */
const ROOM_PEOPLE_RETRY_MS = 60_000

/**
 * What a room looked like when it was last asked about. Both of its moments count: a message moves `last_message_at`,
 * and a change to the room itself moves `updated_at`.
 */
const roomVersion = (room: Room) => `${room.updated_at ?? ''} ${room.last_message_at ?? ''}`

/**
 * Whether to ask about a room's participants now. An ask is recorded whether it answered or failed, so a route that
 * always fails (an older daemon, a room the account has left) is not asked about for every room on every read of the
 * shell; one that failed is tried again after a minute, and one whose room has changed at once.
 */
function askAboutPeople(asked: { version: string; failedAt?: number } | undefined, room: Room, now: number): boolean {
  if (!asked || asked.version !== roomVersion(room)) return true
  return asked.failedAt !== undefined && now - asked.failedAt >= ROOM_PEOPLE_RETRY_MS
}

/**
 * What the shell knows from the daemon. Each screen that comes later adds its own data next to these; a part that fails
 * degrades only the place that shows it (README, "What this app never does").
 */
export const useDaemon = create<DaemonState>((set, get) => {
  /**
   * The account's inbox as the main process last had it from the stream. A failed read keeps what was shown; an inbox
   * read again unchanged keeps its object, so the screens that read it do not work again.
   */
  const readInbox = async () => {
    const api = jam()
    if (!api || get().status.state !== 'connected') return
    const profile = profileInUse
    try {
      const read = await api.daemon.getInbox(profile)
      if (profile !== profileInUse) return
      const inbox = read?.state === 'ready' ? read.inbox : null
      const inboxChanged = read?.state === 'changed'
      const shown = get()
      if (inboxChanged === shown.inboxChanged && JSON.stringify(inbox) === JSON.stringify(shown.inbox)) return
      set({ inbox, inboxChanged })
    } catch {
      // the next event or focus reads it again
    }
  }

  /**
   * The participants of the rooms the sidebar lists, one read per room. It runs after the shell's own parts, so it
   * never delays a screen, and it forgets the rooms that have left the list.
   */
  const readRoomPeople = async (rooms: readonly Room[]) => {
    const api = jam()
    if (!api || get().status.state !== 'connected') return
    const profile = profileInUse
    const listed = sortRooms(rooms).slice(0, ROOM_PEOPLE_MAX)
    const known = new Set(listed.map((room) => room.id))
    const onlyListed = <T>(kept: Record<string, T>) =>
      Object.fromEntries(Object.entries(kept).filter(([id]) => known.has(id)))
    set((state) => ({ roomPeople: onlyListed(state.roomPeople), roomPeopleAsked: onlyListed(state.roomPeopleAsked) }))
    const now = Date.now()
    const queue = listed.filter((room) => askAboutPeople(get().roomPeopleAsked[room.id], room, now))
    const readOne = async (room: Room) => {
      const asked = (failedAt?: number) =>
        set((state) => ({
          roomPeopleAsked: { ...state.roomPeopleAsked, [room.id]: { version: roomVersion(room), failedAt } },
        }))
      try {
        const people = await api.daemon.roomParticipants({ profile, roomId: room.id })
        if (profile !== profileInUse) return
        asked()
        set((state) => ({ roomPeople: { ...state.roomPeople, [room.id]: people } }))
      } catch {
        // The row shows the room without its avatars, and it is asked about again after a minute.
        if (profile === profileInUse) asked(Date.now())
      }
    }
    const workers = Array.from({ length: Math.min(ROOM_PEOPLE_AT_ONCE, queue.length) }, async () => {
      for (let room = queue.shift(); room; room = queue.shift()) {
        if (profile !== profileInUse) return
        await readOne(room)
      }
    })
    await Promise.all(workers)
  }

  /**
   * One read of the shell's data. Each part is shown as soon as it answers, so a slow part delays nothing else, unless
   * the account shown changed meanwhile (the read after this one reads the new account).
   */
  const readShell = async () => {
    const api = jam()
    if (!api || get().status.state !== 'connected') return
    const profile = profileInUse
    const part = <T>(key: ShellPart, read: () => Promise<T>) =>
      load(read).then((value) => {
        if (profile === profileInUse) set({ [key]: value } as Partial<DaemonState>)
      })
    await Promise.all([
      readInbox(),
      part('accounts', () => api.daemon.accounts()),
      part('experiments', () => api.daemon.experiments()),
      part('rooms', () => api.daemon.rooms({ profile })),
      part('roomOrg', () => api.daemon.roomOrg({ profile })),
      part('agents', () => api.daemon.agentList({ profile })),
      part('teams', () => api.daemon.teams({ profile })),
      part('work', () => api.daemon.workSnapshot({ profile })),
      part('sonar', () => api.daemon.discovered()),
    ])
    if (profile !== profileInUse) return
    set({ revision: get().revision + 1 })
    const listed = get().rooms
    if (listed.state === 'ready') await readRoomPeople(listed.data)
  }

  return {
    status: { state: 'connecting' },
    appInfo: null,
    accounts: { state: 'idle' },
    experiments: { state: 'idle' },
    rooms: { state: 'idle' },
    roomPeople: {},
    roomPeopleAsked: {},
    roomOrg: { state: 'idle' },
    agents: { state: 'idle' },
    teams: { state: 'idle' },
    work: { state: 'idle' },
    sonar: { state: 'idle' },
    inbox: null,
    inboxChanged: false,
    revision: 0,

    start: async () => {
      const api = jam()
      if (!api) {
        set({ status: { state: 'offline', reason: 'not-found' } })
        return
      }
      api.daemon.onStatus((status) => {
        const wasConnected = get().status.state === 'connected'
        // Away from the daemon, what waits on the person is not known any more (the main process forgets it too).
        set(status.state === 'connected' ? { status } : { status, inbox: null, inboxChanged: false })
        if (status.state === 'connected' && !wasConnected) void get().refresh(profileInUse)
      })
      // An event means "something changed" (the page gets only its name): read again soon, once for a burst of them.
      // The inbox is read at once: it carries what waits on the person, and the main process has it already.
      api.daemon.onEvent((event) => {
        if (event.kind === 'inbox_snapshot') void readInbox()
        clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => void get().refresh(profileInUse), 400)
      })
      window.addEventListener('focus', () => void get().refresh(profileInUse))
      const [status, appInfo] = await Promise.all([api.daemon.getStatus(), api.app.getInfo()])
      set({ status, appInfo })
      if (status.state === 'connected') await get().refresh(profileInUse)
    },

    refresh: (profile) => {
      // Another account: what was read for the last one no longer applies, even before this account's answers arrive.
      if (profile !== profileInUse) {
        set({
          rooms: { state: 'idle' },
          roomPeople: {},
          roomPeopleAsked: {},
          roomOrg: { state: 'idle' },
          agents: { state: 'idle' },
          teams: { state: 'idle' },
          work: { state: 'idle' },
          inbox: null,
          inboxChanged: false,
        })
      }
      profileInUse = profile
      // A focus, an event and a new profile can all ask close together: one read runs at a time, and asking during it
      // makes one more read after it, so answers land in order and a stream of events cannot keep any from landing.
      if (refreshing) {
        refreshAgain = true
        return refreshing
      }
      refreshing = (async () => {
        try {
          do {
            refreshAgain = false
            await readShell()
          } while (refreshAgain)
        } finally {
          refreshing = null
        }
      })()
      return refreshing
    },

    reconnect: async () => {
      const api = jam()
      if (!api) return
      set({ status: { state: 'connecting' } })
      set({ status: await api.daemon.reconnect() })
    },
  }
})

const OFFLINE = { state: 'unavailable', reason: 'offline' } as const

/**
 * A part as a screen shows it: never read while the daemon is known to be away (`offline`, not while still connecting)
 * counts as offline, so the screen says why instead of "Loading…" until Jam returns. What was read stays as it was.
 * Returns the part itself or one constant, so a store selector built on it stays stable.
 */
export function offlineIfNeverRead<T>(part: Loadable<T>, away: boolean): Loadable<T> {
  return away && part.state === 'idle' ? OFFLINE : part
}

/** One part of the shell's data as a screen shows it, from the whole state (offlineIfNeverRead). */
export function shownPart<K extends ShellPart>(state: DaemonState, key: K): DaemonState[K] {
  return offlineIfNeverRead(state[key] as Loadable<unknown>, state.status.state === 'offline') as DaemonState[K]
}

/** One part of the shell's data as a screen shows it (shownPart). */
export function useShellPart<K extends ShellPart>(key: K): DaemonState[K] {
  return useDaemon((state) => shownPart(state, key))
}

/** Whether an experiment is on, as far as the daemon has said. Off while unknown, as it is by default in Jam. */
export function useExperiment(key: string): boolean {
  return useDaemon((state) => (state.experiments.state === 'ready' ? isEnabled(state.experiments.data, key) : false))
}

/** The signed-in account the screens show (Settings → profile), or the first signed-in one. */
export function useAccount(profile: string): Account | null {
  return useDaemon((state) => {
    if (state.accounts.state !== 'ready') return null
    const accounts = state.accounts.data
    return (
      accounts.find((account) => account.profile === profile) ?? accounts.find((account) => account.signed_in) ?? null
    )
  })
}
