import { Paperclip, X } from 'lucide-react'
import { useRef, type RefObject } from 'react'
import type { StagedFile } from '@/lib/attachments'
import { byteSize } from '@/lib/rooms'
import { Button } from '@/components/ui/button'

/**
 * The files staged onto a message, drawn above the instruction, each removable before sending (user guide, "Use
 * attachments": "Staged files appear above the instruction. Remove a file before sending."). Why a file could not be
 * staged is said under them, in a status line that is always there, so a screen reader hears each refusal; the
 * composer's field names that line as its description. Ten rows scroll in a strip of their own, so the field and its
 * Send stay in view in a short window. While a send carrying the files is on its way, none can be removed.
 */
export function StagedFiles({
  files,
  problem,
  sending,
  statusId,
  field,
  onRemove,
}: {
  files: readonly StagedFile[]
  problem: string | null
  sending: boolean
  statusId: string
  /** Where focus goes when the last staged file is removed. */
  field: RefObject<HTMLTextAreaElement | null>
  onRemove(key: string): void
}) {
  const list = useRef<HTMLDivElement>(null)
  // The Remove that had focus goes with its row: focus moves to the row that took its place, or the one before it,
  // or back to the field when none is left.
  const remove = (key: string, index: number) => {
    onRemove(key)
    requestAnimationFrame(() => {
      const buttons = list.current?.querySelectorAll<HTMLButtonElement>('button[data-remove]')
      const next = buttons?.[Math.min(index, buttons.length - 1)]
      if (next) next.focus()
      else field.current?.focus()
    })
  }
  return (
    <>
      {files.length > 0 ? (
        <div
          ref={list}
          role="group"
          aria-label="Attached files"
          className="flex max-h-40 flex-col gap-1.5 overflow-y-auto"
        >
          {files.map((file, index) => (
            <div
              key={file.key}
              className="flex shrink-0 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5"
            >
              <Paperclip className="size-3.5 shrink-0 text-foreground-subtle" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground">{file.name}</span>
              <span className="shrink-0 text-ui-xs text-foreground-subtle">{byteSize(file.bytes)}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                data-remove=""
                aria-label={`Remove ${file.name}`}
                disabled={sending}
                className="size-6 shrink-0"
                onClick={() => remove(file.key, index)}
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      {/* Kept in the accessibility tree when empty (sr-only, not hidden), so the refusal that fills it is heard. */}
      <p id={statusId} role="status" className={problem ? 'text-ui-sm text-foreground-subtle' : 'sr-only'}>
        {problem ?? ''}
      </p>
    </>
  )
}
