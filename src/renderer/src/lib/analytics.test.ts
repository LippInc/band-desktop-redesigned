import { describe, expect, it } from 'vitest'
import type { UsageAgent, UsageRow, UsageSession } from '@shared/daemon'
import { axisScale, axisTicks, labelStride, stepDecimals, tickText } from '@/components/chart'
import {
  activityCards,
  costAmount,
  dayLabel,
  modelTotals,
  momentText,
  peerLabel,
  seriesLabels,
  seriesLines,
  sessionGroups,
  sessionTotal,
  tokenCount,
  totalTokens,
  windowRows,
} from '@/lib/analytics'

const amounts = (input: number, output: number, cost: number) => ({
  inputTokens: input,
  outputTokens: output,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
  totalCost: cost,
  missingPricing: false,
})

const model = (name: string, input: number, output: number, cost: number, missing = false) => ({
  ...amounts(input, output, cost),
  provider: 'claudecode',
  model: name,
  cost,
  missingPricing: missing,
  pricing: [{ costKind: 'estimated_equivalent', currency: 'USD', source: 'usage_import', amountUsd: cost }],
})

const day = (period: string, cost: number, models: ReturnType<typeof model>[] = []): UsageRow => ({
  ...amounts(0, 0, cost),
  period,
  archived: false,
  models,
})

