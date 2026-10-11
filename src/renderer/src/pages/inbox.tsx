import { useNavigate } from '@tanstack/react-router'
import { MessageSquare, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { Room } from '@shared/daemon'
import { EmptyCard, Page } from '@/components/page'
import { AnswerDialog, type QuestionToAnswer } from '@/components/room/answer-dialog'
import { Conversation, Initials, type ChatFilter } from '@/components/room/chat'
import { Composer, mentionablesOf } from '@/components/room/composer'
import { PermissionReview, type PendingPermission, type PermissionDecision } from '@/components/room/permissions'
import { unavailableText } from '@/components/room/unavailable'
import { SafeMarkdown } from '@/components/markdown'
import { IconButton } from '@/components/shell/icon-button'
import { Button } from '@/components/ui/button'
import { inboxScope } from '@/lib/attachments'
import { withEarlier } from '@/lib/history'
import { dismissibleEntry, inboxCount, inboxEntries, inboxTime, type InboxEntry } from '@/lib/inbox'
import { EVENT_TYPES } from '@/lib/messages'
import { openQuestionsOf, roomQuestions } from '@/lib/room-agents'
import { sendToRoom } from '@/lib/room-send'
import { useNow } from '@/lib/use-now'
import { useRoomAgents } from '@/lib/use-room-agents'
import { jam } from '@/lib/platform'
import { sectionById } from '@/lib/sections'
import { cn } from '@/lib/utils'
import { useAccount, useDaemon, useShellPart } from '@/stores/daemon'
import { EarlierMessages, RoomComposer } from '@/pages/room'
import { agentTargetOf, useRoomData, useRoomReads, useRoomStore } from '@/stores/room'
import { useSettings } from '@/stores/settings'

/**
 * Inbox (user guide, "Inbox"; Jam Desktop 0.4.10 with the experiment on): the mentions and human requests of every
 * room in one place, so the person can work through them without opening each room. Jam's own two columns - the list
 * on the left, the chosen item's room context on the right - in ZCode's ink, and Jam's words throughout.
 */
export function InboxPage() {
  const section = sectionById('inbox')
  const inbox = useDaemon((state) => state.inbox)
  const changed = useDaemon((state) => state.inboxChanged)
  const away = useDaemon((state) => state.status.state === 'offline')
  const rooms = useShellPart('rooms')
  const agents = useShellPart('agents')
  const profile = useSettings((state) => state.settings.profile)
  const selfId = useAccount(profile)?.identity?.user_id ?? null
  const navigate = useNavigate()
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [answering, setAnswering] = useState<QuestionToAnswer | null>(null)
  const [dismissProblem, setDismissProblem] = useState<string | null>(null)
  const [dismissing, setDismissing] = useState(false)
  const [reviewing, setReviewing] = useState<PendingPermission | null>(null)
  // The rows' times tick here, so nothing else on the page renders again with them.
  const now = useNow(30_000)

  const entries = useMemo(() => inboxEntries(inbox), [inbox])
  const waiting = useMemo(() => inboxCount(inbox), [inbox])
  const roomOf = (roomId: string): Room | null =>
    (rooms.state === 'ready' ? rooms.data.find((room) => room.id === roomId) : undefined) ?? null
  const roomTitle = (roomId: string) => roomOf(roomId)?.title ?? 'A room'
  // Until the person chooses a row, the first is open, as Jam Desktop opens its first. Once they choose, that item
  // stays open while the daemon sends new inboxes under it, until it leaves the list.
  const chosen = entries.find((entry) => entry.id === chosenId) ?? entries[0] ?? null

  const agentRows = agents.state === 'ready' ? agents.data.rows : []
  /** The account's own row for the agent a item came from, when that agent runs on this computer. */
  const agentOf = (entry: InboxEntry) =>
    entry.peerKey ? agentRows.find((row) => row.local?.peer_key === entry.peerKey) : undefined
  /** An agent's own name, so a question's row and a mention's name it the same way. */
  const nameOf = (entry: InboxEntry) => agentOf(entry)?.name || entry.from
  const decide = async (request: PendingPermission, outcome: PermissionDecision) => {
    const row = agentRows.find((item) => item.local?.peer_key === request.peerKey)
    const target = row ? agentTargetOf(row) : null
    const api = jam()
    if (!api || !target) throw new Error('This agent does not run on this computer')
    await api.daemon.decidePermission({ ...target, requestId: request.record.request.id, outcome })
    void useDaemon.getState().refresh(profile)
  }
  // An answer is the message the agent asked for, sent to the room the question came from, in the form the room's own
  // answer takes: the agent's handle, then Jam's "Answer <code>: <answer>", addressed to the agent by its id.
  // Jam's quiet dismiss: it marks that one mention read and done, and the stream then sends the inbox without it.
  // What it takes is `dismissibleEntry` - a question already answered is a mention to clear, and Jam's own capture
  // shows its X on that row too; one still waiting is answered, and a request is decided. A dismiss that does not
  // go through says so rather than leaving the row sitting there with no word.
  const dismiss = (entry: InboxEntry) => {
    const api = jam()
    if (!api || !dismissibleEntry(entry) || dismissing) return
    setDismissing(true)
    api.daemon
      .dismissMention({ profile, itemId: entry.id })
      .then(() => {
        setDismissProblem(null)
        void useDaemon.getState().refresh(profile)
      })
      .catch(() => setDismissProblem('Band did not take that. The mention is still here; try Dismiss again.'))
      .finally(() => setDismissing(false))
  }

  const sendAnswer = async (target: QuestionToAnswer, text: string) => {
    if (!target.agentId) throw new Error('The agent that asked is not in this room')
    const handle = agentRows.find((row) => row.id === target.agentId)?.handle
    const message = {
      content: `${handle ? `@${handle} ` : ''}Answer ${target.question.answer_code}: ${text}`,
      mentions: [target.agentId],
    }
    await sendToRoom(profile, target.roomId, inboxScope(profile, target.roomId), message, false)
  }

  // The inbox is known only while the daemon is there: away from it, or before its first snapshot, nothing about what
  // waits is known, and saying the person is caught up would be a claim this app cannot make.
  if (changed || away) {
    return (
      <Page title={section.label}>
        <EmptyCard
          title="What waits on you cannot be shown."
          description={unavailableText('Inbox', changed ? 'changed' : 'offline')}
        />
      </Page>
    )
  }
  // The daemon sends the inbox when the stream opens; until it has, nothing about what waits is known yet.
  if (inbox === null) {
    return (
      <Page title={section.label}>
        <EmptyCard title="Loading…" />
      </Page>
    )
  }

  return (
    // With items, the page fills the window, as Jam's two columns do: the list and the room's history each scroll on
    // their own, and the reply stays docked at the foot of the detail.
    <Page
      wide
      fill={entries.length > 0}
      title={section.label}
      actions={waiting > 0 ? <span className="text-ui-lg text-foreground-subtle">{waiting}</span> : null}
    >
      {entries.length === 0 && (inbox?.overflow ?? 0) === 0 ? (
        <EmptyCard title="You're caught up" />
      ) : entries.length === 0 ? null : (
        <div className="flex min-h-0 flex-1 gap-4">
          <ul aria-label="Inbox" className="flex w-84 shrink-0 flex-col gap-0.5 overflow-y-auto">
            {entries.map((entry) => (
              <li key={entry.id}>
                <EntryRow
                  entry={entry}
                  from={nameOf(entry)}
                  room={roomTitle(entry.roomId)}
                  now={now}
                  chosen={entry.id === chosen?.id}
                  dismissing={dismissing}
                  onChoose={() => setChosenId(entry.id)}
                  onDismiss={() => dismiss(entry)}
                />
              </li>
            ))}
          </ul>
          {chosen ? (
            <Detail
              entry={chosen}
              from={nameOf(chosen)}
              answerable={Boolean(chosen.question && (chosen.message?.sender_id || agentOf(chosen)?.id))}
              room={roomTitle(chosen.roomId)}
              selfId={selfId}
              onOpenRoom={() => void navigate({ to: '/rooms/$roomId', params: { roomId: chosen.roomId } })}
              onAnswer={() =>
                chosen.question &&
                setAnswering({
                  question: chosen.question,
                  roomId: chosen.roomId,
                  // A question that did not arrive as a message is still addressed to the agent that asked it.
                  agentId: chosen.message?.sender_id ?? agentOf(chosen)?.id ?? null,
                  agentName: nameOf(chosen),
                })
              }
              onReview={() =>
                chosen.record &&
                chosen.peerKey &&
                setReviewing({ peerKey: chosen.peerKey, record: chosen.record, agentHandle: nameOf(chosen) })
              }
              onDismiss={() => dismiss(chosen)}
              dismissing={dismissing}
              problem={dismissProblem}
            >
              {(() => {
                const room = roomOf(chosen.roomId)
                return room ? <RoomContext key={room.id} room={room} onAnswer={setAnswering} /> : null
              })()}
            </Detail>
          ) : null}
        </div>
      )}
      <Limits overflow={inbox?.overflow ?? 0} truncated={inbox?.truncated ?? 0} unreadable={inbox?.unreadable ?? 0} />
      <AnswerDialog target={answering} onSend={sendAnswer} onClose={() => setAnswering(null)} />
      <PermissionReview request={reviewing} onDecide={decide} onClose={() => setReviewing(null)} />
    </Page>
  )
}

/** A row of the list: who it is from and the room it is in, the item itself, then when it arrived. */
function EntryRow({
  entry,
  from,
  room,
  now,
  chosen,
  dismissing,
  onChoose,
  onDismiss,
}: {
  entry: InboxEntry
  from: string
  room: string
  now: number
  chosen: boolean
  /** The one dismiss in flight, shared with the detail so both say the same thing about it. */
  dismissing: boolean
  onChoose(): void
  onDismiss(): void
}) {
  return (
    <div className="group/row relative">
      <button
        type="button"
        onClick={onChoose}
        aria-current={chosen ? 'true' : undefined}
        className={cn(
          'flex w-full gap-3 rounded-xl px-3 py-2.5 text-left transition-colors outline-none',
          chosen ? 'bg-selected' : 'hover:bg-surface-hover',
        )}
      >
        <Initials name={from} className="mt-0.5 size-8 rounded-lg text-ui-sm" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-ui-base font-semibold text-foreground">{from}</span>
            <span className="truncate text-ui-sm text-foreground-subtle">{room}</span>
          </span>
          <span className="line-clamp-2 text-ui-base text-foreground-subtle">{entry.excerpt}</span>
          <span className="text-ui-sm text-foreground-subtlest">{inboxTime(entry.at, now)}</span>
        </span>
      </button>
      {/* Jam's own X on a row its quiet dismiss takes, its control tree's name for it, on hover as its guide says;
          it is a sibling of the row, not inside it, and takes the same write and in-flight flag as the detail. */}
      {dismissibleEntry(entry) ? (
        <IconButton
          label={`Dismiss mention from ${from}`}
          disabled={dismissing}
          onClick={onDismiss}
          className="absolute top-1 right-1 text-foreground-subtle opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 focus-visible:opacity-100"
        >
          <X />
        </IconButton>
      ) : null}
    </div>
  )
}

/** The chosen item, as Jam shows it: the room it is in, who it came from, what to do with it, and its text. */
function Detail({
  entry,
  from,
  room,
  answerable,
  selfId,
  onOpenRoom,
  onAnswer,
  onReview,
  onDismiss,
  dismissing,
  problem,
  children,
}: {
  entry: InboxEntry
  from: string
  room: string
  /** The agent that asked can be addressed from here; without it the question is answered in its room. */
  answerable: boolean
  selfId: string | null
  onOpenRoom(): void
  onAnswer(): void
  onReview(): void
  onDismiss(): void
  dismissing: boolean
  /** What went wrong with the last action taken from here, if anything. */
  problem: string | null
  /** The item's room context, when its room is one of the rooms the daemon listed. */
  children: ReactNode
}) {
  return (
    <article
      aria-label="Inbox item"
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 rounded-xl border border-line p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-ui-lg font-semibold text-pretty text-foreground">{room}</h2>
          <p className="text-ui-base text-foreground-subtle">
            {fromLabel(entry)}
            {from}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {entry.question && answerable ? (
            <Button size="sm" onClick={onAnswer}>
              Answer…
            </Button>
          ) : null}
          {entry.record ? (
            <Button size="sm" onClick={onReview}>
              Review
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={onOpenRoom} disabled={!entry.roomId}>
            <MessageSquare />
            View in room
          </Button>
          {/* Jam dismisses from here what its X takes from a row (`dismissibleEntry`): a routine mention, and a
              question already answered - its own capture shows the X on that row too - while a question still waiting
              is answered and a request is decided (user guide, "Dismiss a routine mention"). */}
          {dismissibleEntry(entry) ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Dismiss mention from ${from}`}
              disabled={dismissing}
              onClick={onDismiss}
            >
              <X />
              Dismiss
            </Button>
          ) : null}
        </div>
      </header>
      {problem ? (
        <p role="status" className="text-ui-sm text-foreground-subtle">
          {problem}
        </p>
      ) : null}
      <div className="max-h-40 min-w-0 shrink-0 overflow-y-auto text-ui-base text-foreground">
        {entry.record ? (
          // The operation whole is in the review dialog, as Jam's guide asks before deciding; here it is its first line.
          <p className="line-clamp-3 font-mono text-ui-sm text-foreground-subtle">{entry.record.request.description}</p>
        ) : entry.message ? (
          <SafeMarkdown text={entry.body} mentions={{ names: entry.message.mention_names, selfId }} breaks />
        ) : (
          <p className="text-foreground-subtle">{entry.body}</p>
        )}
      </div>
      {children ?? (
        <p className="text-ui-sm text-foreground-subtlest">
          The room&apos;s own history around this message is in the room. Open it with View in room.
        </p>
      )}
    </article>
  )
}

/** Every event type the conversation knows, for the history Inbox shows. */
const ALL_EVENTS: ChatFilter = { types: new Set(EVENT_TYPES.map(([type]) => type)), hiddenSenders: new Set() }

/**
 * Jam's room context under the item (the guide's "Read its room context in the detail pane"; Jam Desktop 0.4.10 with
 * the Inbox experiment on): its "Conversation history", the room's conversation as the room's own page shows it,
 * opening at the newest message and filling the detail, and docked under it the reply, "Reply...", with Mention and
 * Attach files, which sends to that room. The room is read as its page reads it, when it is shown and then with the
 * shell: going to another item of the same room reads nothing new, and coming back to a room shown before reads it
 * again, as opening its page would. A question's Answer… in the history opens the page's own answer dialog.
 */
function RoomContext({ room, onAnswer }: { room: Room; onAnswer(target: QuestionToAnswer): void }) {
  useRoomReads(room)
  const data = useRoomData(room)
  const profile = useSettings((state) => state.settings.profile)
  const selfId = useAccount(profile)?.identity?.user_id ?? null
  const inbox = useDaemon((state) => state.inbox)
  const inboxChanged = useDaemon((state) => state.inboxChanged)
  const agentList = useShellPart('agents')
  const agents = useRoomAgents(room)
  // No filters are offered here, and every event shows, as Jam's own history shows the room's tool calls, their
  // results and a turn's tasks among its messages (the room's page opens on fewer, behind its Event type filter).
  const [filter, setFilter] = useState<ChatFilter>(ALL_EVENTS)
  const messages = useMemo(
    () => (data.messages.state === 'ready' ? withEarlier(data.earlier, data.messages.data.messages) : []),
    [data.messages, data.earlier],
  )
  const participants = data.participants.state === 'ready' ? data.participants.data : []
  const agentRows = agentList.state === 'ready' ? agentList.data.rows : []
  const handleOf = (peerKey: string) =>
    agentRows.find((row) => row.local?.peer_key === peerKey)?.handle ?? peerKey.split('/').pop() ?? 'An agent'
  const openQuestions = openQuestionsOf(roomQuestions(inbox, room.id), room.id, agents, handleOf)
  const names = Object.fromEntries(
    participants.flatMap((participant) => (participant.name ? [[participant.id, participant.name]] : [])),
  )
  const mentionables = mentionablesOf(participants, selfId)
  const scope = inboxScope(profile, room.id)

  const read = data.messages
  return (
    <section aria-label="Conversation history" className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        data-slot="room-scroll"
        className="flex min-h-24 flex-1 flex-col gap-5 overflow-y-auto rounded-lg border border-line px-4 py-3"
      >
        {/* The room page's own states for its conversation, but for the plan and the participants it offers there. */}
        {read.state === 'unavailable' ? (
          <p className="text-ui-base text-foreground-subtle">{unavailableText('The conversation', read.reason)}</p>
        ) : read.state === 'idle' || (messages.length === 0 && read.data.loading) ? (
          <p className="text-ui-base text-foreground-subtle">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-ui-base text-foreground-subtle">No messages yet</p>
        ) : (
          <>
            <EarlierMessages
              hasMore={read.data.hasMore}
              history={data.history}
              problem={data.historyProblem}
              onRead={() => void useRoomStore.getState().readEarlier(profile, room.id)}
            />
            <Conversation
              messages={messages}
              filter={filter}
              names={names}
              selfId={selfId}
              openQuestions={openQuestions}
              waitingUnknown={inboxChanged}
              onAnswer={(code) => {
                const open = openQuestions.get(code.toUpperCase())
                if (open) onAnswer(open)
              }}
              onShowAll={() => setFilter(ALL_EVENTS)}
              busy={data.history === 'reading'}
            />
            {read.data.unreadable > 0 ? (
              <p className="text-center text-ui-sm text-foreground-subtle">
                {read.data.unreadable === 1
                  ? '1 message could not be shown: its format is newer than this app.'
                  : `${read.data.unreadable} messages could not be shown: their format is newer than this app.`}
              </p>
            ) : null}
          </>
        )}
      </div>
      {mentionables.length > 0 ? (
        <Composer
          mentionables={mentionables}
          scope={scope}
          placeholder="Reply..."
          onSend={(message) => sendToRoom(profile, room.id, scope, message, true)}
        />
      ) : (
        // With no one to address yet, the room's own composer shown turned off, saying why.
        <RoomComposer data={data} />
      )}
    </section>
  )
}

/**
 * What the detail says above the sender. Jam Desktop's own words for a mention are "Mentioned by"; a question that did
 * not arrive as one, and a permission request, were not seen there, so those two lines are this app's
 * (docs/jam/differences.md).
 */
function fromLabel(entry: InboxEntry): string {
  if (entry.kind === 'permission') return 'Permission requested by '
  return entry.message ? 'Mentioned by ' : 'Asked by '
}

/** Jam's two limits, in its own words, when the daemon could not keep every mention. */
function Limits({ overflow, truncated, unreadable }: { overflow: number; truncated: number; unreadable: number }) {
  if (!overflow && !truncated && !unreadable) return null
  return (
    <div className="flex flex-col gap-1 text-ui-sm text-foreground-subtle">
      {overflow > 0 ? <p>Additional mentions are queued. Handle earlier items to reveal them.</p> : null}
      {truncated > 0 ? (
        <p>Some older mentions were not retained. Open the affected rooms when you need to inspect earlier history.</p>
      ) : null}
      {unreadable > 0 ? (
        <p>
          {unreadable === 1
            ? '1 mention could not be shown: its format is newer than this app.'
            : `${unreadable} mentions could not be shown: their format is newer than this app.`}
        </p>
      ) : null}
    </div>
  )
}
