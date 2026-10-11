import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import {
  ArrowUp,
  AtSign,
  Copy,
  EllipsisVertical,
  ExternalLink,
  FileText,
  Paperclip,
  UserPlus,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Room, RoomMessage } from '@shared/daemon'
import { EmptyCard } from '@/components/page'
import { AnswerDialog, type QuestionToAnswer } from '@/components/room/answer-dialog'
import {
  ChatFilters,
  Conversation,
  DEFAULT_CHAT_FILTER,
  WorkingStrip,
  type ChatFilter,
  shownMessages,
} from '@/components/room/chat'
import { Composer, mentionablesOf } from '@/components/room/composer'
import {
  PermissionBanner,
  PermissionReview,
  type PendingPermission,
  type PermissionDecision,
} from '@/components/room/permissions'
import { PlanCard } from '@/components/room/plan-card'
import { showRoomPanel, toggleRoomPanel } from '@/components/room/show-panel'
import { unavailableText } from '@/components/room/unavailable'
import { WorkBoard, WorkViewTabs, type WorkViewId } from '@/components/room/work'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { FindInConversation } from '@/components/room/find'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCommands } from '@/commands/use-commands'
import { roomScope } from '@/lib/attachments'
import { FIND_MIN, findResults, matchCount, stepMatch } from '@/lib/find'
import { withEarlier } from '@/lib/history'
import { openQuestionsOf, roomPermissions, roomQuestions, type OpenQuestion, type RoomAgent } from '@/lib/room-agents'
import { sendToRoom } from '@/lib/room-send'
import { jam } from '@/lib/platform'
import { useNow } from '@/lib/use-now'
import { useRoomAgents } from '@/lib/use-room-agents'
import { cn } from '@/lib/utils'
import { useAccount, useDaemon, useShellPart } from '@/stores/daemon'
import type { Unavailable } from '@/stores/daemon'
import {
  agentTargetOf,
  useRoom,
  useRoomData,
  useRoomReads,
  useRoomStore,
  type HistoryState,
  type RoomData,
} from '@/stores/room'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { useTitleBar } from '@/stores/title'

/**
 * One room, as ZCode shows one task (docs/DESIGN.md, "Room"): its title at weight 600 in the title bar with Jam's own
 * header controls, Chat and Work as pills over a centred column, the plan card at the top of Chat, the composer below,
 * and the room's right panel in the side pane. The room opens at once while its parts load (user guide, "Use Chat").
 */
export function RoomPage() {
  const { roomId } = useParams({ from: '/rooms/$roomId' })
  const { view } = useSearch({ from: '/rooms/$roomId' })
  const navigate = useNavigate({ from: '/rooms/$roomId' })
  const rooms = useShellPart('rooms')
  const room = useRoom(roomId)
  useRoomReads(room)

  useTitleBar(room ? <RoomTitle room={room} /> : null, [room?.id, room?.title])

  if (!room) {
    return (
      <div className="mx-auto w-full max-w-[880px] px-4 pt-6">
        {rooms.state === 'ready' ? (
          <EmptyCard
            title="This room is not in your list."
            description="It may have been archived, or it belongs to another account."
          />
        ) : rooms.state === 'unavailable' ? (
          <EmptyCard title="Rooms are unavailable right now." description={unavailableText('Rooms', rooms.reason)} />
        ) : (
          <Loading />
        )}
      </div>
    )
  }

  return (
    <RoomBody
      key={room.id}
      room={room}
      view={view ?? 'chat'}
      onView={(next) => void navigate({ search: next === 'work' ? { view: 'work' } : {}, replace: true })}
    />
  )
}

/**
 * The scrollbar's room kept on both edges of the header, the conversation and the composer alike, so their columns line
 * up whether the conversation shows a scrollbar or not, and at any width.
 */
const GUTTERS = '[scrollbar-gutter:stable_both-edges]'

