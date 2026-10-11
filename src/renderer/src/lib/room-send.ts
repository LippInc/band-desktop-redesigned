import { storeStaged } from '@/lib/attachments'
import { jam } from '@/lib/platform'
import { useDaemon } from '@/stores/daemon'
import { useRoomStore } from '@/stores/room'

/**
 * Sends a message to a room, the one way this app does, from the room's composer and from Inbox's reply alike. With
 * `withFiles`, the files staged under `scope` are stored, bound to this room, when Send is pressed, and the ids the store
 * answers are what the message carries. Jam uploads them earlier ("Jam uploads room-bound files before it enables
 * Send"); storing them at Send means a file removed before sending never leaves this computer (docs/jam/differences.md).
 * A file that fails stops the send, and the composer keeps its draft and its files; a file already stored is not stored
 * again when the send is tried again. After it, the room and the shell are read at once; the daemon's events follow.
 */
export async function sendToRoom(
  profile: string,
  roomId: string,
  scope: string,
  message: { content: string; mentions: string[] },
  withFiles: boolean,
): Promise<void> {
  const api = jam()
  if (!api) throw new Error('This app is not connected to Band')
  const attachmentIds = withFiles
    ? await storeStaged(scope, (input) => api.daemon.fileStore(input), profile, roomId)
    : []
  await api.daemon.roomSend({ profile, roomId, ...message, ...(attachmentIds.length > 0 ? { attachmentIds } : {}) })
  void useRoomStore.getState().load(profile, roomId)
  void useDaemon.getState().refresh(profile)
}
