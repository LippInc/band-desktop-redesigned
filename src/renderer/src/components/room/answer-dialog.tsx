import { Check } from 'lucide-react'
import { useState } from 'react'
import type { AgentQuestion } from '@shared/daemon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export interface QuestionToAnswer {
  question: AgentQuestion
  /** The room the question was asked in: Inbox answers one without that room being open. */
  roomId: string
  agentId: string | null
  agentName: string
}

type Send = (target: QuestionToAnswer, answer: string) => Promise<void>

/**
 * Jam's answer dialog (Jam Desktop 0.4.10): "Answer <agent>", "<agent> needs your input", the question, its options as
 * rows to choose (several when the question allows it), and Cancel and Send answer, which stays off until an answer is
 * chosen. A question without options takes typed text.
 */
export function AnswerDialog({
  target,
  onSend,
  onClose,
}: {
  target: QuestionToAnswer | null
  onSend: Send
  onClose(): void
}) {
  // Closing, the dialog keeps the question it showed, so it never shrinks away empty.
  const [last, setLast] = useState(target)
  if (target !== null && target !== last) setLast(target)
  const shown = target ?? last
  return (
    <Dialog open={target !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        {shown ? <AnswerBody key={shown.question.id} target={shown} onSend={onSend} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  )
}

/** One question's choices and draft: a new question starts afresh (the body is keyed by the question). */
function AnswerBody({ target, onSend, onClose }: { target: QuestionToAnswer; onSend: Send; onClose(): void }) {
  const [chosen, setChosen] = useState<string[]>([])
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { question } = target
  const options = question.options ?? []
  const answer = options.length ? chosen.join(', ') : typed.trim()
  const toggle = (option: string) =>
    setChosen((current) =>
      question.multi_select
        ? current.includes(option)
          ? current.filter((item) => item !== option)
          : [...current, option]
        : [option],
    )
  const send = async () => {
    if (!answer) return
    setBusy(true)
    setError(null)
    try {
      await onSend(target, answer)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace(/^\[jam:[a-z-]+\]\s*/, '') : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Answer {target.agentName}</DialogTitle>
        <DialogDescription>{target.agentName} needs your input</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <p className="text-ui-base text-foreground">{question.prompt}</p>
        {options.length ? (
          <div role="group" aria-label="Answers" className="flex flex-col gap-2">
            {options.map((option) => {
              const on = chosen.includes(option)
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(option)}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-ui-base font-medium text-foreground transition-colors',
                    on ? 'border-brand-text bg-selected' : 'border-line hover:bg-hover',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center border',
                      question.multi_select ? 'rounded-sm' : 'rounded-full',
                      on ? 'border-brand-text bg-brand-text text-background' : 'border-line-strong',
                    )}
                  >
                    {on ? <Check className="size-3" /> : null}
                  </span>
                  {option}
                </button>
              )
            })}
          </div>
        ) : (
          <textarea
            aria-label="Your answer"
            rows={3}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className="w-full resize-none rounded-xl border border-line bg-input px-3 py-2 text-ui-base text-foreground outline-none placeholder:text-foreground-subtlest"
            placeholder="Type your answer…"
          />
        )}
        {error ? (
          <p role="alert" className="text-ui-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!answer || busy} onClick={() => void send()}>
          Send answer
        </Button>
      </DialogFooter>
    </>
  )
}
