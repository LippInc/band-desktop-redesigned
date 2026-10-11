import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room } from '@shared/daemon'
import { offlineIfNeverRead, shownPart, useDaemon, type Loadable } from './daemon'

/** A read the test answers when it chooses. */
const deferred = <T>() => Promise.withResolvers<T>()

const room = (title: string, updated_at = '2026-09-19T10:00:00Z'): Room => ({ id: title, title, updated_at })
/** Each rooms read the store made, with the account it asked for. */
const pending: { profile: string; read: ReturnType<typeof deferred<Room[]>> }[] = []
/** Every room whose participants were asked for, in order, and what the next of those reads answers. */
const peopleAsked: string[] = []
let peopleAnswer: (roomId: string) => Promise<{ id: string; name: string }[]> = async () => []

beforeEach(() => {
  pending.length = 0
  peopleAsked.length = 0
  peopleAnswer = async (roomId) => [{ id: `${roomId}-owner`, name: 'Sam Rivera' }]
  const daemon = {
    accounts: async () => [],
    experiments: async () => ({ revision: 1, experiments: [] }),
    rooms: ({ profile }: { profile: string }) => {
      const read = deferred<Room[]>()
      pending.push({ profile, read })
      return read.promise
    },
    roomOrg: async () => ({ folders: [], assignments: {}, pinned: [], collapsed: [], archived: {} }),
    agentList: async () => ({ rows: [] }),
    workSnapshot: async () => ({ boards: 0, lanes: 0 }),
    discovered: async () => ({ discoverable: false, users: [] }),
    roomParticipants: ({ roomId }: { roomId: string }) => {
      peopleAsked.push(roomId)
      return peopleAnswer(roomId)
    },
  }
  Object.assign(globalThis, { window: { jam: { daemon } } })
  useDaemon.setState({
    status: { state: 'connected', version: '0.4.10', wire: 24, wireMatches: true },
    accounts: { state: 'idle' },
    rooms: { state: 'idle' },
    roomPeople: {},
    roomPeopleAsked: {},
    revision: 0,
  })
})

afterEach(async () => {
  // A read a test left hanging would keep the store's one-at-a-time loop busy into the next one.
  for (const { read } of pending) read.resolve([])
  await new Promise((done) => setTimeout(done, 0))
  Reflect.deleteProperty(globalThis, 'window')
})

const settle = () => new Promise((done) => setTimeout(done, 0))

describe("the shell's reads", () => {
  it('run one at a time: asking during a read makes one more read after it, not one per ask', async () => {
    const first = useDaemon.getState().refresh('default')
    void useDaemon.getState().refresh('default')
    void useDaemon.getState().refresh('default')
    await settle()
    expect(pending).toHaveLength(1)
    pending[0]?.read.resolve([room('first')])
    await settle()
    expect(pending).toHaveLength(2)
    pending[1]?.read.resolve([room('second')])
    await first
    expect(pending).toHaveLength(2)
    expect(useDaemon.getState().rooms).toEqual({ state: 'ready', data: [room('second')] })
    expect(useDaemon.getState().revision).toBe(2)
  })

  it('show each part as soon as it answers, while a slower one is still under way', async () => {
    const done = useDaemon.getState().refresh('default')
    await settle()
    expect(useDaemon.getState().accounts).toEqual({ state: 'ready', data: [] })
    expect(useDaemon.getState().rooms).toEqual({ state: 'idle' })
    pending[0]?.read.resolve([room('late')])
    await done
    expect(useDaemon.getState().rooms).toEqual({ state: 'ready', data: [room('late')] })
  })

  it('keep what was read while the same account is read again, until the new answer lands', async () => {
    useDaemon.setState({ rooms: { state: 'ready', data: [room('shown')] } })
    const done = useDaemon.getState().refresh('default')
    await settle()
    expect(useDaemon.getState().rooms).toEqual({ state: 'ready', data: [room('shown')] })
    pending[0]?.read.resolve([room('fresh')])
    await done
    expect(useDaemon.getState().rooms).toEqual({ state: 'ready', data: [room('fresh')] })
  })

  it("clear the last account's rooms, agents and work the moment the account changes, even with Jam away", () => {
    useDaemon.setState({
      status: { state: 'offline', reason: 'not-found' },
      rooms: { state: 'ready', data: [room('the last account')] },
      agents: { state: 'ready', data: { rows: [] } },
    })
    void useDaemon.getState().refresh('someone-else')
    expect(useDaemon.getState().rooms).toEqual({ state: 'idle' })
    expect(useDaemon.getState().agents).toEqual({ state: 'idle' })
    expect(pending).toHaveLength(0)
    void useDaemon.getState().refresh('default')
  })

  it("drop an answer read for an account no longer shown, and read the new one's", async () => {
    const done = useDaemon.getState().refresh('default')
    await settle()
    void useDaemon.getState().refresh('work')
    pending[0]?.read.resolve([room('the old account')])
    await settle()
    expect(useDaemon.getState().rooms).toEqual({ state: 'idle' })
    expect(pending[1]?.profile).toBe('work')
    pending[1]?.read.resolve([room('the new account')])
    await done
    expect(useDaemon.getState().rooms).toEqual({ state: 'ready', data: [room('the new account')] })
  })
})

