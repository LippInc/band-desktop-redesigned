import { create } from 'zustand'
import type { RoomOrg } from '@shared/daemon'
import { jam } from '@/lib/platform'
import { useDaemon, useShellPart } from '@/stores/daemon'
import { useSettings } from '@/stores/settings'

/**
 * The room organisation, and the one way this app changes it.
 *
 * `/v1/setRoomOrg` takes the whole organisation at once and the official Jam app shares it, so a change is made to
 * the organisation last read rather than to one built here, and only one change is ever in flight. That flag is kept
 * here, for the window and not for one control: Pin and Move to folder in a room's menu, New folder, a folder's fold
 * and Archive and Restore on Home all change the same organisation, so two of them started from one reading would
 * each send the whole of it and the later would undo the earlier. The list is read again afterwards, so what is on
 * screen is what Jam holds rather than what this app hoped for.
 */
/** Where the person acted: the room list in the sidebar, or Home. A refusal is said there and nowhere else. */
export type OrgPlace = 'rooms' | 'home'

interface OrgWrite {
  /** True while a change is on its way, which is what keeps a second change from starting from a stale reading. */
  busy: boolean
  problem: string | null
  /** Which place the refusal belongs to; both places are on screen at once, so only one of them says it. */
  where: OrgPlace | null
}

export const useRoomOrgWrite = create<OrgWrite>(() => ({ busy: false, problem: null, where: null }))

/** This app's own words: Jam was never seen to fail this write, so it has no wording of its own to copy. */
export const ORG_WRITE_FAILED = 'Band could not change how the rooms are organised.'

/**
 * Send one change to the organisation and read the room list back. Answers whether it was sent: nothing is sent while
 * another change is in flight, or before the organisation has been read, or outside the desktop app.
 *
 * A refusal is remembered with the place that asked, and it is cleared by the next change, whichever place makes it -
 * the same rule every other write in this app follows for what it says when one fails.
 */
export function changeRoomOrg(
  profile: string,
  org: RoomOrg | null,
  make: (org: RoomOrg) => RoomOrg,
  where: OrgPlace,
): boolean {
  const api = jam()
  if (!api || !org || useRoomOrgWrite.getState().busy) return false
  useRoomOrgWrite.setState({ busy: true, problem: null, where: null })
  api.daemon
    .setRoomOrg({ profile, org: make(org) })
    .then(() => useDaemon.getState().refresh(profile))
    .catch(() => useRoomOrgWrite.setState({ problem: ORG_WRITE_FAILED, where }))
    .finally(() => useRoomOrgWrite.setState({ busy: false }))
  return true
}

/** The refusal this place should say, or null: the place that did not ask says nothing. */
export const useOrgProblem = (where: OrgPlace): string | null =>
  useRoomOrgWrite((state) => (state.where === where ? state.problem : null))

export function useRoomOrg(where: OrgPlace): {
  org: RoomOrg | null
  busy: boolean
  problem: string | null
  change: (make: (org: RoomOrg) => RoomOrg) => void
} {
  const part = useShellPart('roomOrg')
  const profile = useSettings((state) => state.settings.profile)
  const busy = useRoomOrgWrite((state) => state.busy)
  const problem = useOrgProblem(where)
  const org = part.state === 'ready' ? part.data : null

  return {
    org,
    busy,
    problem,
    change: (make) => {
      changeRoomOrg(profile, org, make, where)
    },
  }
}
