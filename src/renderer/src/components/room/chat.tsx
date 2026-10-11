import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleDot,
  Copy,
  FilePen,
  FileSearch,
  Maximize2,
  MessageCircleQuestion,
  Reply,
  SquareTerminal,
  Wrench,
} from 'lucide-react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { RoomMessage } from '@shared/daemon'
import { SafeMarkdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  answersByCode,
  DEFAULT_EVENT_TYPES,
  EVENT_TYPES,
  eventTypeOf,
  messageDay,
  messageTime,
  questionCardOf,
  taskEventText,
  toolFullOf,
  toolJsonOf,
  toolRowOf,
  type EventType,
} from '@/lib/messages'
import { jam } from '@/lib/platform'
import { initialsOf } from '@/lib/rooms'
import type { OpenQuestion, RoomAgent } from '@/lib/room-agents'
import { cn } from '@/lib/utils'

/** The conversation's filters, as Jam Desktop's Event type and Sender menus set them. */
export interface ChatFilter {
  types: ReadonlySet<EventType>
  /** The senders hidden, by id ('' for a message without one): any other sender shows, one who joins later too. */
  hiddenSenders: ReadonlySet<string>
}

export const DEFAULT_CHAT_FILTER: ChatFilter = { types: new Set(DEFAULT_EVENT_TYPES), hiddenSenders: new Set() }

/** A sender the Sender menu lists: a participant of the room, or someone who wrote in it before. */
export interface ChatSender {
  id: string
  name: string
}

export type { OpenQuestion }

/**
 * The conversation as the filters leave it (Jam's Event type and Sender). Find looks through this and nothing else:
 * a match behind a filter could not be reached.
 */
export function shownMessages(messages: readonly RoomMessage[], filter: ChatFilter): RoomMessage[] {
  return messages.filter(
    (message) => filter.types.has(eventTypeOf(message)) && !filter.hiddenSenders.has(message.sender_id ?? ''),
  )
}

export interface ConversationProps {
  messages: readonly RoomMessage[]
  filter: ChatFilter
  /** Participant names by id, for mentions. */
  names: Record<string, string>
  /** The person reading (their participant id is their account's user id). */
  selfId: string | null
  /** Open questions by answer code. */
  openQuestions: ReadonlyMap<string, OpenQuestion>
  /** What waits on the person cannot be read now (the inbox came in a form this app does not know). */
  waitingUnknown: boolean
  onAnswer(code: string): void
  onShowAll(): void
  /** The conversation's own beginning is being read into it (`@/lib/history`). */
  busy?: boolean
  /** The message Find in conversation was taken to: it is marked and brought into view (`@/lib/find`). */
  found?: string | null
  /** How many times a match has been gone to: going to the same one again brings it into view again. */
  went?: number
  /** The words the search found, marked in the message it took the person to (user guide, "Use Chat"). */
  words?: string
}

/**
 * Jam's conversation (Jam Desktop 0.4.10) in ZCode's task view (docs/DESIGN.md, "Room"): each message with its sender,
 * avatar and time as Jam shows them, a divider per day; a person's words in ZCode's bordered card, an agent's as prose,
 * a system event (someone joined) as Jam shows it, with its sender and time; tool calls, their results and a turn's
 * lifecycle as ZCode's quiet activity rows. It opens at the newest message and follows new ones while the reader is at
 * the end.
 */
