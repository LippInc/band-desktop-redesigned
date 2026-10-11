import { create } from 'zustand'
import { jam } from '@/lib/platform'
import { useRoomStore } from '@/stores/room'

/**
 * Setting a room's plan from a file on this computer. The plan's card and the Plan tab's empty state both start it,
 * so its in-flight flag and its problem are kept here and not in either control: one write at a time, and a refusal
 * said by the place that asked, in the room that asked - the same rule the room organisation's write follows, with
 * the room added, because a refusal earned in one room is not a true statement in another. The file itself is chosen
 * in a dialog the main process opens, and its path never reaches this page.
 */

/** Where the person acted: the plan card at the top of Chat, or the Plan tab of the room's panel. */
export type PlanPlace = 'card' | 'pane'

interface PlanWrite {
  /** True while one choosing is on its way, which is what keeps a second from starting beside it. */
  busy: boolean
  problem: string | null
  /** Which place and which room the refusal belongs to; it is said there and nowhere else. */
  where: PlanPlace | null
  room: string | null
  /**
   * The place whose control takes the focus back once a choosing has settled. The control that started it may be gone
   * by then - a room's first plan swaps Choose file… for Plan actions - so whichever control that place shows now
   * takes it, and `at` keeps a place shown only much later from taking it.
   */
  focus: { where: PlanPlace; room: string; at: number } | null
}

export const usePlanWrite = create<PlanWrite>(() => ({
  busy: false,
  problem: null,
  where: null,
  room: null,
  focus: null,
}))

/** How long a settled choosing's focus waits for its place's control to show. */
export const FOCUS_BACK_MS = 2000

/** This app's own words: Jam was never seen failing this write or refusing a file, so it has none of its own to copy. */
export const PLAN_WRITE_FAILED = 'Band could not set this room’s plan.'
export const PLAN_NOT_MARKDOWN = 'Choose a Markdown (.md) file.'
export const PLAN_ELSEWHERE = 'The plan’s file must be on this computer.'
export const PLAN_MISSING = 'That file is no longer there.'

/**
 * Asks for one Markdown file and makes it the room's plan source, then reads the room again so the screens show the
 * plan Jam now holds rather than the one this app hoped for. Nothing is sent while another choosing is in flight or
 * outside the desktop app; a dialog closed without choosing sends nothing and says nothing. The choosing settles once
 * the room has been read again, so the control that takes the focus back is the one the place now shows.
 */
export function askForPlanFile(profile: string, roomId: string, where: PlanPlace): boolean {
  const api = jam()
  if (!api || usePlanWrite.getState().busy) return false
  usePlanWrite.setState({ busy: true, problem: null, where: null, room: null, focus: null })
  ;(async () => {
    const result = await api.plan.choose({ profile, roomId })
    if (result.done) {
      // A read that fails after the write is not a failed write: the room shows what it could read.
      await useRoomStore
        .getState()
        .load(profile, roomId)
        .catch(() => {})
      return
    }
    if (result.reason === 'canceled') return
    const problem =
      result.reason === 'not-markdown'
        ? PLAN_NOT_MARKDOWN
        : result.reason === 'elsewhere'
          ? PLAN_ELSEWHERE
          : result.reason === 'missing'
            ? PLAN_MISSING
            : PLAN_WRITE_FAILED
    usePlanWrite.setState({ problem, where, room: roomId })
  })()
    .catch(() => usePlanWrite.setState({ problem: PLAN_WRITE_FAILED, where, room: roomId }))
    .finally(() => usePlanWrite.setState({ busy: false, focus: { where, room: roomId, at: Date.now() } }))
  return true
}

/** Whether a settled choosing's focus belongs to this place in this room, now. */
export const focusBackFor = (state: PlanWrite, where: PlanPlace, roomId: string, now: number): boolean =>
  state.focus !== null &&
  state.focus.where === where &&
  state.focus.room === roomId &&
  now - state.focus.at <= FOCUS_BACK_MS

/**
 * Jam's "Or attach from the terminal" (Jam Desktop 0.4.10's Plan actions): a diagram from a JSON file, then a plan from
 * a Markdown file, each through Band's own CLI and aimed at this room. Copy command copies both lines. The CLI is `band`
 * since 0.4.14, whose help writes the first line exactly so (`band plan diagram <chat-id> < arch.json`).
 */
export const planCommands = (roomId: string): string =>
  [`band plan diagram ${roomId} < arch.json`, `band plan set ${roomId} ./plan.md`].join('\n')

/** The refusal this place in this room should say, or null: every other place and room says nothing. */
export const planProblemFor = (state: PlanWrite, where: PlanPlace, roomId: string): string | null =>
  state.where === where && state.room === roomId ? state.problem : null

export const usePlanProblem = (where: PlanPlace, roomId: string): string | null =>
  usePlanWrite((state) => planProblemFor(state, where, roomId))
