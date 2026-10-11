import { useRef } from 'react'
import { cn } from '@/lib/utils'

interface ResizeHandleProps {
  /** Which edge of its panel the handle sits on; dragging away from the panel makes it wider. */
  edge: 'right' | 'left'
  width: number
  min: number
  max: number
  defaultWidth: number
  label: string
  onResize(width: number): void
  onCommit(width: number): void
}

const KEY_STEP = 16

/**
 * A window splitter on a panel edge (WAI-ARIA "window splitter"): drag to resize, arrow keys move it 16 at a time, Home
 * and End go to the limits, double-click or Enter goes back to the default width.
 */
export function ResizeHandle({ edge, width, min, max, defaultWidth, label, onResize, onCommit }: ResizeHandleProps) {
  const start = useRef<{ x: number; width: number } | null>(null)
  const clamp = (value: number) => Math.min(max, Math.max(min, Math.round(value)))
  const grow = edge === 'right' ? 1 : -1

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      onDoubleClick={() => onCommit(defaultWidth)}
      onKeyDown={(event) => {
        const next =
          event.key === 'ArrowRight'
            ? width + KEY_STEP * grow
            : event.key === 'ArrowLeft'
              ? width - KEY_STEP * grow
              : event.key === 'Home'
                ? min
                : event.key === 'End'
                  ? max
                  : event.key === 'Enter'
                    ? defaultWidth
                    : null
        if (next === null) return
        event.preventDefault()
        onCommit(clamp(next))
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        start.current = { x: event.clientX, width }
      }}
      onPointerMove={(event) => {
        if (!start.current) return
        onResize(clamp(start.current.width + (event.clientX - start.current.x) * grow))
      }}
      onPointerUp={(event) => {
        if (!start.current) return
        const next = clamp(start.current.width + (event.clientX - start.current.x) * grow)
        start.current = null
        onCommit(next)
      }}
      className={cn(
        'absolute top-0 bottom-0 z-10 w-0.75 cursor-col-resize outline-none no-drag focus-visible:bg-brand-text/40',
        // 3 px just inside the panel's edge: the panel clips what reaches past it (it folds to no width), so a part
        // outside would show and take nothing, and a wider one inside would cover the room list's scrollbar thumb.
        edge === 'right' ? 'right-0' : 'left-0',
      )}
    />
  )
}
