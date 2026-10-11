import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RoomOrg } from '@shared/daemon'
import { changeRoomOrg, ORG_WRITE_FAILED, useRoomOrgWrite } from './use-room-org'

const CHECKOUT = '5b0f6c2e-8d1a-4c3b-9e7f-2a4d6b8c0e11'
const RELEASE = '7c1e4a9d-2b6f-4e8a-b3d5-1f7a9c2e4b60'

const whole = (): RoomOrg => ({ folders: [], assignments: {}, pinned: [], collapsed: [], archived: {} })

/** Every organisation sent, and a way to answer the call the way the daemon would. */
let sent: RoomOrg[] = []
let answer: PromiseWithResolvers<{ set: true }>

beforeEach(() => {
  sent = []
  answer = Promise.withResolvers<{ set: true }>()
  ;(globalThis as { window?: unknown }).window = {
    jam: {
      daemon: {
        setRoomOrg: ({ org }: { profile: string; org: RoomOrg }) => {
          sent.push(org)
          return answer.promise
        },
      },
    },
  }
  useRoomOrgWrite.setState({ busy: false, problem: null, where: null })
})

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('changing the room organisation', () => {
  /**
   * The whole organisation goes back in one call, so two changes started from the same reading would each send the
   * whole of it and the later would undo the earlier. The flag that stops that is one flag for the window: the
   * controls that change the organisation sit on different screens and in different components.
   */
  it('sends one change at a time, whichever control asked', async () => {
    const pin = (org: RoomOrg): RoomOrg => ({ ...org, pinned: [CHECKOUT] })
    const archive = (org: RoomOrg): RoomOrg => ({ ...org, archived: { [RELEASE]: 1 } })
    const reading = whole()

    expect(changeRoomOrg('default', reading, pin, 'rooms')).toBe(true)
    expect(useRoomOrgWrite.getState().busy).toBe(true)

    // A second control, on another screen, holding the same reading while the first is still on its way.
    expect(changeRoomOrg('default', reading, archive, 'home')).toBe(false)
    expect(sent).toEqual([{ ...whole(), pinned: [CHECKOUT] }])

    answer.reject(new Error('the daemon refused'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The refusal belongs to the place that asked - the room list here - so Home says nothing about it.
    expect(useRoomOrgWrite.getState()).toEqual({ busy: false, problem: ORG_WRITE_FAILED, where: 'rooms' })

    // Once it has landed, the next change goes out - and it starts from the reading it was given.
    answer = Promise.withResolvers<{ set: true }>()
    expect(changeRoomOrg('default', reading, archive, 'home')).toBe(true)
    expect(sent).toHaveLength(2)
    expect(useRoomOrgWrite.getState()).toMatchObject({ problem: null, where: null })

    // And this one was Home's, so the refusal is Home's: the room list and Home are both on screen at once, and
    // only the one the person acted on says anything.
    answer.reject(new Error('the daemon refused'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useRoomOrgWrite.getState()).toEqual({ busy: false, problem: ORG_WRITE_FAILED, where: 'home' })
  })

  it('sends nothing before the organisation has been read', () => {
    expect(changeRoomOrg('default', null, (org) => org, 'rooms')).toBe(false)
    expect(sent).toEqual([])
    expect(useRoomOrgWrite.getState().busy).toBe(false)
  })

  it('sends nothing outside the desktop app, where there is no bridge', () => {
    delete (globalThis as { window?: unknown }).window
    expect(changeRoomOrg('default', whole(), (org) => org, 'rooms')).toBe(false)
    expect(sent).toEqual([])
  })
})