describe('what Analytics shows', () => {
  it('writes a number of tokens as Jam does: every digit below a thousand, then one decimal', () => {
    expect(tokenCount(80)).toBe('80')
    expect(tokenCount(633)).toBe('633')
    expect(tokenCount(13_700)).toBe('13.7K')
    expect(tokenCount(23_500_000)).toBe('23.5M')
    expect(tokenCount(8_000_000_000)).toBe('8.0B')
    expect(tokenCount(undefined)).toBe('0')
  })

  it('writes an amount whole from a hundred up and to the cent below it', () => {
    expect(costAmount(6526.44)).toBe('$6,526')
    expect(costAmount(613)).toBe('$613')
    expect(costAmount(8.57)).toBe('$8.57')
    expect(costAmount(0.05)).toBe('$0.05')
    expect(costAmount(0)).toBe('$0.00')
    expect(costAmount(undefined)).toBe('$0.00')
  })

  it('counts every kind of token in a total', () => {
    expect(
      totalTokens({
        inputTokens: 1,
        outputTokens: 2,
        cacheCreationTokens: 4,
        cacheReadTokens: 8,
        reasoningTokens: 16,
      }),
    ).toBe(31)
    expect(totalTokens(undefined)).toBe(0)
  })

  describe("Jam's seven cards", () => {
    const snapshot = { executions: 86, active_chats: 1, activity_spark: [0, 113], human_sent: 27, human_recv: 86 }

    it('adds Activity from what was sent and what came back, as Jam does (113 = 27 + 86)', () => {
      const cards = activityCards(snapshot, { local: 1, remote: 0 })
      expect(cards.map((card) => [card.label, card.value])).toEqual([
        ['Local Agents', '1'],
        ['Remote Agents', '0'],
        ['Chat Rooms', '1'],
        ['Executions', '86'],
        ['Activity', '113'],
        ['You Sent', '27'],
        ['You Received', '86'],
      ])
    })

    it("carries Jam's own line and its sparkline on the Activity card only", () => {
      const cards = activityCards(snapshot, { local: 1, remote: 0 })
      const activity = cards.find((card) => card.label === 'Activity')
      expect(activity?.note).toBe('avg / 5h window pending')
      expect(activity?.spark).toEqual([0, 113])
      expect(cards.filter((card) => card.note !== undefined)).toHaveLength(1)
      expect(cards.filter((card) => card.spark !== undefined)).toHaveLength(1)
    })

    it('says "Not tracked yet" for what it has not measured, but shows a real zero', () => {
      const cards = activityCards({ active_chats: 0 }, null)
      const value = (label: string) => cards.find((card) => card.label === label)?.value
      expect(value('Chat Rooms')).toBe('0')
      expect(value('Executions')).toBe('Not tracked yet')
      expect(value('Activity')).toBe('Not tracked yet')
      expect(value('Local Agents')).toBe('Not tracked yet')
    })

    // The strip is a grid, so a count that does not divide by its columns leaves a short last row. One card takes two
    // cells to make the count up; this fails if that card loses its flag, gains a second, or an eighth total arrives.
    it('makes up an even number of cells for the strip, whether or not anything is measured', () => {
      for (const cards of [activityCards(snapshot, { local: 1, remote: 0 }), activityCards(null, null)]) {
        const cells = cards.reduce((sum, card) => sum + (card.wide ? 2 : 1), 0)
        expect(cells).toBeGreaterThan(0)
        expect(cells % 4).toBe(0)
        expect(cells % 2).toBe(0)
      }
    })
  })

  it('keys a series line by its id, and by its own name where the daemon gives none', () => {
    const withIds = seriesLines({
      series: ['Atlas', 'Nova'],
      series_keys: ['id-a', 'id-b'],
      points: [
        { label: '2026-03-02', values: [1, 2] },
        { label: '2026-03-03', values: [3] },
      ],
    })
    expect(withIds).toEqual([
      { key: 'id-a', name: 'Atlas', values: [1, 3] },
      // The second day has no value for Nova, which counts as none rather than breaking the line.
      { key: 'id-b', name: 'Nova', values: [2, 0] },
    ])
    const withoutIds = seriesLines({ series: ['text'], series_keys: [], points: [{ label: 'd', values: [4] }] })
    expect(withoutIds[0]?.key).toBe('text')
  })

  it('writes Last activity in full, keeping the time of day', () => {
    // A room's short form drops the clock on any day but today; Jam's column carries the date and the clock together.
    const at = Date.parse('2026-03-09T14:58:02.000Z')
    const shown = momentText(at)
    expect(shown).toContain(new Date(at).getFullYear().toString())
    expect(shown.length).toBeGreaterThan(new Date(at).toLocaleDateString().length)
  })

  it('writes a day under a chart as Jam does, with the year left off', () => {
    expect(dayLabel('2026-03-09')).toBe('03-09')
    expect(dayLabel('Week 12')).toBe('Week 12')
    expect(seriesLabels({ series: [], series_keys: [], points: [{ label: '2026-03-09', values: [] }] })).toEqual([
      '03-09',
    ])
  })

  describe('the usage window', () => {
    const rows = [day('2026-02-20', 5), day('2026-03-05', 10), day('2026-03-09', 20), day('2026-03-07', 15)]

    it('counts back from the newest day the daemon reports, not from today', () => {
      expect(windowRows(rows, 7).map((row) => row.period)).toEqual(['2026-03-05', '2026-03-07', '2026-03-09'])
      expect(windowRows(rows, 30).map((row) => row.period)).toEqual([
        '2026-02-20',
        '2026-03-05',
        '2026-03-07',
        '2026-03-09',
      ])
      // Thirty days back from the 9th of March is the 8th of February, so a day before that is outside the window.
      expect(windowRows([day('2026-02-07', 1), day('2026-03-09', 2)], 30).map((row) => row.period)).toEqual([
        '2026-03-09',
      ])
    })

    it('takes the window inclusive of its first day and leaves out what is older', () => {
      // Three days back from the 9th is the 7th, 8th and 9th; the 5th is outside it.
      expect(windowRows(rows, 3 as 7).map((row) => row.period)).toEqual(['2026-03-07', '2026-03-09'])
    })

    it('leaves out a period that is not a day, and answers nothing for no rows', () => {
      expect(windowRows([{ ...day('2026-03', 1) }], 30)).toEqual([])
      expect(windowRows([], 7)).toEqual([])
    })
  })

  describe('the per-model table', () => {
    const rows = [
      // A day's own total is what its models add up to, as the daemon's answer is built.
      day('2026-03-08', 20, [model('opus', 10, 100, 20), model('free', 5, 5, 0)]),
      day('2026-03-09', 35, [model('opus', 30, 300, 35), model('unpriced', 1, 1, 0, true)]),
    ]

    it('adds each model over the days and puts the heaviest first', () => {
      expect(modelTotals(rows).map((one) => [one.model, one.input, one.output, one.cost])).toEqual([
        ['opus', 40, 400, 55],
        ['free', 5, 5, 0],
        ['unpriced', 1, 1, 0],
      ])
    })

    it('marks the model the catalogue does not price, and says where an amount came from', () => {
      const totals = modelTotals(rows)
      expect(totals.find((one) => one.model === 'unpriced')?.unpriced).toBe(true)
      expect(totals.find((one) => one.model === 'opus')?.unpriced).toBe(false)
      expect(totals.find((one) => one.model === 'opus')?.source).toBe('Estimated USD via usage_import')
    })

    it("keeps a model's amount when only some of its days were unpriced", () => {
      // One unpriced day used to mark the whole model unpriced, which took its amount out of the table while the
      // total above it still counted the amount - the table and the chart would have disagreed.
      const mixed = [
        day('2026-03-08', 20, [model('opus', 10, 100, 20)]),
        day('2026-03-09', 0, [model('opus', 1, 1, 0, true)]),
      ]
      const [only] = modelTotals(mixed)
      expect(only?.unpriced).toBe(false)
      expect(only?.cost).toBe(20)
      // A model priced on no day at all is still explained rather than given an amount.
      const never = modelTotals([day('2026-03-09', 0, [model('local', 1, 1, 0, true)])])
      expect(never[0]?.unpriced).toBe(true)
    })

    it('adds up to the same total as the days it was built from, so the table matches the chart', () => {
      const perModel = modelTotals(rows).reduce((sum, one) => sum + one.cost, 0)
      expect(perModel).toBe(rows.reduce((sum, row) => sum + (row.totalCost ?? 0), 0))
      expect(perModel).toBe(55)
    })
  })

  describe('full session cost', () => {
    const sessions: UsageSession[] = [
      {
        ...amounts(10, 20, 12.5),
        sessionId: 'aaaaaaaa-1111-4111-8111-111111111111',
        provider: 'claudecode',
        lastActivity: '2026-03-09T10:00:00.000Z',
        attribution: { agentId: 'id-a', peerName: 'workshop/atlas', chatId: 'room-1' },
      },
      {
        ...amounts(1, 2, 3),
        sessionId: 'bbbbbbbb-2222-4222-8222-222222222222',
        provider: 'claudecode',
        lastActivity: '2026-03-08T10:00:00.000Z',
        attribution: null,
      },
    ]
    const agents: UsageAgent[] = [
      {
        ...amounts(10, 20, 12.5),
        peerName: 'workshop/atlas',
        sessionCount: 1,
        lastActivity: '2026-03-09T10:00:00.000Z',
      },
      { ...amounts(1, 2, 3), peerName: '(unattributed)', sessionCount: 331, lastActivity: '2026-03-08T10:00:00.000Z' },
    ]
    const titles = { 'room-1': 'Checkout flow redesign' }

    it("keeps the daemon's own count of sessions, which is larger than the sessions it still lists", () => {
      const groups = sessionGroups(sessions, agents, 'agents', titles)
      expect(groups.map((group) => [group.name, group.sessions, group.cost])).toEqual([
        ['atlas', 1, 12.5],
        ['(unattributed)', 331, 3],
      ])
    })

    it('names a session by the room it worked in, with the head of its own id', () => {
      const groups = sessionGroups(sessions, agents, 'agents', titles)
      expect(groups[0]?.children).toEqual([
        expect.objectContaining({ name: 'Checkout flow redesign', short: 'aaaaaaaa', sessions: 1 }),
      ])
    })

    it("names a session by its room id when that room is not in the account's list, never as unattributed", () => {
      // A session with an agent is attributed, whatever this app can say about its room.
      const groups = sessionGroups(sessions, agents, 'agents', {})
      // The head of the room's id stands in for a name, as it does for a session's own id.
      expect(groups[0]?.children[0]?.name).toBe('room')
      expect(groups[0]?.children[0]?.name).not.toBe('(unattributed)')
    })

    it("carries Jam's own line on the row it could not attribute, and on no other", () => {
      const groups = sessionGroups(sessions, agents, 'agents', titles)
      expect(groups[1]?.note).toBe('Usage not linked to a Band agent.')
      expect(groups[0]?.note).toBeNull()
    })

    it('groups by room from the same sessions, naming each session by its agent', () => {
      const groups = sessionGroups(sessions, agents, 'rooms', titles)
      expect(groups.map((group) => [group.name, group.sessions])).toEqual([
        ['Checkout flow redesign', 1],
        ['(unattributed)', 1],
      ])
      expect(groups[0]?.children[0]?.name).toBe('atlas')
    })

    it("drops the owner's prefix from a peer's name, as Jam does", () => {
      expect(peerLabel('workshop/atlas')).toBe('atlas')
      expect(peerLabel('atlas')).toBe('atlas')
      expect(peerLabel('(unattributed)')).toBe('(unattributed)')
    })

    it('puts a session the daemon named no one for on the row for usage with no agent', () => {
      // An attribution with no peer name used to match no group at all, and the session vanished from the table.
      const nameless: UsageSession = {
        ...amounts(5, 5, 1),
        sessionId: 'cccccccc-3333-4333-8333-333333333333',
        provider: 'claudecode',
        lastActivity: '2026-03-08T09:00:00.000Z',
        attribution: { agentId: 'id-x', peerName: null, chatId: null },
      }
      const groups = sessionGroups([...sessions, nameless], agents, 'agents', titles)
      const listed = groups.flatMap((group) => group.children.map((child) => child.key))
      expect(listed).toContain(nameless.sessionId)
    })

    it('names a room the daemon lists without a title by its id, in both groupings', () => {
      const groups = sessionGroups(sessions, agents, 'rooms', { 'room-1': '' })
      expect(groups[0]?.name).toBe('room')
      expect(sessionGroups(sessions, agents, 'agents', { 'room-1': '' })[0]?.children[0]?.name).toBe('room')
    })

    it('totals the same either way round, where the daemon lists every session it counts', () => {
      const counted: UsageAgent[] = agents.map((agent) => ({
        ...agent,
        sessionCount: agent.peerName === '(unattributed)' ? 1 : agent.sessionCount,
      }))
      const byAgent = sessionTotal(sessionGroups(sessions, counted, 'agents', titles))
      const byRoom = sessionTotal(sessionGroups(sessions, counted, 'rooms', titles))
      expect(byAgent.sessions).toBe(byRoom.sessions)
      expect(byAgent.cost).toBeCloseTo(byRoom.cost, 6)
    })

    it('totals every group', () => {
      const groups = sessionGroups(sessions, agents, 'agents', titles)
      expect(sessionTotal(groups)).toMatchObject({ name: 'Total', sessions: 332, cost: 15.5 })
    })
  })

  describe("a chart's axis", () => {
    it('takes a round step and a top that is a whole number of them', () => {
      expect(axisScale(44)).toEqual({ top: 60, step: 20 })
      expect(axisScale(205)).toEqual({ top: 300, step: 100 })
      expect(axisScale(25)).toEqual({ top: 30, step: 10 })
      expect(axisTicks(60, 20)).toEqual([60, 40, 20, 0])
    })

    it("gives an empty chart Jam's own empty axis", () => {
      expect(axisScale(0)).toEqual({ top: 1, step: 0.2 })
      expect(axisTicks(1, 0.2)).toEqual([1, 0.8, 0.6, 0.4, 0.2, 0])
    })

    it('writes each label to the precision of the step it sits on', () => {
      // A step of 2.5 rounded to whole numbers turned the gridline at 7.5 into an 8, and the bar on it read wrong.
      const { top, step } = axisScale(9)
      expect([top, step]).toEqual([10, 2.5])
      expect(axisTicks(top, step).map((tick) => tickText(tick, step))).toEqual(['10.0', '7.5', '5.0', '2.5', '0.0'])
      expect(tickText(40, 20)).toBe('40')
      expect(tickText(0.6, 0.2)).toBe('0.6')
      expect(tickText(1200, 400)).toBe('1,200')
    })

    it("writes a label to the step's own precision, however small the step", () => {
      // One decimal everywhere turned the gridline at 0.75 into 0.8, and a step below a tenth into a row of zeroes.
      expect(stepDecimals(2.5)).toBe(1)
      expect(stepDecimals(0.25)).toBe(2)
      expect(stepDecimals(0.05)).toBe(2)
      expect(stepDecimals(20)).toBe(0)
      expect(tickText(0.75, 0.25)).toBe('0.75')
      expect(tickText(0.15, 0.05)).toBe('0.15')
      const small = axisScale(0.9)
      expect(axisTicks(small.top, small.step).map((tick) => tickText(tick, small.step))).toEqual([
        '1.00',
        '0.75',
        '0.50',
        '0.25',
        '0.00',
      ])
    })

    it('thins the day labels as the range grows, so they never sit on each other', () => {
      expect(labelStride(8)).toBe(1)
      expect(labelStride(14)).toBe(1)
      expect(labelStride(30)).toBe(3)
      expect(labelStride(91)).toBe(7)
      expect(labelStride(0)).toBe(1)
    })

    it('never divides by nothing', () => {
      expect(axisScale(Number.NaN).top).toBe(1)
      expect(axisScale(-5).top).toBe(1)
    })
  })
})