/** A room's page for one room: its filters, dialogs and views start afresh in each room (keyed by the room). */
function RoomBody({ room, view, onView }: { room: Room; view: 'chat' | 'work'; onView(view: 'chat' | 'work'): void }) {
  const data = useRoomData(room)
  const profile = useSettings((state) => state.settings.profile)
  const selfId = useAccount(profile)?.identity?.user_id ?? null
  const inbox = useDaemon((state) => state.inbox)
  const inboxChanged = useDaemon((state) => state.inboxChanged)
  const agentList = useShellPart('agents')
  const [filter, setFilter] = useState<ChatFilter>(DEFAULT_CHAT_FILTER)
  const [finding, setFinding] = useState<{ query: string; id: string | null; landed: string | null; went: number }>({
    query: '',
    id: null,
    landed: null,
    went: 0,
  })
  const [workView, setWorkView] = useState<WorkViewId>('status')
  const [reviewing, setReviewing] = useState<PendingPermission | null>(null)
  const [answering, setAnswering] = useState<QuestionToAnswer | null>(null)

  const agentRows = useMemo(() => (agentList.state === 'ready' ? agentList.data.rows : []), [agentList])
  const findOpen = useUi((state) => state.findOpen)
  const findAsked = useUi((state) => state.findAsked)
  const setFindOpen = useUi((state) => state.setFindOpen)
  const askFind = useUi((state) => state.askFind)
  const messages = useMemo(
    () => (data.messages.state === 'ready' ? withEarlier(data.earlier, data.messages.data.messages) : []),
    [data.messages, data.earlier],
  )
  const commands = useCommands()
  // What Find looks through is exactly what is on screen: the conversation the filters left.
  const results = useMemo(
    () => (findOpen ? findResults(shownMessages(messages, filter), finding.query) : []),
    [findOpen, messages, filter, finding.query],
  )
  const matches = useMemo(() => results.map((hit) => hit.id), [results])
  /**
   * Which match is being looked at, worked out from the message itself: the matches are newest first, so a message
   * arriving or a filter changing moves every one of them, and an index kept from before would point at another
   * message or at none. A match that has gone leaves the newest.
   */
  const at = matches.length === 0 ? -1 : Math.max(0, matches.indexOf(finding.id ?? ''))
  // Leaving the room closes it, as every room opens on its conversation rather than on a search.
  useEffect(() => {
    return () => setFindOpen(false)
  }, [setFindOpen])

  // Jam loads the complete conversation before it lists what matches (user guide, "Use Chat"), so a search that has
  // something to look for reads what came before the snapshot, once, without being asked again.
  const searching = findOpen && finding.query.trim().length >= FIND_MIN
  const unread = data.history === 'idle' && data.messages.state === 'ready' && data.messages.data.hasMore
  useEffect(() => {
    if (searching && unread) void useRoomStore.getState().readEarlier(profile, room.id)
  }, [searching, unread, profile, room.id])
  const participants = useMemo(
    () => (data.participants.state === 'ready' ? data.participants.data : []),
    [data.participants],
  )
  const agents = useRoomAgents(room)
  const handleOf = (peerKey: string) =>
    agentRows.find((row) => row.local?.peer_key === peerKey)?.handle ?? peerKey.split('/').pop() ?? 'An agent'
  const permissions: PendingPermission[] = roomPermissions(inbox, room.id).map((item) => ({
    ...item,
    agentHandle: handleOf(item.peerKey),
  }))
  const questions = roomQuestions(inbox, room.id)
  const openQuestions = openQuestionsOf(questions, room.id, agents, handleOf)
  const names = Object.fromEntries(
    participants.flatMap((participant) => (participant.name ? [[participant.id, participant.name]] : [])),
  )
  const senders = participants.map((participant) => ({
    id: participant.id,
    name: participant.name || participant.handle || 'Participant',
  }))
  const answer = (code: string) => {
    const open = openQuestions.get(code.toUpperCase())
    if (open) setAnswering(open)
  }
  const mentionables = mentionablesOf(participants, selfId)

  /** After a write, read the room and the shell at once; the daemon's events follow with the rest. */
  const readAgain = () => {
    void useRoomStore.getState().load(profile, room.id)
    void useDaemon.getState().refresh(profile)
  }
  const api = jam()
  const scope = roomScope(profile, room.id)
  /** Sends a message; with `withFiles`, the files staged in this room's composer go with it (`@/lib/room-send`). */
  const send = (message: { content: string; mentions: string[] }, withFiles = false) =>
    sendToRoom(profile, room.id, scope, message, withFiles)
  // An answer is a message in the form the agent asked for ("Answer <code>: <answer>"), addressed to the agent.
  const sendAnswer = async (target: QuestionToAnswer, text: string) => {
    if (!target.agentId) throw new Error('The agent that asked is not in this room')
    const handle = participants.find((participant) => participant.id === target.agentId)?.handle
    await send({
      content: `${handle ? `@${handle} ` : ''}Answer ${target.question.answer_code}: ${text}`,
      mentions: [target.agentId],
    })
  }
  const decide = async (request: PendingPermission, outcome: PermissionDecision) => {
    const row = agentRows.find((item) => item.local?.peer_key === request.peerKey)
    const target = row ? agentTargetOf(row) : null
    if (!api || !target) throw new Error('This agent does not run on this computer')
    await api.daemon.decidePermission({ ...target, requestId: request.record.request.id, outcome })
    readAgain()
  }

  // As in Jam Desktop, the banner, the views and the filters stay in place above the conversation, and the composer
  // below it: only the conversation (or the work) scrolls, so Review and the views are always in reach, and nothing
  // covers an element that takes focus inside it.
  return (
    <div data-scroll="own" className="flex h-full flex-col">
      <div className={cn(GUTTERS, 'shrink-0 overflow-y-hidden px-4 pt-4 pb-3')}>
        <div className="mx-auto flex w-full max-w-[848px] flex-col gap-3">
          <PermissionBanner pending={permissions} onReview={setReviewing} />
          {inboxChanged ? (
            <p className="text-ui-sm text-foreground-subtle">
              {unavailableText('Permission requests and questions', 'changed')}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            {/* Jam's order: Work, then Chat (a room still opens on Chat). */}
            <Tabs value={view} onValueChange={(value) => onView(value === 'work' ? 'work' : 'chat')}>
              <TabsList aria-label="Room views">
                <TabsTrigger value="work">Work</TabsTrigger>
                <TabsTrigger value="chat">Chat</TabsTrigger>
              </TabsList>
            </Tabs>
            <span className="flex-1" />
            {view === 'chat' ? (
              <>
                <FindInConversation
                  open={findOpen}
                  asked={findAsked}
                  query={finding.query}
                  count={matchCount({ ids: matches, at }, finding.query)}
                  results={results}
                  at={at}
                  commands={commands}
                  onOpen={askFind}
                  onQuery={(query) => setFinding((was) => ({ ...was, query, id: null, landed: null }))}
                  onStep={(by) =>
                    setFinding((was) => ({ ...was, id: matches[stepMatch({ ids: matches, at }, by).at] ?? null }))
                  }
                  onGo={(id) => setFinding((was) => ({ ...was, id, landed: id, went: was.went + 1 }))}
                  onClose={() => {
                    setFindOpen(false)
                    setFinding((was) => ({ ...was, query: '', id: null, landed: null }))
                  }}
                />
                <ChatFilters messages={messages} participants={senders} filter={filter} onChange={setFilter} />
              </>
            ) : null}
          </div>
          {view === 'work' ? <WorkViewTabs view={workView} onChange={setWorkView} /> : null}
        </div>
      </div>
      <div data-slot="room-scroll" className={cn(GUTTERS, 'min-h-0 flex-1 overflow-y-auto')}>
        <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-4 pt-2 pb-6">
          {view === 'chat' ? (
            <ChatView
              onEarlier={() => void useRoomStore.getState().readEarlier(profile, room.id)}
              found={finding.landed}
              went={finding.went}
              words={finding.landed === null ? '' : finding.query.trim()}
              messages={messages}
              data={data}
              filter={filter}
              profile={profile}
              roomId={room.id}
              names={names}
              selfId={selfId}
              openQuestions={openQuestions}
              waitingUnknown={inboxChanged}
              onAnswer={answer}
              onShowAll={() => setFilter(DEFAULT_CHAT_FILTER)}
            />
          ) : (
            <WorkPane
              data={data}
              view={workView}
              agents={agents}
              agentRows={agentRows}
              permissions={permissions}
              questions={questions}
              onReview={setReviewing}
              onAnswer={answer}
            />
          )}
        </div>
      </div>
      {view === 'chat' ? (
        <div className={cn(GUTTERS, 'shrink-0 overflow-y-hidden px-4 pb-4')}>
          <WorkingStrip agents={agents} profile={profile} />
          {mentionables.length > 0 ? (
            <Composer mentionables={mentionables} scope={scope} onSend={(message) => send(message, true)} />
          ) : (
            <RoomComposer data={data} />
          )}
        </div>
      ) : null}
      <PermissionReview request={reviewing} onDecide={decide} onClose={() => setReviewing(null)} />
      <AnswerDialog target={answering} onSend={sendAnswer} onClose={() => setAnswering(null)} />
    </div>
  )
}

/**
 * The room's title in the title bar, where ZCode shows a task's, and after it Jam Desktop's own header controls: its
 * people with their count, its plan (marked when it changed since the person last had it open), and Room actions. Each
 * control comes after the title in the page's order and is `no-drag`: the window's drag regions follow document order
 * and ignore stacking, so a control the title bar overlaps takes a press only when it comes after the region it sits on.
 */
function RoomTitle({ room }: { room: Room }) {
  const data = useRoomData(room)
  const panel = useUi((state) => state.roomPanel)
  const paneOpen = useSettings((state) => state.settings.sidePaneOpen)
  const seen = useUi((state) => state.planSeen[room.id])
  const markPlanSeen = useUi((state) => state.markPlanSeen)
  const people = data.participants.state === 'ready' ? data.participants.data.length : null
  // The plan's own revision, which changes when its text does. `updated_at` is not that: in the one answer recorded it
  // is the moment the daemon last fetched the source, which moves for a watched file whose text has not changed.
  const planRev = data.plan.state === 'ready' ? (data.plan.data.doc_rev ?? data.plan.data.updated_at ?? 0) : null
  const showingParticipants = paneOpen && panel === 'participants'
  const showingPlan = paneOpen && panel === 'plan'
  const planChanged = planRev !== null && seen !== undefined && planRev > seen

  // The room's first read of its plan is what the person already has; after that, showing the plan takes its mark off.
  useEffect(() => {
    if (planRev === null) return
    if (seen === undefined || (showingPlan && planRev > seen)) markPlanSeen(room.id, planRev)
  }, [planRev, seen, showingPlan, markPlanSeen, room.id])

  return (
    <>
      <h1 className="max-w-100 truncate text-ui-base font-semibold text-foreground">{room.title}</h1>
      <Button
        variant={showingParticipants ? 'secondary' : 'ghost'}
        size="sm"
        aria-label={showingParticipants ? 'Hide participants' : 'Show participants'}
        className="no-drag"
        onClick={() => toggleRoomPanel('participants')}
      >
        <Users />
        {people !== null ? <span className="tabular-nums">{people}</span> : null}
      </Button>
      <Button
        variant={showingPlan ? 'secondary' : 'ghost'}
        size="icon-sm"
        aria-label={showingPlan ? 'Hide the plan & diagram' : 'Show the plan & diagram'}
        className="relative no-drag"
        onClick={() => toggleRoomPanel('plan')}
      >
        <FileText />
        {planChanged ? (
          <span
            role="img"
            aria-label="The plan changed"
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-info"
          />
        ) : null}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Room actions" className="no-drag">
              <EllipsisVertical />
            </Button>
          }
        />
        <DropdownMenuContent className="min-w-52">
          {/* Jam opens the room on Band's website; this app has no room link of Band's to open yet. */}
          <DropdownMenuItem disabled>
            <ExternalLink />
            Open in Band
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigator.clipboard?.writeText(room.id).catch(() => {})}>
            <Copy />
            Copy room id
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

/** Whether the room has an agent: a participant that is not a person. */
function agentPresence(data: RoomData): boolean | null {
  if (data.participants.state !== 'ready') return null
  return data.participants.data.some((participant) => participant.kind !== undefined && participant.kind !== 'User')
}

function ChatView({
  data,
  messages,
  found,
  went,
  words,
  filter,
  profile,
  roomId,
  names,
  selfId,
  openQuestions,
  waitingUnknown,
  onAnswer,
  onShowAll,
  onEarlier,
}: {
  data: RoomData
  filter: ChatFilter
  names: Record<string, string>
  selfId: string | null
  openQuestions: ReadonlyMap<string, OpenQuestion>
  waitingUnknown: boolean
  onAnswer(code: string): void
  onShowAll(): void
  onEarlier(): void
  /** The account and the room, for setting the room's plan from the plan card. */
  profile: string
  roomId: string
  /** The message Find in conversation was taken to (`@/lib/find`). */
  found: string | null
  /** How many times a match has been gone to: going to the same one again moves the conversation again. */
  went: number
  /** The words Find found, marked in the message it took the person to. */
  words: string
  /** The conversation the room shows: what was read from before the snapshot, then the snapshot's own. */
  messages: RoomMessage[]
}) {
  // The card stays for a room whose plan read answered with no plan, so one can be set from a file.
  const plan = data.plan.state === 'ready' ? data.plan.data : null
  const read = data.messages
  const shown = messages
  return (
    <div className="flex flex-1 flex-col gap-6">
      {plan ? <PlanCard plan={plan} profile={profile} roomId={roomId} onOpen={() => showRoomPanel('plan')} /> : null}
      {read.state === 'unavailable' ? (
        <Centred title="The conversation is unavailable." note={unavailableText('The conversation', read.reason)} />
      ) : read.state === 'idle' ? (
        <Loading />
      ) : shown.length === 0 && read.data.loading ? (
        <Centred title="Loading the conversation…" />
      ) : shown.length === 0 ? (
        <EmptyConversation data={data} />
      ) : (
        <>
          <EarlierMessages
            hasMore={read.data.hasMore}
            history={data.history}
            problem={data.historyProblem}
            onRead={onEarlier}
          />
          <Conversation
            messages={shown}
            filter={filter}
            names={names}
            selfId={selfId}
            openQuestions={openQuestions}
            waitingUnknown={waitingUnknown}
            onAnswer={onAnswer}
            onShowAll={onShowAll}
            busy={data.history === 'reading'}
            found={found}
            went={went}
            words={words}
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
  )
}

/**
 * The conversation before the snapshot the daemon keeps. The daemon says whether Band has older messages, and this
 * app reads them only when asked: a long conversation is many reads of the daemon, and of Band behind it. Jam's own
 * way of reaching them was never seen (`docs/jam/differences.md`), so the words here are this app's own.
 */
export function EarlierMessages({
  hasMore,
  history,
  problem,
  onRead,
}: {
  hasMore: boolean | null
  history: HistoryState
  problem: Unavailable['reason'] | null
  onRead(): void
}) {
  // Read to its beginning, or never offered: the daemon says there is nothing older and nothing has been asked for.
  if (history === 'read' || (history === 'idle' && !hasMore)) return null
  if (history === 'partial') {
    return (
      <p data-slot="earlier" className="text-center text-ui-sm text-foreground-subtle">
        The rest of this conversation was not read. Open the room in the official Band app to read further back.
      </p>
    )
  }
  // Only a daemon that was away is worth asking again; a route it does not have, or an answer this app cannot read,
  // would fail the same way every time (`@/components/room/unavailable`).
  const again = history !== 'failed' || problem === 'offline' || problem === 'failed'
  return (
    <div data-slot="earlier" className="flex flex-col items-center gap-1">
      {history === 'failed' ? (
        <p className="text-ui-sm text-foreground-subtle">
          {unavailableText('The earlier messages', problem ?? 'failed')}
        </p>
      ) : null}
      {again ? (
        <Button variant="ghost" size="sm" onClick={onRead} disabled={history === 'reading'}>
          {history === 'reading'
            ? 'Reading the earlier messages…'
            : history === 'failed'
              ? 'Try again'
              : 'Show earlier messages'}
        </Button>
      ) : null}
    </div>
  )
}

/** A conversation with no messages yet, in Jam's words when the room has no agent. */
function EmptyConversation({ data }: { data: RoomData }) {
  const agent = agentPresence(data)
  if (agent === false) {
    // Jam's words for a room without an agent; its link opens the participants, where Jam adds one.
    return (
      <Centred
        title="No agents in this chat"
        action={
          <Button variant="link" size="sm" onClick={() => showRoomPanel('participants')}>
            Add an agent to get started.
          </Button>
        }
      />
    )
  }
  return (
    <Centred
      title="No messages yet"
      note="Send the first message to start the conversation."
      action={
        <Button variant="outline" size="sm" onClick={() => showRoomPanel('participants')}>
          <Users />
          Participants
        </Button>
      }
    />
  )
}

/** A part of the room before its first read, as the side pane shows it. */
function Loading() {
  return <p className="py-16 text-center text-ui-base text-foreground-subtle">Loading…</p>
}

function Centred({ title, note, action }: { title: string; note?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex max-w-md flex-col gap-1.5">
        <p className="text-ui-lg font-semibold text-foreground">{title}</p>
        {note ? <p className="text-ui-base text-pretty text-foreground-subtle">{note}</p> : null}
      </div>
      {action}
    </div>
  )
}

/**
 * The composer with no one to address: while the room's participants load, or in a room with no one else in it, where
 * Jam's words say to add an agent. Band refuses a message that mentions no one, so it is shown turned off.
 */
export function RoomComposer({ data }: { data: RoomData }) {
  return (
    <div className="mx-auto flex w-full max-w-[848px] flex-col gap-3 rounded-2xl border border-line-strong bg-card p-3">
      <textarea
        aria-label="Message"
        disabled
        rows={2}
        placeholder={
          data.participants.state === 'unavailable'
            ? unavailableText('Participants', data.participants.reason)
            : agentPresence(data) === null
              ? 'Message'
              : 'Add an agent to get started'
        }
        className="max-h-40 min-h-10 w-full resize-none bg-transparent text-ui-base leading-5 text-foreground outline-none placeholder:text-foreground-subtlest disabled:cursor-default"
      />
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" disabled>
          <AtSign />
          Mention
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Attach files" disabled>
          <Paperclip />
        </Button>
        <span className="flex-1" />
        <Button size="icon-sm" aria-label="Send" disabled>
          <ArrowUp />
        </Button>
      </div>
    </div>
  )
}

/**
 * Jam's Work view: agents' private task lanes and the room's shared tasks, in four views. A room without an agent has
 * no work, in Jam's words.
 */
function WorkPane({
  data,
  view,
  agents,
  agentRows,
  permissions,
  questions,
  onReview,
  onAnswer,
}: {
  data: RoomData
  view: WorkViewId
  agents: RoomAgent[]
  agentRows: Parameters<typeof WorkBoard>[0]['inputs']['agentRows']
  permissions: PendingPermission[]
  questions: ReturnType<typeof roomQuestions>
  onReview(permission: PendingPermission): void
  onAnswer(code: string): void
}) {
  // The cards' ages tick here, so the rest of the room does not render again each time.
  const now = useNow(30_000)
  const agent = agentPresence(data)
  if (agent === false) {
    return (
      <EmptyCard
        title="No agent in this room yet."
        description="Add an agent to this room to start shared work."
        actions={
          <Button size="sm" onClick={() => showRoomPanel('participants')}>
            <UserPlus />
            Add an agent
          </Button>
        }
      />
    )
  }
  // Each view waits only for its own part: Shared for the room's board, the others for the agents' lanes.
  const part = view === 'shared' ? data.board : data.work
  if (part.state === 'unavailable') {
    return <EmptyCard title="Work is unavailable right now." description={unavailableText('Work', part.reason)} />
  }
  if (part.state !== 'ready') return <Loading />
  return (
    <WorkBoard
      view={view}
      inputs={{
        lanes: data.work.state === 'ready' ? data.work.data : [],
        board: data.board.state === 'ready' ? data.board.data : [],
        agentRows,
        roomAgents: agents,
        permissions,
        questions,
        now,
        onReview,
        onAnswer,
      }}
    />
  )
}
