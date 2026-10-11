import { describe, expect, it } from 'vitest'
import type { Room } from '@shared/daemon'
import { byteSize, initialsOf, roomMoment, roomTime, sharedBy, shortAge, sortRooms } from './rooms'

const room = (title: string, updated_at?: string, last_message_at: string | null = null): Room => ({
  id: title,
  title,
  task_id: '',
  ...(updated_at ? { updated_at } : {}),
  last_message_at,
})

describe('the room list order', () => {
  it('puts the newest message first, and a room without messages by its last change', () => {
    const rooms = [
      room('old', '2026-09-10T10:00:00Z'),
      room('talked', '2026-09-01T10:00:00Z', '2026-09-18T09:00:00Z'),
      room('new', '2026-09-18T10:00:00Z'),
    ]
    expect(sortRooms(rooms).map((item) => item.title)).toEqual(['new', 'talked', 'old'])
  })

  it('puts a room without a readable moment last, and breaks ties by title', () => {
    const rooms = [room('b', 'not a date'), room('z', '2026-09-18T10:00:00Z'), room('a', '2026-09-18T10:00:00Z')]
    expect(sortRooms(rooms).map((item) => item.title)).toEqual(['a', 'z', 'b'])
    expect(roomMoment(room('none'))).toBeNull()
  })

  it('does not change the list it was given', () => {
    const rooms = [room('a', '2026-09-01T00:00:00Z'), room('b', '2026-09-02T00:00:00Z')]
    sortRooms(rooms)
    expect(rooms.map((item) => item.title)).toEqual(['a', 'b'])
  })
})

describe('short ages', () => {
  const now = Date.parse('2026-09-19T12:00:00Z')
  it.each([
    [now - 30_000, 'now'],
    [now + 60_000, 'now'],
    [now - 5 * 60_000, '5m'],
    [now - 9 * 3_600_000, '9h'],
    [now - 3 * 86_400_000, '3d'],
    [now - 15 * 86_400_000, '2w'],
  ])('%s reads %s', (ms, text) => {
    expect(shortAge(ms, now)).toBe(text)
  })

  it('gives a date after five weeks', () => {
    expect(shortAge(now - 60 * 86_400_000, now)).toMatch(/\d/)
  })
})

/** A moment on the test day, read in the machine's own time zone, as a room row's time is. */
const at = (hour: number, minute: number) => new Date(2026, 8, 19, hour, minute, 0).getTime()

describe("a room row's time, as Jam Desktop writes it", () => {
  // Late in the same day, so every moment below is behind it and still on it, wherever the machine stands.
  const now = at(23, 30)

  it.each([
    [now - 30_000, 'just now'],
    [now + 5_000, 'just now'],
    [at(0, 34), '12:34 am'],
    [at(9, 5), '09:05 am'],
    [at(11, 59), '11:59 am'],
    [at(12, 0), '12:00 pm'],
    [at(13, 31), '01:31 pm'],
  ])('%s reads %s', (ms, text) => {
    expect(roomTime(ms, now)).toBe(text)
  })

  it('falls back to the date before today, which Jam has not been seen writing', () => {
    expect(roomTime(new Date(2026, 8, 18, 23, 59).getTime(), now)).not.toMatch(/pm|am/)
    expect(roomTime(new Date(2026, 8, 18, 23, 59).getTime(), now)).toMatch(/\d/)
  })
})

describe('file details', () => {
  it.each([
    [192, '192 B'],
    [1834, '1.8 KB'],
    [48213, '47 KB'],
    [3.2 * 1024 * 1024, '3.2 MB'],
    [-1, ''],
    [Number.NaN, ''],
  ])('%s bytes read %s', (bytes, text) => {
    expect(byteSize(bytes)).toBe(text)
  })

  it('names who shared a file, as Jam does', () => {
    const file = { id: 'a', name: 'plan.md' }
    // The catalogue leaves the uploader unnamed for the account's own file, which Jam writes as "You".
    expect(sharedBy({ ...file, uploader_type: 'Local', uploader_name: null })).toBe('from You')
    expect(sharedBy({ ...file, uploader_name: 'Sam Rivera' })).toBe('from Sam Rivera')
    expect(sharedBy(file)).toBeNull()
  })
})

describe('initials', () => {
  it.each([
    ['Sam Rivera', 'SR'],
    ['sam-rivera', 'SR'],
    ['Ada', 'A'],
    ['Mary Ann Lee', 'ML'],
    ['', '?'],
    [null, '?'],
  ])('%s gives %s', (name, initials) => {
    expect(initialsOf(name)).toBe(initials)
  })
})