export function Conversation({
  messages,
  filter,
  names,
  selfId,
  openQuestions,
  waitingUnknown,
  onAnswer,
  onShowAll,
  busy = false,
  found = null,
  went = 0,
  words = '',
}: ConversationProps) {
  const answers = useMemo(() => answersByCode(messages), [messages])
  const shown = useMemo(() => shownMessages(messages, filter), [messages, filter])
  const end = useRef<HTMLDivElement | null>(null)
  const atEnd = useRef(true)
  const watching = useRef<IntersectionObserver | null>(null)
  // The end marker is watched from the moment it appears, again after filters that showed nothing bring it back, and
  // against the room's own scroller, where the conversation scrolls.
  const endMarker = useCallback((marker: HTMLDivElement | null) => {
    watching.current?.disconnect()
    watching.current = null
    end.current = marker
    if (!marker || typeof IntersectionObserver === 'undefined') return
    const root = marker.closest('[data-slot=room-scroll]')
    watching.current = new IntersectionObserver(([entry]) => (atEnd.current = entry?.isIntersecting ?? true), {
      root,
      rootMargin: '0px 0px 160px 0px',
    })
    watching.current.observe(marker)
  }, [])
  // The match being looked at is brought into view, and nothing else moves the conversation for it.
  const conversation = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (found === null) return
    conversation.current?.querySelector('[data-find=current]')?.scrollIntoView({ block: 'center' })
    // `went` counts the goings, so going to the same match again brings it into view again.
  }, [found, went])

  const newest = shown.at(-1)?.id
  useLayoutEffect(() => {
    // Follow a new message while the reader is at the end (and open at the end: atEnd starts true). The newest message's
    // id, not the count, so a new one still counts when an older one leaves the daemon's window.
    if (newest !== undefined && atEnd.current) end.current?.scrollIntoView({ block: 'end' })
  }, [newest])

  if (shown.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-ui-base text-foreground-subtle">No events match the filters.</p>
        <Button variant="outline" size="sm" onClick={onShowAll}>
          Show all events
        </Button>
      </div>
    )
  }

  return (
    // A log announces what is added to it, which is right for a message arriving and wrong for a conversation's
    // whole beginning landing at once: while that is being read, the log says it is busy.
    <div
      ref={conversation}
      data-slot="conversation"
      role="log"
      aria-label="Conversation"
      aria-busy={busy || undefined}
      className="flex flex-col gap-5"
    >
      {withDays(shown).map(({ message, day }) => {
        return (
          <div
            key={message.id}
            data-find={message.id === found ? 'current' : undefined}
            className={cn(
              'flex flex-col gap-5',
              message.id === found && 'rounded-lg outline-2 outline-offset-4 outline-primary',
            )}
          >
            {day ? <DayDivider day={day} /> : null}
            <MessageItem
              found={message.id === found}
              words={message.id === found ? words : ''}
              message={message}
              names={names}
              selfId={selfId}
              answers={answers}
              openQuestions={openQuestions}
              waitingUnknown={waitingUnknown}
              onAnswer={onAnswer}
            />
          </div>
        )
      })}
      <div ref={endMarker} className="h-px" aria-hidden="true" />
    </div>
  )
}

/** Each message with the day to show above it: the first message of each day carries its day, the others none. */
function withDays(messages: readonly RoomMessage[]): { message: RoomMessage; day: string | null }[] {
  return messages.map((message, index) => {
    const day = messageDay(message.inserted_at)
    const before = index > 0 ? messageDay(messages[index - 1]!.inserted_at) : ''
    return { message, day: day && day !== before ? day : null }
  })
}

