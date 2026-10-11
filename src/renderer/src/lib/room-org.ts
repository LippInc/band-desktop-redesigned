import { RoomFolderSchema, readEach, type Room, type RoomFolder, type RoomOrg } from '@shared/daemon'
import { sortRooms } from '@/lib/rooms'

/**
 * How the rooms are organised: which are pinned, which folder each is in, which folders are folded shut, and which
 * rooms are archived. Jam's own rules for all of it (its user guide, "Organize the room list" and "Home"):
 *
 * - "Use **Pin** to keep a room near the top." Pinned rooms "keep their own bands at the top of the list".
 * - "Use **Move to folder** or drag the room into a folder to organize the list. Filing a room does not change how it
 *   is ordered: rooms inside a folder are still listed newest message first."
 * - "Use **Archive room** to hide a room from Home on this device. Archiving does not delete the Band room or change
 *   it for other participants." "Use **Show archived** and **Restore** to return it to the list." Archiving is a Home
 *   thing: it hides a room from Home, and leaves the Rooms section alone.
 *
 * The organisation itself is **shared with the official Jam app** and is written back whole, so every function here
 * that changes it starts from the object the daemon sent and touches one member of it. Nothing is rebuilt, and
 * anything in it this app does not read travels back untouched (`RoomOrgSchema` says why).
 */

/** The folders, in the order the organisation lists them. One this app cannot read is left out rather than guessed. */
export function foldersOf(org: RoomOrg): RoomFolder[] {
  return readEach(RoomFolderSchema, org.folders).items
}

const idsOf = (list: readonly unknown[]): string[] => list.filter((one): one is string => typeof one === 'string')

export const pinnedIds = (org: RoomOrg): string[] => idsOf(org.pinned)
export const collapsedIds = (org: RoomOrg): string[] => idsOf(org.collapsed)

export const isPinned = (org: RoomOrg, roomId: string): boolean => pinnedIds(org).includes(roomId)
export const isCollapsed = (org: RoomOrg, folderId: string): boolean => collapsedIds(org).includes(folderId)

/** Which folder a room is filed in, or null when it is in none this app can read. */
export function folderIdOf(org: RoomOrg, roomId: string): string | null {
  const value = org.assignments[roomId]
  return typeof value === 'string' ? value : null
}

/**
 * Whether a room is archived. The daemon keeps a number here rather than a yes or no, and what the number counts is
 * not known, so any number at all reads as archived and nothing reads a meaning into it.
 */
export function isArchived(org: RoomOrg, roomId: string): boolean {
  return typeof org.archived[roomId] === 'number'
}

/** How the Rooms list is grouped: the pinned band first, then each folder, then everything else. */
export interface RoomGroups {
  pinned: Room[]
  folders: { folder: RoomFolder; rooms: Room[]; collapsed: boolean }[]
  loose: Room[]
}

/**
 * The rooms grouped for the list. Order inside every band is the list's own order - newest message first - because
 * filing a room does not change how it is ordered. A room is in one band only: pinned wins over a folder.
 */
export function groupRooms(rooms: readonly Room[], org: RoomOrg): RoomGroups {
  const sorted = sortRooms(rooms)
  const pins = new Set(pinnedIds(org))
  const pinned = sorted.filter((room) => pins.has(room.id))
  const rest = sorted.filter((room) => !pins.has(room.id))
  const folders = foldersOf(org).map((folder) => ({
    folder,
    rooms: rest.filter((room) => folderIdOf(org, room.id) === folder.id),
    collapsed: isCollapsed(org, folder.id),
  }))
  const filed = new Set(folders.flatMap((one) => one.rooms.map((room) => room.id)))
  return { pinned, folders, loose: rest.filter((room) => !filed.has(room.id)) }
}

/** The rooms Home lists: the archived ones are hidden until Show archived is on. */
export function homeRooms(rooms: readonly Room[], org: RoomOrg, showArchived: boolean): Room[] {
  return showArchived ? [...rooms] : rooms.filter((room) => !isArchived(org, room.id))
}

/** How many of these rooms are archived, which is what Home's Show archived offers to reveal. */
export const archivedCount = (rooms: readonly Room[], org: RoomOrg): number =>
  rooms.filter((room) => isArchived(org, room.id)).length

// Every change below returns a NEW organisation built from the one given, with one member replaced. Every other key
// of the object - including any this app does not read - is carried across by the spread.

export function withPinned(org: RoomOrg, roomId: string, on: boolean): RoomOrg {
  const without = org.pinned.filter((one) => one !== roomId)
  return { ...org, pinned: on ? [...without, roomId] : without }
}

/** Files a room in a folder, or takes it out of every folder when the folder is null. */
export function withFolder(org: RoomOrg, roomId: string, folderId: string | null): RoomOrg {
  const assignments = { ...org.assignments }
  if (folderId === null) delete assignments[roomId]
  else assignments[roomId] = folderId
  return { ...org, assignments }
}

export function withCollapsed(org: RoomOrg, folderId: string, on: boolean): RoomOrg {
  const without = org.collapsed.filter((one) => one !== folderId)
  return { ...org, collapsed: on ? [...without, folderId] : without }
}

/**
 * Archives a room, or restores it. The daemon wants a number, so the second the room was archived is what goes in:
 * it is the one number this app can defend writing, and nothing is read back out of it.
 */
export function withArchived(org: RoomOrg, roomId: string, on: boolean, now: number = Date.now()): RoomOrg {
  const archived = { ...org.archived }
  if (on) archived[roomId] = Math.floor(now / 1000)
  else delete archived[roomId]
  return { ...org, archived }
}

/** A new folder, with the id the organisation will know it by. The folder is added last, as Jam lists them in order. */
export function withNewFolder(org: RoomOrg, name: string, id: string): { org: RoomOrg; folder: RoomFolder } {
  const folder: RoomFolder = { id, name }
  return { org: { ...org, folders: [...org.folders, folder] }, folder }
}

/** Takes a folder away and lets every room that was in it fall back into the list. */
export function withoutFolder(org: RoomOrg, folderId: string): RoomOrg {
  const assignments = Object.fromEntries(
    Object.entries(org.assignments).filter(([, value]) => value !== folderId),
  ) as RoomOrg['assignments']
  return {
    ...org,
    folders: org.folders.filter(
      (one) => !(typeof one === 'object' && one !== null && 'id' in one && one.id === folderId),
    ),
    assignments,
    collapsed: org.collapsed.filter((one) => one !== folderId),
  }
}

/** A folder's name, as a person types one. */
export const FOLDER_NAME_MAX = 100
