import { ArrowRight, Check, ClipboardList, Copy, Ellipsis, FileUp, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { RoomPlan } from '@shared/daemon'
import { SafeMarkdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  askForPlanFile,
  focusBackFor,
  planCommands,
  usePlanProblem,
  usePlanWrite,
  type PlanPlace,
} from '@/lib/use-plan'

/**
 * Starting a choosing, and focus back on this place's control once it has settled: the control is turned off while
 * the choosing is on its way, which drops the focus it had, and a room's first plan swaps Choose file… for Plan actions,
 * so the focus goes to whichever of the two this place shows then (`@/lib/use-plan`). The sending itself lives there
 * too, so no control knows how the file was chosen, only that the person asked for one.
 */
function useChoosing(profile: string, roomId: string, where: PlanPlace, control: RefObject<HTMLButtonElement | null>) {
  const busy = usePlanWrite((state) => state.busy)
  const back = usePlanWrite((state) => state.focus)
  useEffect(() => {
    if (busy || !focusBackFor(usePlanWrite.getState(), where, roomId, Date.now())) return
    usePlanWrite.setState({ focus: null })
    control.current?.focus()
  }, [busy, back, where, roomId, control])
  return { busy, choose: () => void askForPlanFile(profile, roomId, where) }
}

/** Jam's "Choose file…" (the guide) for a room without a plan: the picker opens at once, as nothing is replaced. */
export function ChoosePlanFile({ profile, roomId, where }: { profile: string; roomId: string; where: PlanPlace }) {
  const button = useRef<HTMLButtonElement>(null)
  const { busy, choose } = useChoosing(profile, roomId, where, button)
  return (
    <Button ref={button} variant="ghost" size="sm" className="rounded-full" disabled={busy} onClick={choose}>
      Choose file…
    </Button>
  )
}

/**
 * Jam's "Plan actions" for a room that has a plan (Jam Desktop 0.4.10's plan menu, and the guide's "Plan"): Refresh for
 * a plan that follows its file, Replace with another file…, Remove from this room, then "Or attach from the terminal"
 * with the two commands for this room and Copy command. Refresh and Remove from this room are shown turned off, as this
 * app does not make those two writes. Replacing is asked about before any picker opens - cancelling the ask never
 * opens one; whether Jam asks before or after the file is chosen was not seen.
 */
export function PlanActions({
  plan,
  profile,
  roomId,
  where,
}: {
  plan: RoomPlan
  profile: string
  roomId: string
  where: PlanPlace
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const { busy, choose } = useChoosing(profile, roomId, where, trigger)
  const [asking, setAsking] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  const follows = plan.source !== null && !plan.source.snapshot
  const commands = planCommands(roomId)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              ref={trigger}
              variant="ghost"
              size="icon-sm"
              aria-label="Plan actions"
              className="text-foreground-subtle"
              disabled={busy}
            >
              <Ellipsis />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-80">
          {follows ? (
            <DropdownMenuItem disabled>
              <RefreshCw />
              Refresh
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setAsking(true)}>
            <FileUp />
            Replace with another file…
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <Trash2 />
            Remove from this room
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <div className="flex items-center gap-1 pr-1">
              <DropdownMenuLabel className="flex-1">Or attach from the terminal</DropdownMenuLabel>
              <DropdownMenuItem
                aria-label={copied ? 'Copied' : 'Copy command'}
                closeOnClick={false}
                className="size-7 justify-center px-0 text-foreground-subtle"
                onClick={() => {
                  // A refused write leaves the button as it was: nothing was copied.
                  navigator.clipboard.writeText(commands).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  )
                }}
              >
                {copied ? <Check /> : <Copy />}
              </DropdownMenuItem>
            </div>
            <pre
              data-commands
              className="mx-2 mb-1.5 overflow-x-auto rounded-lg bg-strip px-2 py-1.5 font-mono text-ui-sm text-foreground-subtle select-text"
            >
              {commands}
            </pre>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="max-w-110">
          <DialogHeader>
            <DialogTitle>Replace this room&apos;s plan?</DialogTitle>
          </DialogHeader>
          <p className="text-ui-base text-foreground-subtle">
            The plan will be replaced by the Markdown file you choose.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setAsking(false)
                choose()
              }}
            >
              Replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * The room's plan at the top of Chat, as ZCode shows a task's plan card (docs/DESIGN.md, "Room"): a card of radius 12
 * with "Plan" and the plan's label, the start of its text fading out, a copy button, and "View full plan", which opens
 * the plan in the side pane. A room without a plan keeps its card, saying so, with Choose file…; a room with one has
 * Jam's Plan actions here.
 */
export function PlanCard({
  plan,
  profile,
  roomId,
  onOpen,
}: {
  plan: RoomPlan
  profile: string
  roomId: string
  onOpen(): void
}) {
  const body = plan.cache?.body ?? ''
  const hasPlan = plan.source !== null || plan.cache !== null
  const problem = usePlanProblem('card', roomId)

  return (
    <section aria-label="Plan" className="relative overflow-hidden rounded-xl border border-line bg-card">
      <header className="flex h-12 items-center gap-2 pr-2 pl-4">
        <ClipboardList className="size-4 shrink-0 text-foreground-subtle" aria-hidden="true" />
        <span className="shrink-0 text-ui-base font-medium text-foreground-subtle">Plan</span>
        {plan.source?.label ? (
          <span className="min-w-0 truncate text-ui-base text-foreground-subtlest">{plan.source.label}</span>
        ) : null}
        <span className="flex-1" />
        {body ? <CopyButton text={body} /> : null}
        {hasPlan ? (
          <PlanActions plan={plan} profile={profile} roomId={roomId} where="card" />
        ) : (
          <ChoosePlanFile profile={profile} roomId={roomId} where="card" />
        )}
      </header>
      {problem ? (
        <p role="status" className="px-4 pb-2 text-ui-sm text-foreground-subtle">
          {problem}
        </p>
      ) : null}
      {hasPlan ? (
        <>
          <div className="max-h-60 overflow-hidden mask-b-from-20% px-4 pb-16">
            <PlanText plan={plan} className="text-foreground-subtle" />
          </div>
          <div className="absolute inset-x-0 bottom-4 flex justify-center">
            <Button size="sm" className="rounded-full" onClick={onOpen}>
              View full plan
              <ArrowRight />
            </Button>
          </div>
        </>
      ) : (
        <p className="px-4 pb-4 text-ui-base text-foreground-subtle">No plan yet.</p>
      )}
    </section>
  )
}

/**
 * A plan's text as Markdown, or why it is not shown: Jam has not read its file yet, or it is not Markdown. A room
 * without a plan is said by each caller before it reaches here.
 */
export function PlanText({ plan, className }: { plan: RoomPlan; className?: string }) {
  if (!plan.cache) {
    return <p className="text-ui-base text-foreground-subtle">Band has not read this plan&apos;s file yet.</p>
  }
  if (plan.cache.content_type === 'markdown' || plan.source?.kind === 'markdown') {
    return <SafeMarkdown className={className} text={plan.cache.body} />
  }
  return <p className="text-ui-base text-foreground-subtle">This plan is not Markdown; showing it arrives later.</p>
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  const label = copied ? 'Copied' : 'Copy plan'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className="text-foreground-subtle"
            onClick={() => {
              // A refused write leaves the button as it was: nothing was copied.
              navigator.clipboard.writeText(text).then(
                () => setCopied(true),
                () => setCopied(false),
              )
            }}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
