import { describe, expect, it } from 'vitest'
import type { RoomFile, RoomFiles } from '@shared/daemon'
import { lastPage, shownFiles } from '@/components/room/room-panel'

/**
 * What the Files panel draws once Jam's "Load more files" has been pressed. Every room read answers page one, so the
 * pages after it are kept beside that read (`src/renderer/src/stores/room.ts`), and these two put the two together.
 */

const file = (id: string, name = `${id}.md`): RoomFile => ({ id, name })
const page = (files: RoomFile[], over: Partial<RoomFiles> = {}): RoomFiles =>
  ({ files, has_more: false, next_cursor: null, ...over }) as RoomFiles

describe('the files the panel lists', () => {
  it('is page one alone before Load more has been pressed', () => {
    expect(shownFiles(page([file('a'), file('b')]), []).map((one) => one.id)).toEqual(['a', 'b'])
  })

  it('adds each later page after the one before it', () => {
    const shown = shownFiles(page([file('a')]), [page([file('b')]), page([file('c')])])
    expect(shown.map((one) => one.id)).toEqual(['a', 'b', 'c'])
  })

  /**
   * The room re-reads on every daemon event, and that read answers page one - which by then may hold a file that
   * had already arrived on a later page. It is listed once, where it first appeared.
   */
  it('lists a file once when a re-read brings it back on page one', () => {
    const shown = shownFiles(page([file('a'), file('b')]), [page([file('b')]), page([file('c')])])
    expect(shown.map((one) => one.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps the first of two rows that share an id, not the last', () => {
    const shown = shownFiles(page([file('a', 'first.md')]), [page([file('a', 'second.md')])])
    expect(shown).toHaveLength(1)
    expect(shown[0]?.name).toBe('first.md')
  })

  it('shows nothing when there is nothing, rather than failing', () => {
    expect(shownFiles(page([]), [])).toEqual([])
    expect(shownFiles(page([]), [page([])])).toEqual([])
  })
})

describe('the page Load more asks from', () => {
  it('is page one until a later page has been read', () => {
    const one = page([file('a')], { has_more: true, next_cursor: 'c1' })
    expect(lastPage(one, []).next_cursor).toBe('c1')
  })

  it('is the newest page once there is one, so the cursor moves on', () => {
    const one = page([file('a')], { has_more: true, next_cursor: 'c1' })
    const two = page([file('b')], { has_more: true, next_cursor: 'c2' })
    expect(lastPage(one, [two]).next_cursor).toBe('c2')
    expect(lastPage(one, [two, page([file('c')])]).next_cursor).toBeNull()
  })

  it('reports the last page as having no more, which is what takes the control away', () => {
    const one = page([file('a')], { has_more: true, next_cursor: 'c1' })
    expect(lastPage(one, [page([file('b')])]).has_more).toBe(false)
  })
})
