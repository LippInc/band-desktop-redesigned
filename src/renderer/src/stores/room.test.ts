import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Participant } from '@shared/daemon'
import { useDaemon } from './daemon'
import { offlineWhereIdle, shownRoomData, useRoomStore, type RoomData } from './room'

/** A read the test answers when it chooses. */
const deferred = <T>() => Promise.withResolvers<T>()

const ROOM = '5b0f6c2e-8d1a-4c3b-9e7f-2a4d6b8c0e11'
const person = (name: string): Participant => ({ id: name, name })
const pending: ReturnType<typeof deferred<Participant[]>>[] = []
const history = { asked: [] as number[], pages: 1, fails: false, quiet: false, failsAt: 0, code: 'offline' }

beforeEach(() => {
  pending.length = 0
  Object.assign(history, { asked: [], pages: 1, fails: false, quiet: false, failsAt: 0, code: 'offline' })
  const daemon = {
    roomParticipants: () => {
      const read = deferred<Participant[]>()
      pending.push(read)
      return read.promise
    },
    roomMessages: async () => ({ messages: [], unreadable: 0, hasMore: false, loading: false }),
    roomHistory: async ({ page }: { page: number }) => {
      if (history.fails || page === history.failsAt) {
        // The main process puts the reason in the message, as `[jam:<code>] <text>` (src/main/daemon/client.ts).
        throw new Error(`[jam:${history.code}] the daemon refused`)
      }
      history.asked.push(page)
      return {
        messages: [{ id: `p${page}`, inserted_at: `2026-09-0${Math.min(9, page)}T00:00:00.000000Z` }],
        unreadable: 0,
        hasMore: history.quiet ? null : page < history.pages,
        totalPages: history.quiet ? null : history.pages,
      }
    },
    roomPlan: async () => ({ source: null, cache: null, refreshFailed: false }),
    roomFiles: async () => ({ files: [] }),
    roomWork: async () => [],
    roomBoard: async () => [],
    agentSessions: async () => [],
  }
  Object.assign(globalThis, { window: { jam: { daemon } } })
  useDaemon.setState({ status: { state: 'connected', version: '0.4.10', wire: 24, wireMatches: true } })
  useRoomStore.setState({ byKey: {} })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

const settle = () => new Promise((done) => setTimeout(done, 0))

/** Every part of a room, none read yet. */
const neverRead = (): RoomData => ({
  participants: { state: 'idle' },
  messages: { state: 'idle' },
  plan: { state: 'idle' },
  files: { state: 'idle' },
  work: { state: 'idle' },
  board: { state: 'idle' },
  sessions: { state: 'idle' },
  moreFiles: [],
  earlier: [],
  history: 'idle',
  historyProblem: null,
})

describe("an open room's reads", () => {
  it('run one at a time: loading during a read makes one more read after it, whose answers land last', async () => {
    const first = useRoomStore.getState().load('default', ROOM)
    void useRoomStore.getState().load('default', ROOM)
    void useRoomStore.getState().load('default', ROOM)
    await settle()
    expect(pending).toHaveLength(1)
    pending[0]?.resolve([person('first')])
    await settle()
    expect(pending).toHaveLength(2)
    pending[1]?.resolve([person('second')])
    await first
    expect(pending).toHaveLength(2)
    const participants = useRoomStore.getState().byKey[`default ${ROOM}`]?.participants
    expect(participants).toEqual({ state: 'ready', data: [person('second')] })
  })

  it('show each part as soon as it answers, while a slower one is still under way', async () => {
    const done = useRoomStore.getState().load('default', ROOM)
    await settle()
    const early = useRoomStore.getState().byKey[`default ${ROOM}`]
    expect(early?.plan).toEqual({ state: 'ready', data: { source: null, cache: null, refreshFailed: false } })
    expect(early?.participants).toEqual({ state: 'idle' })
    pending[0]?.resolve([person('late')])
    await done
  })

  it('show a part never read as offline while the daemon is away, and keep what was read', () => {
    const shown = offlineWhereIdle({
      ...neverRead(),
      participants: { state: 'ready', data: [person('read before')] },
      files: { state: 'unavailable', reason: 'changed' },
    })
    expect(shown.participants).toEqual({ state: 'ready', data: [person('read before')] })
    expect(shown.messages).toEqual({ state: 'unavailable', reason: 'offline' })
    expect(shown.plan).toEqual({ state: 'unavailable', reason: 'offline' })
    expect(shown.files).toEqual({ state: 'unavailable', reason: 'changed' })
    expect(shown.work).toEqual({ state: 'unavailable', reason: 'offline' })
    // What was read from before the snapshot stays on screen while the daemon is away, as the snapshot itself does.
    const earlier = offlineWhereIdle({ ...neverRead(), earlier: [{ id: 'm0' } as never], history: 'read' })
    expect(earlier.earlier).toEqual([{ id: 'm0' }])
    expect(earlier.history).toBe('read')
    // The pages of files read after the first stay too, for the same reason.
    const paged = offlineWhereIdle({ ...neverRead(), moreFiles: [{ files: [], has_more: false } as never] })
    expect(paged.moreFiles).toHaveLength(1)
    const never = offlineWhereIdle(neverRead())
    const { earlier: none, history: state, historyProblem, moreFiles, ...parts } = never
    expect(Object.keys(parts)).toHaveLength(7)
    expect(moreFiles).toEqual([])
    expect(none).toEqual([])
    expect(state).toBe('idle')
    expect(historyProblem).toBeNull()
    for (const part of Object.values(parts)) expect(part).toEqual({ state: 'unavailable', reason: 'offline' })
  })

  it('show parts never read as loading while the app is connecting, and as offline only when Jam is away', () => {
    const never: RoomData = neverRead()
    expect(shownRoomData(never, 'connecting')).toBe(never)
    expect(shownRoomData(never, 'connected')).toBe(never)
    expect(shownRoomData(never, 'offline').plan).toEqual({ state: 'unavailable', reason: 'offline' })
  })

  it("keep one account's view of a room apart from another's", async () => {
    const first = useRoomStore.getState().load('default', ROOM)
    const second = useRoomStore.getState().load('work', ROOM)
    await settle()
    pending[0]?.resolve([person('default account')])
    pending[1]?.resolve([person('work account')])
    await Promise.all([first, second])
    const { byKey } = useRoomStore.getState()
    expect(byKey[`default ${ROOM}`]?.participants).toEqual({ state: 'ready', data: [person('default account')] })
    expect(byKey[`work ${ROOM}`]?.participants).toEqual({ state: 'ready', data: [person('work account')] })
  })

  // The conversation before the snapshot: read once, when the person asks, and kept beside what the daemon keeps.
  it('reads the conversation back to its beginning only when asked, and keeps what it read', async () => {
    const key = `default ${ROOM}`
    history.pages = 3
    expect(useRoomStore.getState().byKey[key]).toBeUndefined()
    const reading = useRoomStore.getState().readEarlier('default', ROOM)
    expect(useRoomStore.getState().byKey[key]?.history).toBe('reading')
    // Asking again while it reads does not read it twice.
    await Promise.all([reading, useRoomStore.getState().readEarlier('default', ROOM)])
    expect(history.asked).toEqual([1, 2, 3])
    const data = useRoomStore.getState().byKey[key]
    expect(data?.history).toBe('read')
    // Page 1 is the newest, so the pages come back in the reverse of the order they were read in.
    expect(data?.earlier.map((message) => message.id)).toEqual(['p3', 'p2', 'p1'])
  })

  it('says so, and keeps what was read before, when the earlier messages cannot be read', async () => {
    const key = `default ${ROOM}`
    // A reading that got somewhere before, and a second attempt that gets nowhere at all.
    history.pages = 2
    await useRoomStore.getState().readEarlier('default', ROOM)
    expect(useRoomStore.getState().byKey[key]?.earlier).toHaveLength(2)
    history.fails = true
    await useRoomStore.getState().readEarlier('default', ROOM)
    const data = useRoomStore.getState().byKey[key]
    expect(data?.history).toBe('failed')
    expect(data?.earlier.map((message) => message.id)).toEqual(['p2', 'p1'])
  })

  it('says the conversation was not read whole when the daemon still has more after the last page', async () => {
    history.pages = 500
    await useRoomStore.getState().readEarlier('default', ROOM)
    const data = useRoomStore.getState().byKey[`default ${ROOM}`]
    expect(data?.history).toBe('partial')
    expect(history.asked).toHaveLength(40)
    expect(data?.earlier).toHaveLength(40)
  })

  // A daemon that stops saying whether there is more has not said there is none.
  it('does not call a conversation read whole when the daemon stopped saying', async () => {
    history.quiet = true
    await useRoomStore.getState().readEarlier('default', ROOM)
    expect(useRoomStore.getState().byKey[`default ${ROOM}`]?.history).toBe('partial')
  })

  // A page that fails after others were read keeps them, and says why the rest could not be read.
  it('keeps the pages it read when one fails, and says why in the words the room uses', async () => {
    history.pages = 5
    history.failsAt = 3
    history.code = 'offline'
    await useRoomStore.getState().readEarlier('default', ROOM)
    const data = useRoomStore.getState().byKey[`default ${ROOM}`]
    expect(data?.history).toBe('failed')
    expect(data?.historyProblem).toBe('offline')
    expect(data?.earlier.map((message) => message.id)).toEqual(['p2', 'p1'])
    // A route an older daemon does not have is not worth asking again, and says so differently.
    history.failsAt = 1
    history.code = 'unsupported'
    await useRoomStore.getState().readEarlier('default', ROOM)
    expect(useRoomStore.getState().byKey[`default ${ROOM}`]?.historyProblem).toBe('unsupported')
  })
})
