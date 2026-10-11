import { describe, expect, it } from 'vitest'
import type { HostPeer } from '@shared/daemon'
import { pidText, PARKED, sessionRows, shownRows } from '@/lib/sessions'

const session = (over: Record<string, unknown>) => ({
  id: 'default',
  room: '',
  provider: 'claudecode',
  host_pid: 0,
  presence: 'unknown',
  binding: 'detached',
  ...over,
})

const peer = (
  name: string,
  over: Record<string, unknown>,
  sessions: unknown[],
  identity: Record<string, unknown> = {},
): HostPeer =>
  ({
    peer: {
      scope: name.toLowerCase(),
      profile: 'default',
      agent_id: `id-${name.toLowerCase()}`,
      agent_name: name,
      handle: `someone/${name.toLowerCase()}`,
      host: 'claudecode',
      host_sessions: sessions,
      ...identity,
    },
    state: 'connected',
    running: true,
    ...over,
  }) as unknown as HostPeer

const titles = { 'room-a': 'Checkout flow redesign', 'room-b': 'Release notes for 2.4' }

describe('what Sessions lists', () => {
  it("keeps the daemon's order: peers as listed, and each peer's sessions in its own order", () => {
    const rows = sessionRows(
      [
        peer('Atlas', {}, [session({}), session({ id: 'default-room-a', room: 'room-a' })]),
        peer('Nova', {}, [session({ id: 'default-room-b', room: 'room-b' })]),
      ],
      titles,
    )
    expect(rows.map((row) => [row.agent, row.room])).toEqual([
      ['Atlas', PARKED],
      ['Atlas', 'Checkout flow redesign'],
      ['Nova', 'Release notes for 2.4'],
    ])
  })

  it("writes Jam's template words for a session in no room, and a room it does not know by the head of its id", () => {
    const rows = sessionRows(
      [peer('Atlas', {}, [session({}), session({ id: 'x', room: 'b7c9e1f3-0a2c-4e6b-8d0f-2a4c6e8b0d2f' })])],
      titles,
    )
    expect(rows[0]).toMatchObject({ room: PARKED, parked: true })
    expect(rows[1]).toMatchObject({ room: 'b7c9e1f3', parked: false })
  })

  it('shows the process and the binding in the daemon\'s own words, and marks only "live" live', () => {
    const rows = sessionRows(
      [
        peer('Atlas', {}, [
          session({ presence: 'live', binding: 'bound', host_pid: 24188 }),
          session({ id: 'two', presence: 'unknown' }),
        ]),
      ],
      titles,
    )
    expect(rows[0]).toMatchObject({ process: 'live', live: true, binding: 'bound', pid: '24188' })
    expect(rows[1]).toMatchObject({ process: 'unknown', live: false, binding: 'detached', pid: '—' })
  })

  // Only the daemon's own word for a connected peer counts as connected: a state this app has never seen, and a peer
  // with none at all, must not show the green dot on the strength of not being the one word it knows for the opposite.
  it('carries the peer\'s Band state, and calls only "connected" connected', () => {
    const rows = sessionRows(
      [
        peer('Atlas', {}, [session({})]),
        peer('Nova', { state: 'disconnected', running: false }, [session({ id: 'two' })]),
        peer('Vega', { state: 'reconnecting' }, [session({ id: 'three' })]),
        peer('Orion', { state: null }, [session({ id: 'four' })]),
      ],
      titles,
    )
    expect(rows[2]).toMatchObject({ band: 'reconnecting', connected: false })
    expect(rows[3]).toMatchObject({ band: '', connected: false })
    expect(rows[0]).toMatchObject({ band: 'connected', connected: true })
    expect(rows[1]).toMatchObject({ band: 'disconnected', connected: false })
  })

  it("hides a stopped host's sessions until Jam's switch is on", () => {
    const rows = sessionRows(
      [
        peer('Atlas', {}, [session({ presence: 'live', host_pid: 9042 })]),
        peer('Nova', { running: false }, [session({ id: 'two' })]),
      ],
      titles,
    )
    expect(rows.map((row) => row.stopped)).toEqual([false, true])
    expect(shownRows(rows, false).map((row) => row.agent)).toEqual(['Atlas'])
    expect(shownRows(rows, true).map((row) => row.agent)).toEqual(['Atlas', 'Nova'])
  })

  // Zero is what the daemon writes for a session with no host process of its own, not a process id.
  it('writes an em dash where there is no process id, and never a zero', () => {
    expect(pidText(24188)).toBe('24188')
    expect(pidText(0)).toBe('—')
    expect(pidText(null)).toBe('—')
    expect(pidText(undefined)).toBe('—')
    expect(pidText(-1)).toBe('—')
  })

  // A host the daemon says nothing about is not a host it says has stopped: hiding those rows behind a switch that
  // starts off would leave the table claiming there are no sessions while they are running.
  it('calls a host stopped only when the daemon says it is not running', () => {
    const rows = sessionRows(
      [
        peer('Atlas', { running: undefined }, [session({})]),
        peer('Nova', { running: null }, [session({ id: 'two' })]),
        peer('Vega', { running: false }, [session({ id: 'three' })]),
      ],
      titles,
    )
    expect(rows.map((row) => row.stopped)).toEqual([false, false, true])
    expect(shownRows(rows, false).map((row) => row.agent)).toEqual(['Atlas', 'Nova'])
  })

  // The words in these columns are the daemon's. A row the daemon said nothing about says nothing, rather than
  // reporting a state it never reported.
  it('puts no word of its own where the daemon sent none, and names an agent by whatever it has', () => {
    const bare = [{ id: 'bare' }]
    const byHandle = sessionRows([peer('Atlas', {}, bare, { agent_name: '' })], titles)
    expect(byHandle[0]).toMatchObject({ process: '', live: false, binding: '', pid: '—', agent: 'someone/atlas' })
    const byId = sessionRows(
      [peer('Atlas', {}, bare, { agent_name: '', handle: '', agent_id: 'b7c9e1f3-0a2c-4e6b-8d0f-2a4c6e8b0d2f' })],
      titles,
    )
    expect(byId[0]?.agent).toBe('b7c9e1f3')
  })

  it('has nothing to list for a peer with no sessions, and for no peers at all', () => {
    expect(sessionRows([peer('Atlas', {}, [])], titles)).toEqual([])
    expect(sessionRows([], titles)).toEqual([])
    expect(shownRows([], false)).toEqual([])
  })
})
