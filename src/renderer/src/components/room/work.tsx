import { Maximize2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { AgentQuestion, AgentRow, BoardTask, LaneTask, WorkLane } from '@shared/daemon'
import { Initials } from '@/components/room/chat'
import type { PendingPermission } from '@/components/room/permissions'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { agentOfLane, type RoomAgent } from '@/lib/room-agents'
import { shortAge } from '@/lib/rooms'
import { cn } from '@/lib/utils'

/** Jam Desktop's four Work views, in its order and words; it opens on Status. */
export const WORK_VIEWS = [
  ['tasks', 'Tasks'],
  ['status', 'Status'],
  ['agents', 'Agents'],
  ['shared', 'Shared'],
] as const
export type WorkViewId = (typeof WORK_VIEWS)[number][0]

/** Jam's status columns, in its order and words, with each one's dot. */
const COLUMNS = [
  { id: 'pending', label: 'To-do', dot: 'bg-foreground-subtlest' },
  { id: 'in_progress', label: 'In progress', dot: 'bg-warning' },
  { id: 'hitl', label: 'Human in the loop', dot: 'bg-info' },
  { id: 'completed', label: 'Done', dot: 'bg-success' },
] as const
export type ColumnId = (typeof COLUMNS)[number]['id']

export interface WorkInputs {
  lanes: readonly WorkLane[]
  board: readonly BoardTask[]
  agentRows: readonly AgentRow[]
  roomAgents: readonly RoomAgent[]
  permissions: readonly PendingPermission[]
  questions: readonly { peerKey: string; question: AgentQuestion }[]
  now: number
  onReview(permission: PendingPermission): void
  onAnswer(code: string): void
}

/** One card on the board: an agent's task, a permission request, or a question with no task to sit on. */
export type Card =
  | { kind: 'task'; task: LaneTask; lane: WorkLane; question: AgentQuestion | null }
  | { kind: 'permission'; permission: PendingPermission }
  | { kind: 'question'; question: AgentQuestion; peerKey: string }

/**
 * Every card in its column, by agent. As Jam Desktop does (0.4.10), an agent's task in progress moves to Human in the loop
 * while the agent waits on the person's answer, with the question on it; a permission request is a card of its own, and
 * so is any other question the agent waits on.
 */
export function cardsOf({
  lanes,
  permissions,
  questions,
}: Pick<WorkInputs, 'lanes' | 'permissions' | 'questions'>): Map<string, Map<ColumnId, Card[]>> {
  const byAgent = new Map<string, Map<ColumnId, Card[]>>()
  const put = (peerKey: string, column: ColumnId, card: Card) => {
    const columns = byAgent.get(peerKey) ?? new Map<ColumnId, Card[]>()
    columns.set(column, [...(columns.get(column) ?? []), card])
    byAgent.set(peerKey, columns)
  }
  for (const lane of lanes) {
    const waiting = questions.filter((item) => item.peerKey === lane.peer_id)
    let asked = waiting[0]?.question ?? null
    for (const task of lane.tasks) {
      if (task.status === 'in_progress' && asked) {
        put(lane.peer_id, 'hitl', { kind: 'task', task, lane, question: asked })
        asked = null
      } else {
        const column: ColumnId =
          task.status === 'completed' ? 'completed' : task.status === 'in_progress' ? 'in_progress' : 'pending'
        put(lane.peer_id, column, { kind: 'task', task, lane, question: null })
      }
    }
    if (asked) put(lane.peer_id, 'hitl', { kind: 'question', question: asked, peerKey: lane.peer_id })
    for (const item of waiting.slice(1)) {
      put(lane.peer_id, 'hitl', { kind: 'question', question: item.question, peerKey: lane.peer_id })
    }
  }
  for (const item of questions) {
    if (!lanes.some((lane) => lane.peer_id === item.peerKey)) {
      put(item.peerKey, 'hitl', { kind: 'question', question: item.question, peerKey: item.peerKey })
    }
  }
  for (const permission of permissions) put(permission.peerKey, 'hitl', { kind: 'permission', permission })
  return byAgent
}

/**
 * Jam's Work: agents' private task lanes and the room's shared tasks, in Jam Desktop's four views. The view is chosen by
 * the parent (it sits in the room's toolbar).
 */
export function WorkBoard({ view, inputs }: { view: WorkViewId; inputs: WorkInputs }) {
  if (view === 'shared') return <SharedView board={inputs.board} now={inputs.now} />
  const cards = cardsOf(inputs)
  if (cards.size === 0) return <EmptyWork />
  if (view === 'agents') return <AgentsView cards={cards} inputs={inputs} />
  if (view === 'tasks') return <TasksView cards={cards} inputs={inputs} />
  return <StatusView cards={cards} inputs={inputs} />
}

export function WorkViewTabs({ view, onChange }: { view: WorkViewId; onChange(view: WorkViewId): void }) {
  return (
    <Tabs value={view} onValueChange={(value) => onChange(value as WorkViewId)}>
      <TabsList variant="segmented" aria-label="Work views">
        {WORK_VIEWS.map(([id, label]) => (
          <TabsTrigger key={id} value={id}>
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

function EmptyWork() {
  return (
    <p className="rounded-xl border border-line px-4 py-10 text-center text-ui-base text-foreground-subtle">
      No tasks in this room yet. They appear here as the agents work.
    </p>
  )
}

function agentName(inputs: WorkInputs, peerKey: string): string {
  return agentOfLane(inputs.agentRows, peerKey)?.name || peerKey.split('/').pop() || 'Agent'
}

function countOf(cards: Map<string, Map<ColumnId, Card[]>>, column: ColumnId): number {
  let count = 0
  for (const columns of cards.values()) count += columns.get(column)?.length ?? 0
  return count
}

function ColumnHeading({ column, count }: { column: (typeof COLUMNS)[number]; count: number }) {
  return (
    <div className="flex items-center gap-2 text-ui-base font-medium text-foreground">
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', column.dot)} />
      <span className="min-w-0 truncate">{column.label}</span>
      <span className="ml-auto text-ui-sm text-foreground-subtlest tabular-nums">{count}</span>
    </div>
  )
}

/** Status: Jam's board, a lane per agent across the four columns. */
function StatusView({ cards, inputs }: { cards: Map<string, Map<ColumnId, Card[]>>; inputs: WorkInputs }) {
  return (
    <div role="table" aria-label="Tasks by status" className="overflow-x-auto rounded-xl border border-line">
      <div role="row" className="grid min-w-[760px] grid-cols-[48px_repeat(4,minmax(0,1fr))] border-b border-line">
        <div role="columnheader">
          <span className="sr-only">Agent</span>
        </div>
        {COLUMNS.map((column) => (
          <div role="columnheader" key={column.id} className="px-3 py-2.5">
            <ColumnHeading column={column} count={countOf(cards, column.id)} />
          </div>
        ))}
      </div>
      {[...cards].map(([peerKey, columns]) => {
        const name = agentName(inputs, peerKey)
        const agent = inputs.roomAgents.find((item) => item.peerKey === peerKey)
        return (
          <div
            role="row"
            key={peerKey}
            aria-label={name}
            className="grid min-w-[760px] grid-cols-[48px_repeat(4,minmax(0,1fr))] border-b border-line last:border-b-0"
          >
            <div role="rowheader" className="flex justify-center pt-3">
              <AgentAvatar name={name} live={agent?.live ?? false} />
            </div>
            {COLUMNS.map((column) => (
              <div role="cell" key={column.id} className="flex flex-col gap-2 border-l border-line p-2">
                {(columns.get(column.id) ?? []).map((card) => (
                  <CardView key={cardKey(card)} card={card} inputs={inputs} compact />
                ))}
                {(columns.get(column.id) ?? []).length === 0 ? <Dash /> : null}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/** Tasks: the four columns side by side, their cards grouped by agent (Jam's "Group by agent", on at first). */
function TasksView({ cards, inputs }: { cards: Map<string, Map<ColumnId, Card[]>>; inputs: WorkInputs }) {
  const [grouped, setGrouped] = useState(true)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2 text-ui-base text-foreground-subtle">
        <span id="work-group-by-agent">Group by agent</span>
        <Switch aria-labelledby="work-group-by-agent" checked={grouped} onCheckedChange={setGrouped} />
      </div>
      <div className="grid auto-cols-[minmax(220px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1">
        {COLUMNS.map((column) => {
          const groups = [...cards].map(([peerKey, columns]) => ({ peerKey, list: columns.get(column.id) ?? [] }))
          const total = groups.reduce((sum, group) => sum + group.list.length, 0)
          return (
            <section
              key={column.id}
              aria-label={column.label}
              className="flex min-h-40 flex-col gap-2 rounded-xl border border-line bg-card p-2.5"
            >
              <div className="px-1 pb-1">
                <ColumnHeading column={column} count={total} />
              </div>
              {total === 0 ? <Dash /> : null}
              {groups
                .filter((group) => group.list.length > 0)
                .map((group) => (
                  <div key={group.peerKey} className="flex flex-col gap-2">
                    {grouped ? (
                      <div className="flex items-center gap-2 px-1 text-ui-sm text-foreground-subtle">
                        <Initials name={agentName(inputs, group.peerKey)} className="size-5" />
                        {agentName(inputs, group.peerKey)}
                      </div>
                    ) : null}
                    {group.list.map((card) => (
                      <CardView key={cardKey(card)} card={card} inputs={inputs} />
                    ))}
                  </div>
                ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** Agents: each agent's lane as a card: whether its runtime is live, its progress, and its tasks in full. */
function AgentsView({ cards, inputs }: { cards: Map<string, Map<ColumnId, Card[]>>; inputs: WorkInputs }) {
  return (
    <div className="flex flex-col gap-4">
      {[...cards].map(([peerKey, columns]) => {
        const row = agentOfLane(inputs.agentRows, peerKey)
        const agent = inputs.roomAgents.find((item) => item.peerKey === peerKey)
        const name = agentName(inputs, peerKey)
        const tasks = COLUMNS.flatMap((column) => columns.get(column.id) ?? [])
        const lane = inputs.lanes.find((item) => item.peer_id === peerKey)
        const done = lane?.tasks.filter((task) => task.status === 'completed').length ?? 0
        const total = lane?.tasks.length ?? 0
        return (
          <section key={peerKey} aria-label={name} className="rounded-xl border border-line bg-card">
            <header className="flex flex-col gap-3 border-b border-line p-3.5">
              <div className="flex items-center gap-3">
                <AgentAvatar name={name} live={agent?.live ?? false} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-ui-base font-semibold text-foreground">{name}</span>
                    {agent?.live ? <Badge>Active runtime</Badge> : null}
                  </div>
                  {row?.handle ? (
                    <div className="truncate font-mono text-ui-sm text-foreground-subtle">{row.handle}</div>
                  ) : null}
                </div>
                <span className="text-ui-sm text-foreground-subtle tabular-nums">
                  {done}/{total}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`${name}: ${done} of ${total} tasks done`}
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={done}
                className="h-1.5 overflow-hidden rounded-full bg-surface"
              >
                <div
                  className="h-full rounded-full bg-info"
                  style={{ width: total ? `${(done / total) * 100}%` : 0 }}
                />
              </div>
            </header>
            <div className="flex flex-col gap-2 p-2.5">
              {tasks.map((card) => (
                <CardView key={cardKey(card)} card={card} inputs={inputs} full />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** Shared: the room's shared tasks in Jam's three columns, in Jam's words ("Todo", "In Progress", "Done"). */
function SharedView({ board, now }: { board: readonly BoardTask[]; now: number }) {
  const columns = [
    { id: 'pending', label: 'Todo' },
    { id: 'in_progress', label: 'In Progress' },
    { id: 'completed', label: 'Done' },
  ] as const
  return (
    <div className="grid auto-cols-[minmax(220px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1">
      {columns.map((column) => {
        const tasks = board.filter((task) =>
          column.id === 'pending'
            ? task.overall !== 'in_progress' && task.overall !== 'completed'
            : task.overall === column.id,
        )
        return (
          <section
            key={column.id}
            aria-label={column.label}
            className="flex min-h-40 flex-col gap-2 rounded-xl border border-line bg-card p-2.5"
          >
            <div className="flex items-center px-1 pb-1 text-ui-base font-medium text-foreground">
              {column.label}
              <span className="ml-auto text-ui-sm text-foreground-subtlest tabular-nums">{tasks.length}</span>
            </div>
            {tasks.length === 0 ? <Dash /> : null}
            {tasks.map((task) => (
              <article key={task.uid} className="flex flex-col gap-1 rounded-lg border border-line bg-background p-2.5">
                <h4 className="text-ui-base font-medium text-foreground">
                  <span className="mr-1.5 font-mono text-ui-sm text-foreground-subtle">{task.uid}</span>
                  {task.subject}
                </h4>
                {task.detail ? <p className="text-ui-sm text-foreground-subtle italic">{task.detail}</p> : null}
                {task.created_at ? (
                  <p className="text-ui-sm text-foreground-subtlest">created {ago(task.created_at, now)}</p>
                ) : null}
              </article>
            ))}
          </section>
        )
      })}
    </div>
  )
}

function cardKey(card: Card): string {
  return card.kind === 'task'
    ? `task ${card.task.id}`
    : card.kind === 'permission'
      ? `permission ${card.permission.record.request.id}`
      : `question ${card.question.id}`
}

/** One card: Jam's task card (subject, blocked or blocks N, what the agent is doing, when), or a decision to make. */
function CardView({
  card,
  inputs,
  compact = false,
  full = false,
}: {
  card: Card
  inputs: WorkInputs
  compact?: boolean
  full?: boolean
}) {
  if (card.kind === 'permission') {
    const request = card.permission.record.request
    return (
      <article className="flex flex-col gap-2 rounded-lg border border-line bg-background p-2.5">
        <h4 className="text-ui-base font-medium text-foreground">Permission: {request.action || 'operation'}</h4>
        <p className="truncate text-ui-sm text-foreground-subtle italic">{request.description}</p>
        <Button size="sm" className="self-end" onClick={() => inputs.onReview(card.permission)}>
          Review
        </Button>
      </article>
    )
  }
  if (card.kind === 'question') {
    return (
      <article className="flex flex-col gap-2 rounded-lg border border-line bg-background p-2.5">
        <h4 className="text-ui-base font-medium text-foreground">Question</h4>
        <p className="text-ui-sm text-foreground-subtle">{card.question.prompt}</p>
        <AnswerButton code={card.question.answer_code} onAnswer={inputs.onAnswer} />
      </article>
    )
  }
  const { task, lane, question } = card
  const blocked = (task.blocked_by ?? []).some((id) =>
    lane.tasks.some((other) => other.id === id && other.status !== 'completed'),
  )
  const blocks = (task.blocks ?? []).length || lane.tasks.filter((other) => other.blocked_by?.includes(task.id)).length
  const done = task.status === 'completed'
  const when = done
    ? task.completed_at
      ? `completed ${ago(task.completed_at, inputs.now)}`
      : null
    : task.status === 'in_progress'
      ? `started ${ago(task.started_at || task.status_changed_at || task.first_seen_at || 0, inputs.now)}`
      : task.first_seen_at
        ? `created ${ago(task.first_seen_at, inputs.now)}`
        : null
  return (
    <article
      data-status={task.status}
      className={cn('flex flex-col gap-1 rounded-lg border border-line bg-background p-2.5', done && 'opacity-60')}
    >
      <div className="flex items-start gap-2">
        <h4
          className={cn(
            'min-w-0 flex-1 text-ui-base font-medium text-foreground',
            compact && 'line-clamp-2',
            done && 'line-through',
          )}
        >
          {task.subject}
        </h4>
        {blocked ? <Badge tone="warning">blocked</Badge> : blocks > 0 ? <Badge>{`blocks ${blocks}`}</Badge> : null}
        {full ? <Badge>{task.status.replace(/_/g, ' ')}</Badge> : null}
      </div>
      {task.active_form ? (
        <p className={cn('text-ui-sm text-foreground-subtle italic', compact && 'truncate')}>{task.active_form}</p>
      ) : null}
      {full && task.detail ? <p className="text-ui-sm text-foreground-subtle">{task.detail}</p> : null}
      {when ? <p className="text-ui-sm text-foreground-subtlest">{when}</p> : null}
      {question ? <AnswerButton code={question.answer_code} onAnswer={inputs.onAnswer} /> : null}
    </article>
  )
}

function AnswerButton({ code, onAnswer }: { code: string; onAnswer(code: string): void }) {
  return (
    <Button variant="outline" size="sm" className="mt-1 self-center" onClick={() => onAnswer(code)}>
      <Maximize2 />
      Answer…
    </Button>
  )
}

function AgentAvatar({ name, live }: { name: string; live: boolean }) {
  return (
    <span className="relative inline-flex self-start">
      <Initials name={name} className="size-8" />
      {live ? (
        <span
          role="img"
          aria-label="Online"
          className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-success ring-2 ring-card"
        />
      ) : null}
    </span>
  )
}

function Badge({ children, tone }: { children: ReactNode; tone?: 'warning' }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-1.5 text-ui-xs leading-5 whitespace-nowrap',
        tone === 'warning' ? 'border-warning/50 bg-warning/10 text-foreground' : 'border-line text-foreground-subtle',
      )}
    >
      {children}
    </span>
  )
}

function Dash() {
  return (
    <span aria-label="None" className="py-1 text-center text-ui-base text-foreground-subtlest">
      —
    </span>
  )
}

/** A card's time as Jam writes it: "just now", "2m ago", or the date. */
function ago(ms: number, now: number): string {
  if (!ms) return 'just now'
  const age = shortAge(ms, now)
  if (age === 'now') return 'just now'
  return /^\d+[mhdw]$/.test(age) ? `${age} ago` : age
}
