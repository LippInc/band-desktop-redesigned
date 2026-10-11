// recording-room.mjs - which room `pnpm fixtures:record` may read the contents of: exactly one room with the recording room's
// title. Every other room is only listed (its id becomes an identity needle); with none or several such rooms, no room
// is read at all, so a second room that happens to share the name never has its messages or files read.

/** The one room titled `title`, or null when there is none or more than one. */
export function pickRecordingRoom(rooms, title) {
  if (!Array.isArray(rooms) || typeof title !== 'string' || !title) return null
  const matches = rooms.filter((room) => room && typeof room === 'object' && room.title === title)
  return matches.length === 1 && typeof matches[0].id === 'string' ? matches[0] : null
}
