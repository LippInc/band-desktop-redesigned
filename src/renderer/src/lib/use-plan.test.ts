import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PlanChoiceResult } from '@shared/ipc-contract'
import {
  askForPlanFile,
  FOCUS_BACK_MS,
  focusBackFor,
  PLAN_ELSEWHERE,
  PLAN_NOT_MARKDOWN,
  PLAN_WRITE_FAILED,
  planCommands,
  planProblemFor,
  usePlanWrite,
} from './use-plan'

const CHECKOUT = '5b0f6c2e-8d1a-4c3b-9e7f-2a4d6b8c0e11'
const RELEASE = '8c2d4e6f-1a3b-4c5d-8e9f-0a1b2c3d4e5f'

/** Every choosing asked for, and a way to answer the latest one the way the main process would. */
let asked: { profile: string; roomId: string }[] = []
let answer: PromiseWithResolvers<PlanChoiceResult>

beforeEach(() => {
  asked = []
  ;(globalThis as { window?: unknown }).window = {
    jam: {
      plan: {
        choose: (input: { profile: string; roomId: string }) => {
          asked.push(input)
          // A fresh resolver per call, so each choosing is answered on its own.
          answer = Promise.withResolvers<PlanChoiceResult>()
          return answer.promise
        },
      },
    },
  }
  usePlanWrite.setState({ busy: false, problem: null, where: null, room: null, focus: null })
})

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('setting a room’s plan from a file', () => {
  /**
   * The plan card and the Plan tab both start this, so the flag that keeps one choosing in flight is one flag for
   * the room: two starts from one screen must not both send.
   */
  it('sends one choosing at a time, whichever place asked', () => {
    expect(askForPlanFile('default', CHECKOUT, 'card')).toBe(true)
    expect(usePlanWrite.getState().busy).toBe(true)

    // The Plan tab, on the same screen, while the first is still on its way.
    expect(askForPlanFile('default', CHECKOUT, 'pane')).toBe(false)
    expect(asked).toEqual([{ profile: 'default', roomId: CHECKOUT }])
  })

  it('says nothing when it was done, or when the dialog was closed without choosing', async () => {
    askForPlanFile('default', CHECKOUT, 'card')
    answer.resolve({ done: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(usePlanWrite.getState()).toMatchObject({ busy: false, problem: null, where: null, room: null })
    // The place that asked takes the focus back once the choosing has settled.
    expect(usePlanWrite.getState().focus).toMatchObject({ where: 'card', room: CHECKOUT })

    askForPlanFile('default', CHECKOUT, 'pane')
    answer.resolve({ done: false, reason: 'canceled' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(usePlanWrite.getState()).toMatchObject({ busy: false, problem: null, where: null, room: null })
    expect(usePlanWrite.getState().focus).toMatchObject({ where: 'pane', room: CHECKOUT })
  })

  it('says what a refused file was, by the place that asked', async () => {
    for (const [reason, line] of [
      ['not-markdown', PLAN_NOT_MARKDOWN],
      ['elsewhere', PLAN_ELSEWHERE],
      ['missing', 'That file is no longer there.'],
      ['unavailable', PLAN_WRITE_FAILED],
    ] as const) {
      askForPlanFile('default', CHECKOUT, 'pane')
      answer.resolve({ done: false, reason })
      await new Promise((resolve) => setTimeout(resolve, 0))
      // The refusal belongs to the place that asked - the Plan tab here - so the card says nothing about it.
      expect(usePlanWrite.getState()).toMatchObject({ busy: false, problem: line, where: 'pane', room: CHECKOUT })
    }
  })

  /** A refusal earned in one room is not a true statement in another, so it stays with the room that asked. */
  it('keeps a refusal to the room it happened in', async () => {
    askForPlanFile('default', CHECKOUT, 'card')
    answer.resolve({ done: false, reason: 'not-markdown' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(usePlanWrite.getState().room).toBe(CHECKOUT)

    // Another room opens: its card and its Plan tab must both say nothing about the first room's refusal.
    expect(usePlanWrite.getState().problem).not.toBeNull()
    askForPlanFile('default', RELEASE, 'card')
    // The next choosing clears the old refusal wherever it was said.
    answer.resolve({ done: false, reason: 'canceled' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(usePlanWrite.getState()).toMatchObject({ busy: false, problem: null, where: null, room: null })
  })

  it('says its own line when the main process itself refused', async () => {
    askForPlanFile('default', CHECKOUT, 'card')
    answer.reject(new Error('refused'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(usePlanWrite.getState()).toMatchObject({
      busy: false,
      problem: PLAN_WRITE_FAILED,
      where: 'card',
      room: CHECKOUT,
    })
  })

  it('sends nothing outside the desktop app', () => {
    delete (globalThis as { window?: unknown }).window
    expect(askForPlanFile('default', CHECKOUT, 'card')).toBe(false)
    expect(asked).toEqual([])
  })
})

describe('where a refusal is said', () => {
  const refused = { busy: false, problem: PLAN_NOT_MARKDOWN, where: 'pane' as const, room: CHECKOUT, focus: null }

  it('is said by the place that asked, in the room that asked', () => {
    expect(planProblemFor(refused, 'pane', CHECKOUT)).toBe(PLAN_NOT_MARKDOWN)
  })

  it('is not said by the other place in the same room', () => {
    expect(planProblemFor(refused, 'card', CHECKOUT)).toBeNull()
  })

  it('is not said in another room, by either place', () => {
    expect(planProblemFor(refused, 'pane', RELEASE)).toBeNull()
    expect(planProblemFor(refused, 'card', RELEASE)).toBeNull()
  })
})

describe('which control takes the focus back', () => {
  const settled = (where: 'card' | 'pane', room: string, at: number) => ({
    busy: false,
    problem: null,
    where: null,
    room: null,
    focus: { where, room, at },
  })

  it('is the control of the place that asked, in the room that asked', () => {
    expect(focusBackFor(settled('card', CHECKOUT, 1000), 'card', CHECKOUT, 1000)).toBe(true)
  })

  it('is not the other place, nor any place in another room', () => {
    expect(focusBackFor(settled('card', CHECKOUT, 1000), 'pane', CHECKOUT, 1000)).toBe(false)
    expect(focusBackFor(settled('card', CHECKOUT, 1000), 'card', RELEASE, 1000)).toBe(false)
  })

  it('is no one once the moment has passed, so a place shown much later does not take it', () => {
    expect(focusBackFor(settled('card', CHECKOUT, 1000), 'card', CHECKOUT, 1000 + FOCUS_BACK_MS)).toBe(true)
    expect(focusBackFor(settled('card', CHECKOUT, 1000), 'card', CHECKOUT, 1001 + FOCUS_BACK_MS)).toBe(false)
  })

  it('is no one while nothing has settled', () => {
    expect(focusBackFor({ ...settled('card', CHECKOUT, 1000), focus: null }, 'card', CHECKOUT, 1000)).toBe(false)
  })
})

describe('attaching from the terminal', () => {
  it('gives Jam’s two lines for this room: a diagram from JSON, then a plan from Markdown', () => {
    expect(planCommands(CHECKOUT).split(/\r?\n/)).toEqual([
      `band plan diagram ${CHECKOUT} < arch.json`,
      `band plan set ${CHECKOUT} ./plan.md`,
    ])
  })

  it('names the room it was asked for, and no other', () => {
    expect(planCommands(RELEASE)).not.toContain(CHECKOUT)
  })
})