describe('a part as a screen shows it', () => {
  const ready: Loadable<number> = { state: 'ready', data: 1 }
  const changed: Loadable<number> = { state: 'unavailable', reason: 'changed' }

  it('counts a part never read as offline once Jam is known to be away, and only then', () => {
    expect(offlineIfNeverRead({ state: 'idle' }, true)).toEqual({ state: 'unavailable', reason: 'offline' })
    expect(offlineIfNeverRead({ state: 'idle' }, false)).toEqual({ state: 'idle' })
  })

  it('keeps what was read, as the same object', () => {
    expect(offlineIfNeverRead(ready, true)).toBe(ready)
    expect(offlineIfNeverRead(changed, true)).toBe(changed)
  })

  it('shows a part never read as loading while the app is still connecting, and as offline only when Jam is away', () => {
    useDaemon.setState({ status: { state: 'connecting' }, rooms: { state: 'idle' } })
    expect(shownPart(useDaemon.getState(), 'rooms')).toEqual({ state: 'idle' })
    useDaemon.setState({ status: { state: 'offline', reason: 'not-found' } })
    expect(shownPart(useDaemon.getState(), 'rooms')).toEqual({ state: 'unavailable', reason: 'offline' })
    useDaemon.setState({ status: { state: 'connected', version: '0.4.10', wire: 24, wireMatches: true } })
    expect(shownPart(useDaemon.getState(), 'rooms')).toEqual({ state: 'idle' })
  })
})

describe("the avatars on a room's row", () => {
  /** One read of the shell, answering the room list with `rooms`. */
  const shellRead = async (rooms: Room[], profile = 'default') => {
    const done = useDaemon.getState().refresh(profile)
    await settle()
    pending.at(-1)?.read.resolve(rooms)
    await done
  }

  it("asks for each listed room's participants once, and again only when the room has changed", async () => {
    await shellRead([room('a'), room('b')])
    expect(peopleAsked.toSorted()).toEqual(['a', 'b'])
    expect(useDaemon.getState().roomPeople.a).toEqual([{ id: 'a-owner', name: 'Sam Rivera' }])

    await shellRead([room('a'), room('b')])
    expect(peopleAsked).toHaveLength(2)

    // A message in a room moves its own moment, and only that room is asked about again.
    await shellRead([{ ...room('a'), last_message_at: '2026-09-19T11:00:00Z' }, room('b')])
    expect(peopleAsked).toHaveLength(3)
    expect(peopleAsked.at(-1)).toBe('a')

    // A change to the room itself moves the other moment, which counts too: its newest message is the same here.
    const spoke = { ...room('a'), last_message_at: '2026-09-19T11:00:00Z' }
    await shellRead([{ ...spoke, updated_at: '2026-09-19T12:00:00Z' }, room('b')])
    expect(peopleAsked).toHaveLength(4)
    expect(peopleAsked.at(-1)).toBe('a')
  })

  it('stops at the forty newest rooms, and forgets a room that leaves the list', async () => {
    const newest = Date.parse('2026-09-19T10:00:00Z')
    const many = Array.from({ length: 45 }, (_, at) =>
      room(`room-${String(at).padStart(2, '0')}`, new Date(newest - at * 60_000).toISOString()),
    )
    await shellRead(many)
    expect(peopleAsked).toHaveLength(40)
    expect(peopleAsked).not.toContain('room-44')
    expect(Object.keys(useDaemon.getState().roomPeople)).toHaveLength(40)

    await shellRead([room('a')])
    expect(Object.keys(useDaemon.getState().roomPeople)).toEqual(['a'])
  })

  it('asks a room that failed once, then leaves it alone for a minute', async () => {
    // Only the clock is held: the store's own reads settle on real timers.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      peopleAnswer = async () => {
        throw new Error('this daemon has no such route')
      }
      await shellRead([room('a'), room('b')])
      expect(peopleAsked).toHaveLength(2)
      expect(useDaemon.getState().roomPeople).toEqual({})

      // However often the shell is read meanwhile, a route that fails for every room is not asked again.
      await shellRead([room('a'), room('b')])
      await shellRead([room('a'), room('b')])
      expect(peopleAsked).toHaveLength(2)

      peopleAnswer = async (roomId) => [{ id: `${roomId}-owner`, name: 'Sam Rivera' }]
      vi.setSystemTime(Date.now() + 61_000)
      await shellRead([room('a'), room('b')])
      expect(peopleAsked).toHaveLength(4)
      expect(useDaemon.getState().roomPeople.b).toEqual([{ id: 'b-owner', name: 'Sam Rivera' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it("drops the last account's people the moment the account changes, and asks the new one's", async () => {
    await shellRead([room('a')])
    expect(useDaemon.getState().roomPeople.a).toBeDefined()

    // The same room can be in two accounts' lists, so nothing read for the last one is shown for the new one.
    const done = useDaemon.getState().refresh('someone-else')
    expect(useDaemon.getState().roomPeople).toEqual({})
    expect(useDaemon.getState().roomPeopleAsked).toEqual({})
    await settle()
    pending.at(-1)?.read.resolve([room('a')])
    await done
    expect(peopleAsked).toEqual(['a', 'a'])
  })
})
