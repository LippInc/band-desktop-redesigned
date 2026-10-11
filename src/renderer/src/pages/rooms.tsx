import { Plus } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { EmptyCard, Page } from '@/components/page'
import { unavailableText } from '@/components/room/unavailable'
import { Button } from '@/components/ui/button'
import { jam } from '@/lib/platform'
import { sectionById } from '@/lib/sections'
import { useDaemon, useShellPart } from '@/stores/daemon'
import { useSettings } from '@/stores/settings'

/** Rooms without one open (user guide, "Rooms"). The list itself lives in the sidebar, where ZCode keeps its tasks. */
export function RoomsPage() {
  const section = sectionById('rooms')
  const rooms = useShellPart('rooms')
  const profile = useSettings((state) => state.settings.profile)
  const [making, setMaking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const navigate = useNavigate()
  const count = rooms.state === 'ready' ? rooms.data.length : null

  // The same New room as the list's own: it opens an empty room, titled "New Session" until it is renamed.
  const newRoom = () => {
    const api = jam()
    if (!api || making) return
    setMaking(true)
    setProblem(null)
    api.daemon
      .createRoom({ profile })
      .then((room) => {
        void useDaemon.getState().refresh(profile)
        void navigate({ to: '/rooms/$roomId', params: { roomId: room.id } })
      })
      .catch(() => setProblem('Band could not make that room.'))
      .finally(() => setMaking(false))
  }

  return (
    <Page
      title={section.label}
      actions={
        <Button onClick={newRoom} disabled={making}>
          <Plus />
          New room
        </Button>
      }
    >
      <EmptyCard
        title={
          count === 0
            ? 'No rooms yet.'
            : rooms.state === 'unavailable'
              ? 'Rooms are unavailable right now.'
              : 'Choose a room in the sidebar.'
        }
        // When the rooms cannot be read, why, as a room's own card says it; otherwise how to start one.
        description={
          rooms.state === 'unavailable'
            ? unavailableText('Rooms', rooms.reason)
            : 'Assign work from Home to start a room with an agent, or create one here.'
        }
      />
      {problem ? (
        <p role="status" className="mt-3 text-ui-base text-foreground-subtle">
          {problem}
        </p>
      ) : null}
    </Page>
  )
}
