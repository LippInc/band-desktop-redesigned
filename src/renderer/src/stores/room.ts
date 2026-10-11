import { useEffect } from 'react'
import { create } from 'zustand'
import type {
  AgentRow,
  AgentSession,
  AgentTarget,
  BoardTask,
  Participant,
  Room,
  RoomFiles,
  RoomMessage,
  RoomMessages,
  RoomPlan,
  WorkLane,
} from '@shared/daemon'
import type { DaemonStatus } from '@shared/daemon-api'
import { jam } from '@/lib/platform'
import { readWholeConversation } from '@/lib/history'
import { load, offlineIfNeverRead, unavailableFor, useDaemon, type Loadable, type Unavailable } from '@/stores/daemon'
import { useSettings } from '@/stores/settings'

/** What an open room shows beyond the room list: each part loads, and degrades, on its own. */
export interface RoomData {
  participants: Loadable<Participant[]>
  messages: Loadable<RoomMessages>
  plan: Loadable<RoomPlan>
  files: Loadable<RoomFiles>
  /**
   * The pages after the first, in the order they were asked for. Kept beside `files` rather than merged into it,
   * because every room re-read answers page one and would otherwise drop them (the same reason `earlier` is kept
   * beside the conversation's snapshot).
   */
  moreFiles: RoomFiles[]
  /** The room's agents' private task lanes. */
  work: Loadable<WorkLane[]>
  /** The room's shared tasks. */
  board: Loadable<BoardTask[]>
  /** Each local agent's sessions, by its key (`<profile>/<scope>`): whether its runtime is live in this room. */
  sessions: Loadable<Record<string, AgentSession[]>>
  /**
   * The messages read from before the snapshot's window, oldest first, kept beside it: the snapshot is read again
   * whenever the daemon announces a change, and what was read earlier stays on screen through that.
   */
  earlier: RoomMessage[]
  /** What reading the conversation past the snapshot has done so far. */
  history: HistoryState
  /** Why the earlier messages could not be read, for the room to say in the words it uses for every other part. */
  historyProblem: Unavailable['reason'] | null
}

/**
 * `idle`: not asked for. `reading`: the pages are being read. `read`: the conversation was read to its beginning.
 * `partial`: the daemon still said there was more after the most pages this app reads at once. `failed`: the daemon
 * refused or could not answer, and what was on screen stays.
 */
export type HistoryState = 'idle' | 'reading' | 'read' | 'partial' | 'failed'

const IDLE: RoomData = {
  participants: { state: 'idle' },
  messages: { state: 'idle' },
  plan: { state: 'idle' },
  files: { state: 'idle' },
  moreFiles: [],
  work: { state: 'idle' },
  board: { state: 'idle' },
  sessions: { state: 'idle' },
  earlier: [],
  history: 'idle',
  historyProblem: null,
}

/** A local agent the daemon can be asked about, from its agent-list row: `local.peer_key` is `<profile>/<scope>`. */
export function agentTargetOf(row: AgentRow): AgentTarget | null {
  const key = row.local?.peer_key
  if (!key || !row.handle) return null
  const slash = key.indexOf('/')
  if (slash <= 0) return null
  return { profile: key.slice(0, slash), scope: key.slice(slash + 1), handle: row.handle }
}

/** The account's local agents (the shell's agent list), as targets for this profile. */
function localAgents(profile: string): { peerKey: string; target: AgentTarget }[] {
  const agents = useDaemon.getState().agents
  if (agents.state !== 'ready') return []
  return agents.data.rows.flatMap((row) => {
    const target = agentTargetOf(row)
    return target && target.profile === profile && row.local ? [{ peerKey: row.local.peer_key, target }] : []
  })
}

/** One room as one account sees it: the same room can be in two accounts' lists. */
const keyOf = (profile: string, roomId: string) => `${profile} ${roomId}`

/**
 * The read under way for each room: asking again meanwhile makes one more read after it, never a second one alongside,
 * so answers land in order and a stream of refreshes cannot keep any from landing.
 */
const flights = new Map<string, { again: boolean; done: Promise<void> }>()

/** The rooms whose next page of files is being read, so two asks cannot add the same page twice. */
const filesInFlight = new Set<string>()

