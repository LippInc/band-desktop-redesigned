import { useParams } from '@tanstack/react-router'
import { PanelRight } from 'lucide-react'
import { useState } from 'react'
import { DEFAULT_SETTINGS, SETTINGS_LIMITS } from '@shared/settings'
import { RoomPanel } from '@/components/room/room-panel'
import { ResizeHandle } from '@/components/shell/resize-handle'
import { cn } from '@/lib/utils'
import { useRoom } from '@/stores/room'
import { useSettings } from '@/stores/settings'

/**
 * The side pane (Ctrl+Alt+B), where ZCode opens its review, terminal and browser tabs. In Jam it holds the open room's
 * right panel: Participants, Files and the plan (docs/jam/features.md, "Rooms"). Until a room is open it says so, in
 * ZCode's "Open tab" layout.
 */
export function SidePane() {
  const { sidePaneOpen, sidePaneWidth } = useSettings((state) => state.settings)
  const update = useSettings((state) => state.update)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const width = dragWidth ?? sidePaneWidth
  const { roomId } = useParams({ strict: false })
  const room = useRoom(roomId)

  return (
    <aside
      aria-label="Side pane"
      data-open={sidePaneOpen}
      style={{ width: sidePaneOpen ? width : 0 }}
      className={cn(
        'relative h-full shrink-0 overflow-hidden bg-background',
        sidePaneOpen && 'border-l border-line',
        dragWidth === null && 'transition-[width] duration-200 ease-out',
      )}
    >
      {room ? (
        <div style={{ width }} className="h-full">
          <RoomPanel room={room} />
        </div>
      ) : (
        <div style={{ width }} className="flex h-full flex-col items-center justify-center px-5 py-10 text-center">
          <PanelRight className="mb-4 size-5 text-foreground-subtlest" aria-hidden="true" />
          <h2 className="text-ui-xl leading-7 font-semibold text-foreground">Room details</h2>
          <p className="mt-2 max-w-72 text-ui-base leading-5 text-pretty text-foreground-subtle">
            Open a room to see its participants, files, and plan here.
          </p>
        </div>
      )}
      {sidePaneOpen ? (
        <ResizeHandle
          edge="left"
          label="Resize side pane"
          width={width}
          min={SETTINGS_LIMITS.sidePaneWidth.min}
          max={SETTINGS_LIMITS.sidePaneWidth.max}
          defaultWidth={DEFAULT_SETTINGS.sidePaneWidth}
          onResize={setDragWidth}
          onCommit={(next) => {
            setDragWidth(null)
            void update({ sidePaneWidth: next })
          }}
        />
      ) : null}
    </aside>
  )
}
