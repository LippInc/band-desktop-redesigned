import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Input } from '@/components/ui/input'
import { IconButton } from '@/components/shell/icon-button'
import { commandById, type Command } from '@/commands/use-commands'
import type { FindHit } from '@/lib/find'
import { cn } from '@/lib/utils'

/**
 * Find in conversation (Jam Desktop 0.4.10: a control in a room's header, before Event type). Closed it is that
 * control; open it is the field, the count of matches and the way through them, and Escape closes it. What Jam shows
 * once it is pressed was never seen, so the field, its count and its arrows are this app's own
 * (`docs/jam/differences.md`).
 */
export function FindInConversation({
  open,
  asked,
  query,
  count,
  results,
  at,
  commands,
  onOpen,
  onQuery,
  onStep,
  onGo,
  onClose,
}: {
  open: boolean
  /** How many times it has been asked for: asking again puts the caret back in the field, with the words chosen. */
  asked: number
  query: string
  /** "1 of 7", "No matches", or nothing to count yet. */
  count: string | null
  /** The matches, newest first, as Jam lists them. */
  results: FindHit[]
  /** Which of them is chosen, or -1 for none. */
  at: number
  commands: Command[]
  onOpen(): void
  onQuery(query: string): void
  onStep(by: 1 | -1): void
  /** Go to a match: the conversation brings it into view and marks it. */
  onGo(id: string): void
  onClose(): void
}) {
  const field = useRef<HTMLInputElement>(null)
  const wrapper = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  /**
   * The list stands over the page, from the field's own place on screen: the room's header holds the find bar and
   * clips what it holds (it must, to keep its own height), so a list drawn inside it is a sliver (seen 2026-09-21).
   */
  const [box, setBox] = useState<{ top: number; right: number } | null>(null)
  useLayoutEffect(() => {
    if (!open || results.length === 0) {
      // oxlint-disable-next-line react/set-state-in-effect -- see below: the place is measured, not derived
      setBox(null)
      return
    }
    const measure = () => {
      const place = wrapper.current?.getBoundingClientRect()
      // oxlint-disable-next-line react/set-state-in-effect -- where the field is on screen can only be measured once
      // it is on screen; there is nothing to derive it from during the render.
      if (place) setBox({ top: place.bottom + 4, right: Math.max(8, window.innerWidth - place.right) })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, results.length])

  // The choice moves with the arrow keys, and the list scrolls to keep it in sight, itself and not the page.
  useEffect(() => {
    const chosen = list.current?.querySelector('[aria-current=true]')
    chosen?.scrollIntoView({ block: 'nearest' })
  }, [at])
  /**
   * Escape closes it from anywhere in it - the field or one of its buttons. It is heard at the document, first: a
   * tooltip opened by focusing a button hears Escape there too, and would otherwise take it (docs/DESIGN.md's
   * tooltip note; seen 2026-09-21).
   */
  useEffect(() => {
    if (!open) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const inside = wrapper.current?.contains(document.activeElement)
      if (!inside) return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', escape, true)
    return () => document.removeEventListener('keydown', escape, true)
  }, [open, onClose])
  // Opening it puts the caret in it, however it was opened - the control, the palette or Jam's own shortcut - and
  // asking for it again while it is open brings the caret back and chooses what is there, as a find bar does.
  useEffect(() => {
    if (!open) return
    field.current?.focus()
    field.current?.select()
  }, [open, asked])

  if (!open) {
    const command = commandById(commands, 'room:find')
    return (
      <IconButton label={command.label} shortcut={command.shortcut} onClick={onOpen}>
        <Search aria-hidden />
      </IconButton>
    )
  }

  return (
    <div ref={wrapper} data-slot="find" className="relative flex items-center gap-1">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-subtle"
          aria-hidden
        />
        <Input
          ref={field}
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            // The arrow keys move through the list and Enter goes to the one chosen (user guide, "Use Chat").
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              onStep(1)
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              onStep(-1)
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              const chosen = results[at]
              if (chosen) onGo(chosen.id)
            }
          }}
          placeholder="Find in conversation…"
          aria-label="Find in conversation"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="find-results"
          aria-activedescendant={results[at] ? `find-result-${results[at].id}` : undefined}
          className="w-56 pl-9"
        />
      </div>
      {count === null ? null : (
        <span data-slot="find-count" aria-live="polite" className="min-w-16 text-ui-sm text-foreground-subtle">
          {count}
        </span>
      )}
      <IconButton label="Previous match" onClick={() => onStep(-1)}>
        <ChevronUp aria-hidden />
      </IconButton>
      <IconButton label="Next match" onClick={() => onStep(1)}>
        <ChevronDown aria-hidden />
      </IconButton>
      <IconButton label="Close find" onClick={onClose}>
        <X aria-hidden />
      </IconButton>
      {box === null
        ? null
        : createPortal(
            <ul
              ref={list}
              id="find-results"
              data-slot="find-results"
              aria-label="Matches"
              style={{ top: box.top, right: box.right }}
              className="fixed z-50 max-h-80 w-96 overflow-y-auto rounded-xl border border-line bg-popover p-1 shadow-popover"
            >
              {results.map((hit, index) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    id={`find-result-${hit.id}`}
                    aria-current={index === at ? 'true' : undefined}
                    tabIndex={-1}
                    data-find-result={hit.id}
                    onClick={() => onGo(hit.id)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                      index === at ? 'bg-selected' : 'hover:bg-hover',
                    )}
                  >
                    <span className="flex items-baseline gap-2 text-ui-sm">
                      <span className="truncate font-medium text-foreground">{hit.sender}</span>
                      <span className="shrink-0 text-ui-xs text-foreground-subtlest">{hit.time}</span>
                    </span>
                    <span className="line-clamp-2 text-ui-xs text-foreground-subtle">{hit.excerpt}</span>
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )}
    </div>
  )
}
