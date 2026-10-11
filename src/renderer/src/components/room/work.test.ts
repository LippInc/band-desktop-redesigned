import { describe, expect, it } from 'vitest'
import type { AgentQuestion, LaneTask, PermissionRecord, WorkLane } from '@shared/daemon'
import type { PendingPermission } from './permissions'
import { cardsOf, type Card, type ColumnId } from './work'

const ATLAS = 'default/atlas'
const task = (id: string, status: string): LaneTask => ({ id, subject: `Task ${id}`, status }) as unknown as LaneTask
const lane = (tasks: LaneTask[]): WorkLane => ({ peer_id: ATLAS, active: true, tasks }) as unknown as WorkLane
const question = (code: string) => ({ id: code, prompt: 'Which?', answer_code: code }) as unknown as AgentQuestion
const permission: PendingPermission = {
  peerKey: ATLAS,
  agentHandle: 'sam-rivera/atlas',
  record: { status: 'pending', request: { id: 'p1', action: 'Write' } } as unknown as PermissionRecord,
}

/** A card as a short label. */
function label(card: Card): string {
  return card.kind === 'task'
    ? `${card.task.id}${card.question ? ` + ${card.question.answer_code}` : ''}`
    : card.kind === 'question'
      ? `question ${card.question.answer_code}`
      : `permission ${card.permission.record.request.id}`
}

/** Each column's cards for Atlas, as short labels. */
function columns(cards: Map<string, Map<ColumnId, Card[]>>): Record<string, string[]> {
  return Object.fromEntries(
    [...(cards.get(ATLAS) ?? new Map<ColumnId, Card[]>())].map(([id, list]) => [id, list.map(label)]),
  )
}

describe("Work's cards, as Jam Desktop places them", () => {
  it('puts each task in its column, the one in progress in Human in the loop while its question waits', () => {
    const cards = cardsOf({
      lanes: [lane([task('a', 'pending'), task('b', 'in_progress'), task('c', 'completed')])],
      permissions: [permission],
      questions: [{ peerKey: ATLAS, question: question('1A2B3C4D') }],
    })
    expect(columns(cards)).toEqual({
      pending: ['a'],
      hitl: ['b + 1A2B3C4D', 'permission p1'],
      completed: ['c'],
    })
  })

  it('shows every question the agent waits on: the first on its task, any other as a card of its own', () => {
    const cards = cardsOf({
      lanes: [lane([task('b', 'in_progress')])],
      permissions: [],
      questions: [
        { peerKey: ATLAS, question: question('1A2B3C4D') },
        { peerKey: ATLAS, question: question('5E6F7A8B') },
      ],
    })
    expect(columns(cards)).toEqual({ hitl: ['b + 1A2B3C4D', 'question 5E6F7A8B'] })
  })

  it('shows a question from an agent with no task as a card, and one from an agent with no lane too', () => {
    const cards = cardsOf({
      lanes: [lane([task('a', 'pending')])],
      permissions: [],
      questions: [
        { peerKey: ATLAS, question: question('1A2B3C4D') },
        { peerKey: 'default/nova', question: question('5E6F7A8B') },
      ],
    })
    expect(columns(cards)).toEqual({ pending: ['a'], hitl: ['question 1A2B3C4D'] })
    expect([...(cards.get('default/nova')?.get('hitl') ?? [])].map((card) => card.kind)).toEqual(['question'])
  })
})