interface RoomStore {
  /** By account and room. What was read stays on screen while the daemon reconnects (user guide, "Recover the local connection"). */
  byKey: Record<string, RoomData>
  load(profile: string, roomId: string): Promise<void>
  /** Reads the conversation from the snapshot back to its beginning, a page at a time (`@/lib/history`). */
  readEarlier(profile: string, roomId: string): Promise<void>
  /** Jam's "Load more files": the next page of the room's catalogue, added to the ones already listed. */
  readMoreFiles(profile: string, roomId: string): Promise<void>
  /**
   * Takes one file out of the pages read after the first, for a file that has just been deleted: the room's own read
   * answers page one and would leave it listed otherwise.
   */
  forgetFile(profile: string, roomId: string, fileId: string): void
}

export const useRoomStore = create<RoomStore>((set) => {
  /** One read of a room: each part is shown as soon as it answers, so a slow part delays nothing else. */
  const readRoom = async (profile: string, roomId: string, key: string) => {
    const api = jam()
    if (!api || useDaemon.getState().status.state !== 'connected') return
    const input = { profile, roomId }
    const part = <T>(name: keyof RoomData, read: () => Promise<T>) =>
      load(read).then((value) =>
        set((state) => ({ byKey: { ...state.byKey, [key]: { ...(state.byKey[key] ?? IDLE), [name]: value } } })),
      )
    await Promise.all([
      part('participants', () => api.daemon.roomParticipants(input)),
      part('messages', () => api.daemon.roomMessages(input)),
      part('plan', () => api.daemon.roomPlan(input)),
      part('files', () => api.daemon.roomFiles(input)),
      part('work', () => api.daemon.roomWork(input)),
      part('board', () => api.daemon.roomBoard(input)),
      part('sessions', async () => {
        const entries = await Promise.all(
          localAgents(profile).map(
            async ({ peerKey, target }) => [peerKey, await api.daemon.agentSessions(target)] as const,
          ),
        )
        return Object.fromEntries(entries)
      }),
    ])
  }

  return {
    byKey: {},
    load: (profile, roomId) => {
      const key = keyOf(profile, roomId)
      const current = flights.get(key)
      if (current) {
        current.again = true
        return current.done
      }
      const flight = { again: false, done: Promise.resolve() }
      flight.done = (async () => {
        try {
          do {
            flight.again = false
            await readRoom(profile, roomId, key)
          } while (flight.again)
        } finally {
          flights.delete(key)
        }
      })()
      flights.set(key, flight)
      return flight.done
    },

    /**
     * The conversation before the snapshot, read once per room and kept beside it. Nothing reads it on its own: the
     * person asks for it, because a long conversation is many reads of the daemon and Band behind it.
     */
    /** Jam's "Load more files": the next page of the room's catalogue, kept beside the first (`moreFiles`). */
    readMoreFiles: async (profile, roomId) => {
      const api = jam()
      const key = keyOf(profile, roomId)
      const page = useRoomStore.getState().byKey[key]?.files
      const already = useRoomStore.getState().byKey[key]?.moreFiles ?? []
      // The page to ask from is the last one read: page one until Load more has been pressed, then the newest.
      const last = already.at(-1) ?? (page?.state === 'ready' ? page.data : null)
      // Only ever asked for from a page that answered and said there is more; without a cursor there is no next page.
      if (!api || page?.state !== 'ready' || !last?.has_more || !last.next_cursor) return
      // One at a time per room: two asks in flight would both read the same cursor and add the same page twice.
      if (filesInFlight.has(key)) return
      filesInFlight.add(key)
      try {
        const cursor = last.next_cursor
        const more = await load(() => api.daemon.roomFiles({ profile, roomId, cursor }))
        if (more.state !== 'ready') return
        set((state) => {
          const data = state.byKey[key] ?? IDLE
          // Another page may have landed meanwhile; then this answer is for a place in the list that has moved on.
          const now = data.moreFiles.at(-1) ?? (data.files.state === 'ready' ? data.files.data : null)
          if (now?.next_cursor !== cursor) return {}
          return { byKey: { ...state.byKey, [key]: { ...data, moreFiles: [...data.moreFiles, more.data] } } }
        })
      } finally {
        filesInFlight.delete(key)
      }
    },

    forgetFile: (profile, roomId, fileId) => {
      const key = keyOf(profile, roomId)
      set((state) => {
        const data = state.byKey[key]
        if (!data) return {}
        const moreFiles = data.moreFiles.map((page) => ({ ...page, files: page.files.filter((f) => f.id !== fileId) }))
        return { byKey: { ...state.byKey, [key]: { ...data, moreFiles } } }
      })
    },

    readEarlier: async (profile, roomId) => {
      const api = jam()
      const key = keyOf(profile, roomId)
      const at = (state: RoomStore) => state.byKey[key] ?? IDLE
      if (!api || at(useRoomStore.getState()).history === 'reading') return
      const mark = (history: HistoryState, earlier?: RoomMessage[], problem?: Unavailable['reason']) =>
        set((state) => {
          const data = state.byKey[key] ?? IDLE
          const next = {
            ...data,
            history,
            earlier: earlier ?? data.earlier,
            historyProblem: problem ?? null,
          }
          return { byKey: { ...state.byKey, [key]: next } }
        })
      mark('reading')
      const whole = await readWholeConversation((page) => api.daemon.roomHistory({ profile, roomId, page }))
      // Every page that was read is kept, whatever stopped the reading: a second attempt starts from a shorter way
      // off, and an attempt that read nothing at all leaves what an earlier one did read on screen.
      const read = whole.messages.length > 0 ? whole.messages : undefined
      if (whole.stopped === 'error') mark('failed', read, unavailableFor(whole.error).reason)
      else mark(whole.stopped === 'end' ? 'read' : 'partial', read)
    },
  }
})