function DayDivider({ day }: { day: string }) {
  return (
    <div role="separator" aria-label={day} className="flex items-center gap-3 text-ui-xs text-foreground-subtlest">
      <span className="h-px flex-1 bg-line" />
      <span>{day}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

function MessageItem({
  message,
  names,
  selfId,
  answers,
  openQuestions,
  waitingUnknown,
  onAnswer,
  found,
  words,
}: {
  message: RoomMessage
  names: Record<string, string>
  selfId: string | null
  answers: ReturnType<typeof answersByCode>
  openQuestions: ReadonlyMap<string, OpenQuestion>
  waitingUnknown: boolean
  onAnswer(code: string): void
  /** Find took the person to this message: a long one opens, so the words they came for are on screen. */
  found?: boolean
  /** The words it found, marked where they are said. */
  words?: string
}) {
  const type = eventTypeOf(message)
  if (type !== 'message' && type !== 'error' && type !== 'system')
    return <ActivityRow message={message} found={found} words={words} />
  const mentions = { names: { ...names, ...message.mention_names }, selfId }
  const question = type === 'message' ? questionCardOf(message) : null
  const person = message.sender_type === 'User'
  const name = message.sender_name || (person ? 'Someone' : 'Agent')
  const time = messageTime(message.inserted_at)
  return (
    <article
      aria-label={`${name}${time ? `, ${time}` : ''}`}
      data-sender={person ? 'person' : 'agent'}
      className="group relative flex gap-3"
    >
      <Initials name={name} className="size-7" />
      <div className="min-w-0 flex-1">
        <header className="flex items-baseline gap-2 pr-8">
          <span className="truncate text-ui-base font-semibold text-foreground">{name}</span>
          {time ? <time className="shrink-0 text-ui-xs text-foreground-subtlest">{time}</time> : null}
        </header>
        <div className="mt-1">
          {question ? (
            <QuestionCard
              text={question.text}
              mentions={mentions}
              words={words}
              answered={answers.get(question.answerCode) ?? null}
              open={openQuestions.has(question.answerCode)}
              waitingUnknown={waitingUnknown}
              onAnswer={() => onAnswer(question.answerCode)}
            />
          ) : (
            <Collapsible long={isLong(message.content)} show={found}>
              <div
                className={cn(
                  person &&
                    type === 'message' &&
                    'w-fit max-w-full rounded-xl rounded-tl-xs border border-line bg-surface px-3.5 py-2.5',
                  type === 'error' && 'rounded-xl border border-destructive/40 px-3.5 py-2.5',
                )}
              >
                <SafeMarkdown
                  text={message.content}
                  mentions={mentions}
                  highlight={words}
                  breaks
                  className={type === 'system' ? 'text-foreground-subtle' : undefined}
                />
              </div>
            </Collapsible>
          )}
          {message.cut ? (
            <p className="mt-1.5 text-ui-sm text-foreground-subtle">This message is longer than this app shows.</p>
          ) : null}
          {message.attachments > 0 ? (
            <p className="mt-1.5 text-ui-sm text-foreground-subtle">
              {message.attachments === 1 ? '1 attachment' : `${message.attachments} attachments`} (in Files)
            </p>
          ) : null}
        </div>
      </div>
      <CopyButton text={message.content} />
    </article>
  )
}

/**
 * Whether a message folds: Jam Desktop 0.4.10 folded a permission request of about 550 characters and four lines to its
 * first lines, so a message longer than about four lines' worth folds here too.
 */
function isLong(text: string): boolean {
  return text.length > 400 || text.split('\n').length > 6
}

/**
 * A long message folds, as Jam Desktop folds one, behind "Show full message" - and opens when Find takes the person to it:
 * the words they came for may be past the fold, and the list has just shown them those words.
 */
function Collapsible({ long, show, children }: { long: boolean; show?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  if (!long) return <>{children}</>
  const unfolded = open || show === true
  return (
    <div className="flex flex-col items-start gap-1">
      <div
        className={cn(
          'w-full',
          !unfolded && 'max-h-32 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]',
        )}
      >
        {children}
      </div>
      <Button variant="ghost" size="xs" aria-expanded={unfolded} onClick={() => setOpen(!unfolded)}>
        <ChevronDown className={cn('transition-transform', unfolded && 'rotate-180')} />
        {unfolded ? 'Collapse message' : 'Show full message'}
      </Button>
    </div>
  )
}

/**
 * An agent's question, as Jam Desktop shows it: the question and its options, and an Answer button while it waits; once
 * answered, who answered and what. A question no longer waiting and never answered here (it timed out) says so, unless
 * what waits cannot be read right now: then it says that instead of guessing.
 */
function QuestionCard({
  text,
  mentions,
  words,
  answered,
  open,
  waitingUnknown,
  onAnswer,
}: {
  text: string
  mentions: { names: Record<string, string>; selfId: string | null }
  /** The words a search found in it, marked where they are said. */
  words?: string
  answered: { by: string; answer: string } | null
  open: boolean
  waitingUnknown: boolean
  onAnswer(): void
}) {
  return (
    <div data-question={answered ? 'answered' : open ? 'open' : 'closed'} className="flex flex-col items-start gap-3">
      <SafeMarkdown text={text} mentions={mentions} highlight={words} breaks />
      {answered ? (
        <p className="flex items-center gap-1.5 text-ui-sm text-foreground-subtle">
          <Check aria-hidden="true" className="size-4 text-success" />
          <span className="font-medium text-foreground">Answered by {answered.by}</span>
          <span className="truncate">{answered.answer}</span>
        </p>
      ) : open ? (
        <Button variant="outline" size="sm" onClick={onAnswer}>
          <Maximize2 />
          Answer…
        </Button>
      ) : (
        <p className="text-ui-sm text-foreground-subtle">
          {waitingUnknown
            ? 'Whether this question still waits cannot be shown right now.'
            : 'No longer waiting for an answer.'}
        </p>
      )}
    </div>
  )
}

const TOOL_ICONS: Record<string, typeof Wrench> = {
  Terminal: SquareTerminal,
  Read: FileSearch,
  Search: FileSearch,
  Write: FilePen,
  Edit: FilePen,
  Question: MessageCircleQuestion,
  Reply,
}

/**
 * A tool call, its result, a turn's lifecycle or a thought, as ZCode's quiet activity row: a 16 icon, a label at 500 and a
 * one-line detail, all at the quietest ink. A tool row carries Jam's own control under it (Jam Desktop 0.4.10): "View full
 * JSON" for a call, "View full output" for a result's text, which opens the whole of it under the row as plain text. Find
 * going to a tool row opens it too, since the words it found may be anywhere in the call, and marks them there; when they
 * are not in what the row opens to (a result's name or id), it opens to the whole of the message instead.
 */
function ActivityRow({
  message,
  found = false,
  words = '',
}: {
  message: RoomMessage
  found?: boolean
  words?: string
}) {
  const type = eventTypeOf(message)
  const time = messageTime(message.inserted_at)
  const tool = type === 'tool_call' || type === 'tool_result'
  const [open, setOpen] = useState(found)
  // Find arriving here opens the row; it is noticed while rendering, as the room's review dialog notices its request.
  const [foundBefore, setFoundBefore] = useState(found)
  if (found !== foundBefore) {
    setFoundBefore(found)
    if (found) setOpen(true)
  }
  const full = useMemo(() => (tool ? toolFullOf(message) : null), [tool, message])
  const needle = found ? words.trim().toLowerCase() : ''
  const shown = full && needle && !full.text.toLowerCase().includes(needle) ? toolJsonOf(message) : (full?.text ?? '')
  // The first of the words found is brought into view inside the block, which scrolls on its own.
  const block = useRef<HTMLPreElement | null>(null)
  useLayoutEffect(() => {
    if (open && needle) block.current?.querySelector('mark')?.scrollIntoView({ block: 'nearest' })
  }, [open, needle])
  let icon = <CircleDot />
  let label = ''
  let detail = ''
  let failed = false
  if (type === 'tool_call' || type === 'tool_result') {
    const row = toolRowOf(message)
    const Icon = row.failed ? CircleAlert : (TOOL_ICONS[row.label] ?? Wrench)
    icon = <Icon />
    label = type === 'tool_result' ? `${row.label} result` : row.label
    detail = row.detail
    failed = row.failed
  } else if (type === 'task') {
    label = taskEventText(message)
  } else {
    // A thought: its text on one line.
    detail = message.content.replace(/\s+/g, ' ').trim()
  }
  return (
    <div data-event={type} className="flex min-w-0 flex-col gap-1.5">
      <div
        title={[message.sender_name, time].filter(Boolean).join(' · ') || undefined}
        className={cn(
          'flex min-w-0 items-center gap-2 pl-10 text-ui-base text-foreground-subtlest [&_svg]:size-4 [&_svg]:shrink-0',
          failed && '[&_svg]:text-destructive',
        )}
      >
        {icon}
        {label ? <span className="shrink-0 font-medium">{label}</span> : null}
        {detail ? <span className="min-w-0 truncate">{detail}</span> : null}
        <span className="ml-auto" />
        {full ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
            className="shrink-0 rounded-md px-1 text-ui-xs text-foreground-subtlest hover:text-foreground-subtle"
          >
            {full.label}
          </button>
        ) : null}
        {message.sender_name ? <span className="shrink-0 text-ui-xs">{message.sender_name}</span> : null}
      </div>
      {full && open ? (
        <pre
          ref={block}
          data-full={shown === full.text && full.label === 'View full output' ? 'output' : 'json'}
          className="ml-10 max-h-72 overflow-auto rounded-lg border border-line bg-surface p-3 font-mono text-ui-sm leading-5 whitespace-pre-wrap text-foreground-subtle select-text"
        >
          <MarkedText text={shown} needle={needle} />
        </pre>
      ) : null}
    </div>
  )
}

/** Plain text with each place the words are said marked, as the Markdown's own marks look; the text stays text. */
function MarkedText({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>
  const lower = text.toLowerCase()
  const parts: ReactNode[] = []
  let at = 0
  for (let hit = lower.indexOf(needle); hit !== -1; hit = lower.indexOf(needle, at)) {
    if (hit > at) parts.push(text.slice(at, hit))
    parts.push(
      <mark key={hit} className="rounded bg-primary/30 text-foreground">
        {text.slice(hit, hit + needle.length)}
      </mark>,
    )
    at = hit + needle.length
  }
  parts.push(text.slice(at))
  return <>{parts}</>
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={copied ? 'Copied' : 'Copy'}
      className="absolute top-0 right-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => {})
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  )
}

export function Initials({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-secondary text-ui-xs font-semibold text-foreground',
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  )
}

/**
 * Jam Desktop's Event type and Sender menus, beside the room's views: which kinds of event and whose the conversation
 * shows, each with its count.
 */
export function ChatFilters({
  messages,
  participants,
  filter,
  onChange,
}: {
  messages: readonly RoomMessage[]
  /** The room's participants: Jam's Sender menu lists each, with no messages too. */
  participants: readonly ChatSender[]
  filter: ChatFilter
  onChange(filter: ChatFilter): void
}) {
  const typeCounts = useMemo(() => {
    const counts = new Map<EventType, number>()
    for (const message of messages) counts.set(eventTypeOf(message), (counts.get(eventTypeOf(message)) ?? 0) + 1)
    return counts
  }, [messages])
  // Every participant, then anyone else who wrote here before (someone who has left), each with a count.
  const senders = useMemo(() => {
    const byId = new Map<string, { name: string; count: number }>()
    for (const participant of participants) byId.set(participant.id, { name: participant.name, count: 0 })
    for (const message of messages) {
      const id = message.sender_id ?? ''
      const current = byId.get(id)
      byId.set(id, { name: current?.name || message.sender_name || 'Unknown', count: (current?.count ?? 0) + 1 })
    }
    return [...byId].map(([id, sender]) => ({ id, ...sender }))
  }, [messages, participants])
  const allTypes = EVENT_TYPES.every(([type]) => filter.types.has(type))
  const allSenders = senders.every((sender) => !filter.hiddenSenders.has(sender.id))

  const setType = (type: EventType, on: boolean) => {
    const next = new Set(filter.types)
    if (on) next.add(type)
    else next.delete(type)
    onChange({ ...filter, types: next })
  }
  const setSender = (id: string, on: boolean) => {
    const next = new Set(filter.hiddenSenders)
    if (on) next.delete(id)
    else next.add(id)
    onChange({ ...filter, hiddenSenders: next })
  }

  return (
    <div className="flex items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
          Event type
          <ChevronDown className="text-foreground-subtle" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuCheckboxItem
            checked={allTypes}
            closeOnClick={false}
            onCheckedChange={(on) =>
              onChange({ ...filter, types: new Set(on ? EVENT_TYPES.map(([type]) => type) : []) })
            }
          >
            Select all
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {EVENT_TYPES.map(([type, label]) => (
            <DropdownMenuCheckboxItem
              key={type}
              checked={filter.types.has(type)}
              closeOnClick={false}
              onCheckedChange={(on) => setType(type, on)}
            >
              <span className="flex-1">{label}</span>
              <span className="text-foreground-subtlest tabular-nums">{typeCounts.get(type) ?? 0}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
          Sender
          <ChevronDown className="text-foreground-subtle" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuCheckboxItem
            checked={allSenders}
            closeOnClick={false}
            onCheckedChange={(on) =>
              onChange({ ...filter, hiddenSenders: new Set(on ? [] : senders.map((sender) => sender.id)) })
            }
          >
            Select all
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {senders.map((sender) => (
            <DropdownMenuCheckboxItem
              key={sender.id}
              checked={!filter.hiddenSenders.has(sender.id)}
              closeOnClick={false}
              onCheckedChange={(on) => setSender(sender.id, on)}
            >
              <span className="flex-1 truncate">{sender.name}</span>
              <span className="text-foreground-subtlest tabular-nums">{sender.count}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * The strip Jam Desktop shows above the composer while agents work: what they are doing ("Reasoning", or "Waiting for
 * permission" while one waits on a permission request) and how many.
 */
export function WorkingStrip({ agents, profile }: { agents: readonly RoomAgent[]; profile: string }) {
  const [open, setOpen] = useState(false)
  const [stopping, setStopping] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const working = agents.filter((agent) => agent.working)
  if (working.length === 0) return null
  const waiting = working.some((agent) => agent.attention > 0 && agent.tool !== 'AskUserQuestion')
  const label = waiting ? 'Waiting for permission' : 'Reasoning'
  const count = working.length === 1 ? '1 agent' : `${working.length} agents`

  // Jam's Stop interrupts the turn this agent is working on in THIS room. Its runtime keeps running, and a turn that
  // does not stop can be stopped again, which is what Jam's own error says to do (user guide, "Interrupt a turn").
  const stop = (agent: RoomAgent) => {
    const api = jam()
    if (!api || !agent.handle || !agent.peerKey || !agent.hostSession) return
    const scope = agent.peerKey.split('/')[1]
    if (!scope) return
    setStopping(agent.id)
    setProblem(null)
    api.daemon
      .interruptTurn({ profile, scope, handle: agent.handle, hostSession: agent.hostSession })
      .catch(() => setProblem('Band could not send that. The turn may still be running; try Stop again.'))
      .finally(() => setStopping(null))
  }

  return (
    <div className="mx-auto mb-2 w-full max-w-[848px] rounded-xl border border-line bg-card">
      <div role="status" aria-label={`${label}, ${count}`} className="flex items-center gap-2.5 px-3 py-2">
        <span aria-hidden="true" className="flex gap-0.5">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="size-1 animate-pulse rounded-full bg-foreground-subtle motion-reduce:animate-none"
              style={{ animationDelay: `${dot * 200}ms` }}
            />
          ))}
        </span>
        <span className="flex -space-x-1.5">
          {working.slice(0, 3).map((agent) => (
            <Initials key={agent.id} name={agent.name} className="size-6 ring-2 ring-card" />
          ))}
        </span>
        <span className="flex-1 text-ui-base text-foreground-subtle">{label}</span>
        <span className="text-ui-sm text-foreground-subtlest">{count}</span>
        {/* Jam's chevron on the strip: it opens the list of the agents working, where each one can be stopped. */}
        <button
          type="button"
          aria-label={open ? 'Hide the working agents' : 'Show the working agents'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-subtle transition-colors outline-none hover:bg-hover hover:text-foreground [&_svg]:size-4"
        >
          <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      {open ? (
        <ul aria-label="Working agents" className="flex flex-col border-t border-line px-1.5 py-1.5">
          {working.map((agent) => (
            <li key={agent.id} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
              <Initials name={agent.name} className="size-6" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui-base text-foreground">{agent.name}</span>
                {agent.tool ? (
                  <span className="block truncate text-ui-sm text-foreground-subtle">{agent.tool}</span>
                ) : null}
              </span>
              {agent.hostSession && agent.handle && agent.peerKey ? (
                <Button size="sm" variant="ghost" disabled={stopping === agent.id} onClick={() => stop(agent)}>
                  Stop
                </Button>
              ) : (
                // Without a session of its own here, or without the handle the daemon needs to name it, there is
                // nothing this app could interrupt, so no button is offered that would do nothing.
                <span className="px-2 text-ui-sm text-foreground-subtlest">Runs elsewhere</span>
              )}
            </li>
          ))}
          {problem ? (
            <li role="status" className="px-1.5 py-1 text-ui-sm text-foreground-subtle">
              {problem}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
