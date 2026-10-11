import { describe, expect, it } from 'vitest'
import type { RoomHistoryPage, RoomMessage } from '@shared/daemon'
import { mergePages, readWholeConversation, withEarlier } from '@/lib/history'

const message = (id: string, at: string): RoomMessage => ({
  id,
  message_type: 'text',
  content: id,
  cut: false,
  sender_id: null,
  sender_name: null,
  sender_type: null,
  inserted_at: at,
  mention_names: {},
  tool_name: null,
  system_event: null,
  attachments: 0,
})

const page = (messages: RoomMessage[], hasMore: boolean | null, totalPages: number | null = null): RoomHistoryPage => ({
  messages,
  unreadable: 0,
  hasMore,
  totalPages,
})

describe('reading a conversation past the snapshot', () => {
  // Page 1 is the newest (docs/jam/routes.md), so the pages come back in the reverse of the order they are read in.
  it('puts the pages back in the order the conversation was said in', () => {
    const newest = [message('d', '4'), message('e', '5')]
    const older = [message('b', '2'), message('c', '3')]
    const oldest = [message('a', '1')]
    expect(mergePages([newest, older, oldest]).map((one) => one.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(mergePages([])).toEqual([])
    expect(mergePages([[]])).toEqual([])
  })

  // A message sent while the pages are being read shifts them, so one message can come back on two pages.
  it('keeps a message that came back on two pages once, at its oldest place', () => {
    const first = [message('c', '3'), message('d', '4')]
    const second = [message('a', '1'), message('b', '2'), message('c', '3')]
    expect(mergePages([first, second]).map((one) => one.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('reads on until the daemon says there is no more, and counts what it could not read', async () => {
    const pages = [page([message('c', '3')], true), page([message('b', '2')], true), page([message('a', '1')], false)]
    const asked: number[] = []
    const whole = await readWholeConversation(async (at) => {
      asked.push(at)
      return { ...(pages[at - 1] as RoomHistoryPage), unreadable: 1 }
    })
    expect(asked).toEqual([1, 2, 3])
    expect(whole.messages.map((one) => one.id)).toEqual(['a', 'b', 'c'])
    expect(whole).toMatchObject({ stopped: 'end', pages: 3, unreadable: 3 })
  })

  it('stops at the page it is given, and says the conversation was not read whole', async () => {
    const whole = await readWholeConversation(async (at) => page([message(`m${at}`, `${at}`)], true), 3)
    expect(whole.messages.map((one) => one.id)).toEqual(['m3', 'm2', 'm1'])
    expect(whole).toMatchObject({ stopped: 'bound', pages: 3 })
  })

  it('reads one page for a conversation that fits in it', async () => {
    const whole = await readWholeConversation(async () => page([message('a', '1')], false))
    expect(whole).toMatchObject({ stopped: 'end', pages: 1 })
  })

  // A missing answer is not an empty one: a daemon that stops saying whether there is more has not said there is none.
  it('never calls a conversation read whole on a daemon that did not say', async () => {
    const quiet = await readWholeConversation(async () => page([message('a', '1')], null))
    expect(quiet).toMatchObject({ stopped: 'silent', pages: 1 })
    // The page count answers it when `has_more` does not.
    const counted = await readWholeConversation(async (at) => page([message(`m${at}`, `${at}`)], null, 2))
    expect(counted).toMatchObject({ stopped: 'end', pages: 2 })
    expect(counted.messages.map((one) => one.id)).toEqual(['m2', 'm1'])
  })

  // A page that cannot be read leaves the pages before it worth keeping: the next attempt starts a shorter way off.
  it('keeps the pages it read when one of them fails', async () => {
    const whole = await readWholeConversation(async (at) => {
      if (at === 3) throw new Error('the daemon refused')
      return page([message(`m${at}`, `${at}`)], true)
    })
    expect(whole).toMatchObject({ stopped: 'error', pages: 2 })
    expect(whole.messages.map((one) => one.id)).toEqual(['m2', 'm1'])
    expect((whole.error as Error)?.message).toBe('the daemon refused')
    // The very first page failing leaves nothing read, and says so.
    const none = await readWholeConversation(async () => {
      throw new Error('away')
    })
    expect(none).toMatchObject({ stopped: 'error', pages: 0, messages: [] })
  })

  // What was read before the snapshot stays on screen when the room is read again, and neither is shown twice.
  it('puts what was read earlier before the snapshot, each message once', () => {
    const earlier = [message('a', '1'), message('b', '2'), message('c', '3')]
    const snapshot = [message('c', '3'), message('d', '4')]
    expect(withEarlier(earlier, snapshot).map((one) => one.id)).toEqual(['a', 'b', 'c', 'd'])
    // A message said while the pages were being read belongs where the snapshot puts it, not at the head of the room.
    const during = [...earlier, message('z', '9')]
    expect(withEarlier(during, snapshot).map((one) => one.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(withEarlier([], snapshot).map((one) => one.id)).toEqual(['c', 'd'])
    expect(withEarlier(earlier, []).map((one) => one.id)).toEqual(['a', 'b', 'c'])
  })
})