/** A room from the room list, or null while the list is not read or when the room is not in it. */
export function useRoom(roomId: string | undefined): Room | null {
  return useDaemon((state) =>
    roomId && state.rooms.state === 'ready' ? (state.rooms.data.find((room) => room.id === roomId) ?? null) : null,
  )
}

/**
 * Reads an open room's data when the room opens and again whenever the shell reads again (on connecting, on focus and
 * after the daemon announces a change). Only a room in the list is read: its id came from the daemon. The room page
 * calls this once, and Inbox's room context for the item it shows; their other parts (the side pane) only look with
 * useRoomData.
 */
export function useRoomReads(room: Room | null): void {
  const profile = useSettings((state) => state.settings.profile)
  const revision = useDaemon((state) => state.revision)
  const connected = useDaemon((state) => state.status.state === 'connected')
  const read = useRoomStore((state) => state.load)
  const roomId = room?.id ?? null
  useEffect(() => {
    if (roomId && connected) void read(profile, roomId)
    // oxlint-disable-next-line react/exhaustive-deps -- revision is there to read again whenever the shell does
  }, [roomId, profile, revision, connected, read])
}

/**
 * What has been read of a room for the account shown so far: idle before its first read, and, for a part never read,
 * offline once the daemon is known to be away (a room opened then shows why, not "Loading…" until Jam returns). While
 * the app is still connecting, a part never read is only loading.
 */
export function useRoomData(room: Room | null): RoomData {
  const profile = useSettings((state) => state.settings.profile)
  const status = useDaemon((state) => state.status.state)
  const key = room ? keyOf(profile, room.id) : null
  const data = useRoomStore((state) => (key ? state.byKey[key] : undefined)) ?? IDLE
  return shownRoomData(data, status)
}

/** A room's data as the screen shows it, for the daemon's state (useRoomData). */
export function shownRoomData(data: RoomData, status: DaemonStatus['state']): RoomData {
  return status === 'offline' ? offlineWhereIdle(data) : data
}

export function offlineWhereIdle(data: RoomData): RoomData {
  return {
    participants: offlineIfNeverRead(data.participants, true),
    messages: offlineIfNeverRead(data.messages, true),
    plan: offlineIfNeverRead(data.plan, true),
    files: offlineIfNeverRead(data.files, true),
    work: offlineIfNeverRead(data.work, true),
    board: offlineIfNeverRead(data.board, true),
    sessions: offlineIfNeverRead(data.sessions, true),
    // What was read before the snapshot stays on screen while the daemon is away, as the snapshot itself does,
    // and so do the pages of files read after the first.
    earlier: data.earlier,
    moreFiles: data.moreFiles,
    history: data.history,
    historyProblem: data.historyProblem,
  }
}
