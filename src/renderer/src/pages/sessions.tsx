import { useEffect, useMemo, useState } from 'react'
import type { HostPeer, Room } from '@shared/daemon'
import { Page } from '@/components/page'
import { Cell, StatePill, Table } from '@/components/table'
import { Switch } from '@/components/ui/switch'
import { unavailableFor, unavailableText } from '@/components/room/unavailable'
import { jam } from '@/lib/platform'
import { sectionById } from '@/lib/sections'
import { NO_SESSIONS, sessionRows, shownRows } from '@/lib/sessions'
import { cn } from '@/lib/utils'
import { useDaemon, useShellPart } from '@/stores/daemon'

/** Jam's columns, in its order (Jam Desktop 0.4.10, read 2026-09-20 with its `sessions-section` experiment on). */
const COLUMNS = ['Agent', 'Room', 'PID', 'Process', 'Binding', 'Band'] as const

/** Jam counts a host session live within 45 seconds, so the table reads again on that clock while it is open. */
const LIVE_WITHIN_MS = 45_000

/**
 * Sessions (Jam Desktop's Advanced section, behind its `sessions-section` experiment) in ZCode's frame: Jam's title and
 * its line, its Show stopped switch on the right, and its read-only table of every host session. One read answers it,
 * `/v1/list`, which gives each host peer with its own `host_sessions` (`src/renderer/src/lib/sessions.ts`).
 *
 * The table reports what the daemon says and does nothing: no row opens anything, as Jam's rows do not.
 */
export function SessionsPage() {
  const section = sectionById('sessions')
  const connected = useDaemon((state) => state.status.state === 'connected')
  const revision = useDaemon((state) => state.revision)
  const rooms = useShellPart('rooms')
  const [peers, setPeers] = useState<HostPeer[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [showStopped, setShowStopped] = useState(false)

  useEffect(() => {
    const api = jam()
    if (!api || !connected) return
    let current = true
    const read = () => {
      api.daemon
        .hostPeers()
        .then((data) => {
          if (!current) return
          setPeers(data)
          setProblem(null)
        })
        .catch((error: unknown) => {
          if (!current) return
          setPeers(null)
          setProblem(unavailableFor(error, 'Sessions'))
        })
    }
    read()
    // A session ends without anything being said in a room, so nothing in the stream tells this screen.
    // Jam's own table settles within 45 seconds, so this reads again on the same clock while it is open.
    const timer = setInterval(read, LIVE_WITHIN_MS)
    return () => {
      current = false
      clearInterval(timer)
    }
    // `revision` is a trigger, not a value this effect reads: the shell bumps it on connect, on a daemon event
    // and on focus, and each of those is a reason to read the sessions again sooner than the clock would.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, revision])

  const titles = useMemo(
    () =>
      Object.fromEntries((rooms.state === 'ready' ? rooms.data : []).map((room: Room) => [room.id, room.title ?? ''])),
    [rooms],
  )
  const rows = useMemo(() => sessionRows(peers ?? [], titles), [peers, titles])
  const shown = shownRows(rows, showStopped)
  // Before the daemon has answered there is nothing to say about the sessions: an empty table would report
  // that there are none, which is the one thing it must not do while it does not know. This is read from
  // the answer itself rather than from a flag an effect sets, so the very first frame says it too.
  const away = connected
    ? peers === null && problem === null
      ? 'Reading the host sessions…'
      : null
    : unavailableText('Sessions', 'offline')
  const note = away ?? problem

  return (
    <Page title={section.label} description={section.description}>
      {note ? (
        <p className="text-ui-base text-foreground-subtle">{note}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Jam's switch, above the table on the right. Its words on screen are "Show stopped"; the name it gives
              the control itself, which is what a screen reader says, is "Show stopped sessions". */}
          <div className="flex items-center justify-end gap-2 text-ui-base text-foreground-subtle">
            <span>Show stopped</span>
            <Switch aria-label="Show stopped sessions" checked={showStopped} onCheckedChange={setShowStopped} />
          </div>
          <Table head={COLUMNS} align="lllll" label="Sessions">
            {shown.length === 0 ? (
              <tr className="border-t border-line">
                <Cell colSpan={COLUMNS.length} className="py-6 text-center text-foreground-subtle">
                  {NO_SESSIONS}
                </Cell>
              </tr>
            ) : (
              shown.map((row) => (
                <tr key={row.key} className="border-t border-line">
                  <Cell className="text-foreground">{row.agent}</Cell>
                  {/* A room's name is set as the agent's is; only Jam's words for a session attached to no room are
                      in a monospace face, which is how Jam tells its placeholder from a real title. */}
                  <Cell className={cn('text-foreground-subtle', row.parked && 'font-mono text-ui-sm')}>{row.room}</Cell>
                  <Cell className="text-foreground-subtle tabular-nums">{row.pid}</Cell>
                  <Cell>
                    <StatePill on={row.live}>{row.process}</StatePill>
                  </Cell>
                  <Cell>
                    <StatePill>{row.binding}</StatePill>
                  </Cell>
                  <Cell>
                    <span className="flex items-center gap-2 text-foreground-subtle">
                      <span
                        aria-hidden
                        className={cn(
                          'size-2 shrink-0 rounded-full',
                          row.connected ? 'bg-primary' : 'bg-foreground-subtlest',
                        )}
                      />
                      {row.band}
                    </span>
                  </Cell>
                </tr>
              ))
            )}
          </Table>
        </div>
      )}
    </Page>
  )
}
