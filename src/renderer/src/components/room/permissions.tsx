import { ShieldQuestion } from 'lucide-react'
import { useRef, useState, type RefObject } from 'react'
import type { PermissionRecord } from '@shared/daemon'
import type { PermissionOutcome } from '@shared/daemon-api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { permissionWish } from '@/lib/room-agents'

/** Jam's three answers to a permission request (Jam Desktop 0.4.10's review dialog, in its order). */
export type PermissionDecision = PermissionOutcome

export interface PendingPermission {
  peerKey: string
  record: PermissionRecord
  /** The asking agent's handle, as Jam names it in the banner ("<handle> wants to change files"). */
  agentHandle: string
}

/**
 * Jam's attention banner at the top of a room while permission requests wait: what the oldest asks, how many there are,
 * and Review, which opens the review dialog. Jam reviews queued requests one at a time and never all at once.
 */
export function PermissionBanner({
  pending,
  onReview,
}: {
  pending: readonly PendingPermission[]
  onReview(request: PendingPermission): void
}) {
  const first = pending[0]
  if (!first) return null
  return (
    <div
      role="region"
      aria-label="Permission requests"
      className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-2.5"
    >
      <ShieldQuestion aria-hidden="true" className="size-4 shrink-0 text-warning" />
      <p className="min-w-0 flex-1 text-ui-base text-foreground">
        <span className="font-medium">
          {first.agentHandle} {permissionWish(first.record.request.action)}
        </span>
        <span className="text-foreground-subtle">
          {' · '}
          {pending.length === 1 ? '1 request' : `${pending.length} requests`}
        </span>
      </p>
      <Button size="sm" onClick={() => onReview(first)}>
        Review
      </Button>
    </div>
  )
}

type Decide = (request: PendingPermission, decision: PermissionDecision) => Promise<void>

/**
 * Jam's review dialog: the complete operation as the provider described it, the request, provider and room, what each
 * answer does, and Deny always, Deny and Allow once. Allow once is off when the provider cut the operation it shows
 * (user guide, "Decide a permission request").
 */
export function PermissionReview({
  request,
  onDecide,
  onClose,
}: {
  request: PendingPermission | null
  onDecide: Decide
  onClose(): void
}) {
  // Closing, the dialog keeps the request it showed, so it never shrinks away empty.
  const [last, setLast] = useState(request)
  if (request !== null && request !== last) setLast(request)
  const shown = request ?? last
  // It opens on the operation, the one thing to read before deciding, and not on its first button (Deny always, a
  // standing refusal): a key pressed as it opens decides nothing.
  const operation = useRef<HTMLPreElement>(null)
  return (
    <Dialog open={request !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-xl" initialFocus={operation}>
        {shown ? (
          <ReviewBody
            key={shown.record.request.id}
            request={shown}
            onDecide={onDecide}
            onClose={onClose}
            operation={operation}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** One request's review: a new request starts afresh, without the last one's error (the body is keyed by the request). */
function ReviewBody({
  request,
  onDecide,
  onClose,
  operation,
}: {
  request: PendingPermission
  onDecide: Decide
  onClose(): void
  operation: RefObject<HTMLPreElement | null>
}) {
  const [busy, setBusy] = useState<PermissionDecision | null>(null)
  const [error, setError] = useState<string | null>(null)
  const record = request.record.request
  const decide = async (decision: PermissionDecision) => {
    setBusy(decision)
    setError(null)
    try {
      await onDecide(request, decision)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace(/^\[jam:[a-z-]+\]\s*/, '') : String(reason))
    } finally {
      setBusy(null)
    }
  }
  const truncated = record.display_truncated === true
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {request.agentHandle} {permissionWish(record.action)}
        </DialogTitle>
        <DialogDescription className="sr-only">The complete operation the agent asks to run.</DialogDescription>
      </DialogHeader>
      <pre
        ref={operation}
        tabIndex={-1}
        aria-label="Full operation"
        className="max-h-72 overflow-auto rounded-lg border border-line bg-surface p-3 font-mono text-ui-sm leading-5 whitespace-pre-wrap text-foreground select-text"
      >
        {record.description}
      </pre>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-ui-sm">
        <dt className="text-foreground-subtle">Request</dt>
        <dd className="font-mono break-all text-foreground select-text">{record.id}</dd>
        {record.provider ? (
          <>
            <dt className="text-foreground-subtle">Provider</dt>
            <dd className="font-mono text-foreground">{record.provider}</dd>
          </>
        ) : null}
        {record.chat_id ? (
          <>
            <dt className="text-foreground-subtle">Room</dt>
            <dd className="font-mono break-all text-foreground select-text">{record.chat_id}</dd>
          </>
        ) : null}
      </dl>
      <p className="text-ui-sm text-pretty text-foreground-subtle">
        Answers apply to this request only. “Deny always” refuses every request of this kind from this agent until you
        remove it.
      </p>
      {truncated ? (
        <p className="rounded-lg bg-surface px-3 py-2 text-ui-sm text-pretty text-foreground-subtle">
          The provider did not show this operation in full, so it cannot be allowed. Deny it, or ask the agent to split
          it into steps that can be shown whole.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button variant="outline" disabled={busy !== null} onClick={() => void decide('deny_always')}>
          Deny always
        </Button>
        <Button variant="outline" disabled={busy !== null} onClick={() => void decide('deny_once')}>
          Deny
        </Button>
        <Button disabled={busy !== null || truncated} onClick={() => void decide('allow_once')}>
          Allow once
        </Button>
      </DialogFooter>
    </>
  )
}
