import type { Room, RoomFile } from '@shared/daemon'

/**
 * The moment a room's place in the list comes from (user guide, "Room order"): its newest message, and before its first
 * message the last change the daemon reports. Jam uses the room's creation there, which the room list does not carry, so
 * renaming a room without messages can move it here (docs/DESIGN.md, "Room list").
 */
export function roomMoment(room: Room): number | null {
  const at = room.last_message_at ?? room.updated_at
  if (!at) return null
  const ms = Date.parse(at)
  return Number.isNaN(ms) ? null : ms
}

/** Jam's order: the most recent room first; a room without a moment last; ties by title. */
export function sortRooms(rooms: readonly Room[]): Room[] {
  return rooms.toSorted((a, b) => {
    const byMoment = (roomMoment(b) ?? Number.NEGATIVE_INFINITY) - (roomMoment(a) ?? Number.NEGATIVE_INFINITY)
    return Number.isNaN(byMoment) || byMoment === 0 ? a.title.localeCompare(b.title) : byMoment
  })
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/** ZCode's short age beside a task ("9h", "3d"): now, minutes, hours, days, weeks, then the date. */
export function shortAge(ms: number, now: number = Date.now()): string {
  const age = now - ms
  if (age < MINUTE) return 'now'
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`
  if (age < DAY) return `${Math.floor(age / HOUR)}h`
  if (age < WEEK) return `${Math.floor(age / DAY)}d`
  if (age < 5 * WEEK) return `${Math.floor(age / WEEK)}w`
  return shortDate(new Date(ms), new Date(now))
}

/**
 * The time on a room's row, as Jam Desktop writes it: "just now" for the last minute, then the clock time of a moment
 * today ("12:34 am"). Jam's wording for an older moment has not been seen, so the date stands in there
 * (docs/jam/differences.md).
 */
export function roomTime(ms: number, now: number = Date.now()): string {
  if (now - ms < MINUTE) return 'just now'
  const at = new Date(ms)
  const today = new Date(now)
  const sameDay =
    at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate()
  if (!sameDay) return shortDate(at, today)
  // Jam pads the hour ("01:31 pm"), which a locale's own 12-hour format does not always do.
  const hour = at.getHours() % 12 || 12
  const minute = String(at.getMinutes()).padStart(2, '0')
  return `${String(hour).padStart(2, '0')}:${minute} ${at.getHours() < 12 ? 'am' : 'pm'}`
}

function shortDate(at: Date, today: Date): string {
  return at.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(at.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  })
}

/**
 * Who shared a file, as Jam Desktop names them ("from You · 9h · 192 B"). The catalogue carries the uploader's name for
 * someone else's file and leaves it empty for the account's own, which Jam writes as "You"; a file whose uploader it
 * does not name says nobody.
 */
export function sharedBy(file: RoomFile): string | null {
  if (file.uploader_name) return `from ${file.uploader_name}`
  return file.uploader_type === 'Local' ? 'from You' : null
}

/** A size as a person reads it: bytes up to 1 KB, then KB, MB and GB with one decimal below ten. */
export function byteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/** Up to two initials for an avatar, from a name or a handle; "?" when there is neither. */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').split(/[\s._-]+/).filter(Boolean)
  const letters = words.length > 1 ? [words[0], words.at(-1)] : words.slice(0, 1)
  return (
    letters
      .map((word) => [...(word ?? '')][0] ?? '')
      .join('')
      .toUpperCase() || '?'
  )
}
/** The head of a session's id, as Jam writes it beside the session's name. */
export function shortId(id: string): string {
  return id.split('-')[0] ?? id
}
