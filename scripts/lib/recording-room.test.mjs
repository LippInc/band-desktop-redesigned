import { describe, expect, it } from 'vitest'
import { pickRecordingRoom } from './recording-room.mjs'

const room = (id, title) => ({ id, title, task_id: '', updated_at: 'x', last_message_at: null })

describe('pickRecordingRoom', () => {
  it('picks the one room with the recording title', () => {
    const rooms = [room('a', 'Release notes'), room('b', 'recording-room')]
    expect(pickRecordingRoom(rooms, 'recording-room')).toEqual(rooms[1])
  })

  it.each([
    ['no room has the title', [room('a', 'Release notes')]],
    ['two rooms share it', [room('a', 'recording-room'), room('b', 'recording-room')]],
    ['the match has no id', [{ title: 'recording-room' }]],
    ['the list is empty', []],
    ['there is no list', undefined],
  ])('reads no room when %s', (_label, rooms) => {
    expect(pickRecordingRoom(rooms, 'recording-room')).toBeNull()
  })

  it('never matches a room by an empty title', () => {
    expect(pickRecordingRoom([room('a', '')], '')).toBeNull()
  })
})
