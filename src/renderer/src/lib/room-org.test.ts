import { describe, expect, it } from 'vitest'
import { RoomOrgSchema, type Room, type RoomOrg } from '@shared/daemon'
import {
  archivedCount,
  collapsedIds,
  foldersOf,
  folderIdOf,
  groupRooms,
  homeRooms,
  isArchived,
  isCollapsed,
  isPinned,
  pinnedIds,
  withArchived,
  withCollapsed,
  withFolder,
  withNewFolder,
  withoutFolder,
  withPinned,
} from '@/lib/room-org'

const org = (over: Partial<RoomOrg> = {}): RoomOrg =>
  ({ folders: [], assignments: {}, pinned: [], collapsed: [], archived: {}, ...over }) as RoomOrg

const room = (id: string, at: string): Room => ({ id, title: id, last_message_at: at }) as Room

const a = room('a', '2026-09-21T10:00:00Z')
const b = room('b', '2026-09-21T09:00:00Z')
const c = room('c', '2026-09-21T08:00:00Z')

/**
 * The organisation is written back whole to a route the official Jam app shares, so the schema itself must not narrow
 * it on the way in: anything dropped here would be dropped from Jam's own organisation on the next write.
 */
describe('reading the answer keeps what this app does not understand', () => {
  it('keeps an unknown key of the organisation, and an unknown field inside a folder', () => {
    const parsed = RoomOrgSchema.parse({
      org: {
        folders: [{ id: 'f1', name: 'Work', colour: 'green' }],
        assignments: {},
        pinned: [],
        collapsed: [],
        archived: {},
        somethingJamKeeps: { and: 'this app does not read' },
      },
    }).org
    expect((parsed as unknown as Record<string, unknown>).somethingJamKeeps).toEqual({ and: 'this app does not read' })
    expect(parsed.folders[0]).toEqual({ id: 'f1', name: 'Work', colour: 'green' })
  })

  it('still refuses an answer that is not an organisation at all', () => {
    expect(() => RoomOrgSchema.parse({ org: { folders: [], assignments: {}, pinned: [], collapsed: [] } })).toThrow()
    expect(() => RoomOrgSchema.parse({ org: 'nothing like one' })).toThrow()
  })
})

describe('what the organisation says', () => {
  it('reads the folders it can, and leaves out one it cannot', () => {
    const one = org({ folders: [{ id: 'f1', name: 'Work' }, { id: 'f2' }, 'nonsense'] })
    expect(foldersOf(one).map((folder) => folder.id)).toEqual(['f1'])
  })

  it('reads only the ids out of the lists', () => {
    const one = org({ pinned: ['a', 7, null], collapsed: ['f1', {}] })
    expect(pinnedIds(one)).toEqual(['a'])
    expect(collapsedIds(one)).toEqual(['f1'])
    expect(isPinned(one, 'a')).toBe(true)
    expect(isPinned(one, 'b')).toBe(false)
    expect(isCollapsed(one, 'f1')).toBe(true)
  })

  it('reads which folder a room is in, and says null when it cannot', () => {
    const one = org({ assignments: { a: 'f1', b: 3 } })
    expect(folderIdOf(one, 'a')).toBe('f1')
    expect(folderIdOf(one, 'b')).toBeNull()
    expect(folderIdOf(one, 'zz')).toBeNull()
  })

  /** The daemon keeps a number here, not a yes or no, and what it counts is unknown: any number reads as archived. */
  it('treats any number as archived, and nothing else', () => {
    const one = org({ archived: { a: 0, b: 1758000000, c: true } })
    expect(isArchived(one, 'a')).toBe(true)
    expect(isArchived(one, 'b')).toBe(true)
    expect(isArchived(one, 'c')).toBe(false)
    expect(isArchived(one, 'zz')).toBe(false)
  })
})

describe('how the list is grouped', () => {
  it('puts the pinned in their own band, newest first', () => {
    const groups = groupRooms([a, b, c], org({ pinned: ['c', 'b'] }))
    expect(groups.pinned.map((one) => one.id)).toEqual(['b', 'c'])
    expect(groups.loose.map((one) => one.id)).toEqual(['a'])
  })

  it('keeps a room in one band only: pinned wins over a folder', () => {
    const one = org({ folders: [{ id: 'f1', name: 'Work' }], assignments: { a: 'f1' }, pinned: ['a'] })
    const groups = groupRooms([a, b], one)
    expect(groups.pinned.map((room) => room.id)).toEqual(['a'])
    expect(groups.folders[0]?.rooms).toEqual([])
  })

  it('lists a folder’s rooms newest first, because filing does not reorder them', () => {
    const one = org({ folders: [{ id: 'f1', name: 'Work' }], assignments: { c: 'f1', a: 'f1' } })
    const groups = groupRooms([c, a, b], one)
    expect(groups.folders[0]?.rooms.map((room) => room.id)).toEqual(['a', 'c'])
    expect(groups.loose.map((room) => room.id)).toEqual(['b'])
  })

  it('carries whether each folder is folded shut', () => {
    const one = org({ folders: [{ id: 'f1', name: 'Work' }], collapsed: ['f1'] })
    expect(groupRooms([a], one).folders[0]?.collapsed).toBe(true)
  })

  it('shows every room when there is no organisation at all', () => {
    const groups = groupRooms([a, b], org())
    expect(groups.pinned).toEqual([])
    expect(groups.folders).toEqual([])
    expect(groups.loose.map((room) => room.id)).toEqual(['a', 'b'])
  })
})

