import type { HostPeer } from '@shared/daemon'
import { shortId } from '@/lib/rooms'

/**
 * What Sessions lists, in one place. Jam Desktop 0.4.10 was read with its `sessions-section` experiment on and an agent
 * working in a room, which showed every column of its table filled: Agent, Room, PID, Process, Binding and Band.
 *
 * One read answers all of it. `/v1/list` gives a row per host peer - the agent it runs, whether it is running and its
 * state with Band - and each peer carries its own `host_sessions`, which is the table's row per session. `/v1/list` is
 * not the same as `/v1/listSessions`, which answers for one agent named in its body.
 */

/** Jam's words in the Room column for a session that is not attached to a room, seen 2026-09-20. */
export const PARKED = 'Parked template'

/** Jam's words for the table with nothing in it (user guide, "Sessions"). */
export const NO_SESSIONS = 'No active sessions yet'

export interface SessionRow {
  key: string
  /** The agent whose host runs this session. */
  agent: string
  /** The room it works in, by title, or Jam's words for a template attached to none. */
  room: string
  /** No room: the Room column carries Jam's template words rather than a name. */
  parked: boolean
  /** The host process, or an em dash where the daemon reports none, as Jam's column does. */
  pid: string
  /** The daemon's own word for the process ("live", "unknown"); it decides what counts as live, not this app. */
  process: string
  live: boolean
  /** The daemon's own word for the binding ("bound", "detached"). */
  binding: string
  /** The peer's state with Band, in the daemon's word ("connected"). */
  band: string
  connected: boolean
  /** The host this session belongs to is not running. Jam hides these until Show stopped sessions is on. */
  stopped: boolean
}

/**
 * Every session of every host peer, in the order the daemon gives them: peers as listed, and each peer's sessions in
 * its own order, which is how Jam's table read (its template first, then the room it had joined). Nothing is sorted
 * here, because how Jam orders more than one peer was not seen.
 */
export function sessionRows(peers: readonly HostPeer[], roomTitles: Readonly<Record<string, string>>): SessionRow[] {
  const rows: SessionRow[] = []
  for (const entry of peers) {
    const peer = entry.peer
    const band = entry.state ?? ''
    // The host is what runs a session, so a host the daemon says is not running has no live session under it: its
    // rows are the stopped ones Jam keeps behind its switch (`docs/jam/differences.md`). Only the daemon saying so
    // counts: a version that stops sending the flag must not hide every row behind a switch that starts off, which
    // would leave the table claiming there are no sessions at all.
    const stopped = entry.running === false
    for (const session of peer.host_sessions ?? []) {
      const room = session.room ?? ''
      rows.push({
        key: `${peer.profile ?? ''}/${peer.scope ?? ''}/${session.id}`,
        agent: peer.agent_name || peer.handle || shortId(peer.agent_id ?? ''),
        room: room ? roomTitles[room] || shortId(room) : PARKED,
        parked: room === '',
        pid: pidText(session.host_pid),
        process: session.presence ?? '',
        live: session.presence === 'live',
        binding: session.binding ?? '',
        band,
        connected: band === 'connected',
        stopped,
      })
    }
  }
  return rows
}

/**
 * The PID column: the number the daemon reports, or an em dash. Zero is not a process id - it is what the daemon
 * writes for a session with no host process of its own, which is the row Jam showed an em dash for.
 */
export function pidText(pid: number | null | undefined): string {
  return typeof pid === 'number' && pid > 0 ? String(pid) : '—'
}

/** The rows the table shows: the stopped ones only while Jam's switch is on. */
export function shownRows(rows: readonly SessionRow[], showStopped: boolean): SessionRow[] {
  return showStopped ? [...rows] : rows.filter((row) => !row.stopped)
}