describe('what Home lists', () => {
  it('hides the archived until Show archived is on', () => {
    const one = org({ archived: { b: 1 } })
    expect(homeRooms([a, b], one, false).map((room) => room.id)).toEqual(['a'])
    expect(homeRooms([a, b], one, true).map((room) => room.id)).toEqual(['a', 'b'])
    expect(archivedCount([a, b], one)).toBe(1)
    expect(archivedCount([a], one)).toBe(0)
  })
})

/**
 * The organisation is shared with the official Jam app and is written back whole, so a change must carry across
 * every key and every entry it did not touch. These are the tests that say so.
 */
describe('changing it never loses what it did not touch', () => {
  const rich = {
    folders: [{ id: 'f1', name: 'Work', colour: 'green' }],
    assignments: { a: 'f1' },
    pinned: ['b'],
    collapsed: ['f1'],
    archived: { c: 1758000000 },
    somethingJamKeeps: { and: 'this app does not read' },
  } as unknown as RoomOrg

  const keptEverythingElse = (next: RoomOrg, changed: keyof RoomOrg | 'somethingJamKeeps') => {
    for (const key of Object.keys(rich) as (keyof typeof rich)[]) {
      if (key === changed) continue
      expect(next[key as keyof RoomOrg]).toEqual(rich[key])
    }
  }

  it('keeps a key it does not read, and a field inside a folder it does not read', () => {
    const next = withPinned(rich, 'a', true)
    expect((next as unknown as Record<string, unknown>).somethingJamKeeps).toEqual({ and: 'this app does not read' })
    expect(foldersOf(next)[0]).toMatchObject({ id: 'f1', name: 'Work', colour: 'green' })
  })

  it('pins and unpins without touching anything else', () => {
    const on = withPinned(rich, 'a', true)
    expect(pinnedIds(on)).toEqual(['b', 'a'])
    keptEverythingElse(on, 'pinned')
    const off = withPinned(on, 'a', false)
    expect(pinnedIds(off)).toEqual(['b'])
  })

  it('pins a room once, however many times it is asked', () => {
    expect(pinnedIds(withPinned(withPinned(rich, 'a', true), 'a', true))).toEqual(['b', 'a'])
  })

  it('files a room and takes it out again', () => {
    const filed = withFolder(rich, 'b', 'f1')
    expect(folderIdOf(filed, 'b')).toBe('f1')
    keptEverythingElse(filed, 'assignments')
    expect(folderIdOf(withFolder(filed, 'b', null), 'b')).toBeNull()
    expect(folderIdOf(withFolder(filed, 'a', null), 'a')).toBeNull()
  })

  it('folds a folder shut and open', () => {
    const open = withCollapsed(rich, 'f1', false)
    expect(collapsedIds(open)).toEqual([])
    keptEverythingElse(open, 'collapsed')
    expect(collapsedIds(withCollapsed(open, 'f1', true))).toEqual(['f1'])
  })

  it('archives with a number and restores by taking the entry away', () => {
    const on = withArchived(rich, 'a', true, 1_758_400_000_000)
    expect((on.archived as Record<string, unknown>).a).toBe(1_758_400_000)
    expect(isArchived(on, 'a')).toBe(true)
    keptEverythingElse(on, 'archived')
    const off = withArchived(on, 'a', false)
    expect('a' in (off.archived as Record<string, unknown>)).toBe(false)
    // The one that was already archived is untouched by another room's change.
    expect(isArchived(off, 'c')).toBe(true)
  })

  it('adds a folder last, and keeps the ones already there whole', () => {
    const { org: next, folder } = withNewFolder(rich, 'Later', 'f2')
    expect(folder).toEqual({ id: 'f2', name: 'Later' })
    expect(foldersOf(next).map((one) => one.id)).toEqual(['f1', 'f2'])
    expect(foldersOf(next)[0]).toMatchObject({ colour: 'green' })
    keptEverythingElse(next, 'folders')
  })

  it('removes a folder, and lets the rooms in it fall back into the list', () => {
    const next = withoutFolder(rich, 'f1')
    expect(foldersOf(next)).toEqual([])
    expect(folderIdOf(next, 'a')).toBeNull()
    expect(collapsedIds(next)).toEqual([])
    expect(pinnedIds(next)).toEqual(['b'])
    expect(isArchived(next, 'c')).toBe(true)
  })
})
