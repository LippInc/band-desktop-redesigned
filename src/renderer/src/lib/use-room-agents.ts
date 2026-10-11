import { useMemo } from 'react'
import type { Room } from '@shared/daemon'
import { roomAgents, type RoomAgent } from '@/lib/room-agents'
import { useDaemon, useShellPart } from '@/stores/daemon'
import { useRoomData } from '@/stores/room'

/** An open room's agents as the room page and its side pane show them (roomAgents), from what has been read so far. */
export function useRoomAgents(room: Room | null): RoomAgent[] {
  const data = useRoomData(room)
  const inbox = useDaemon((state) => state.inbox)
  const agentList = useShellPart('agents')
  return useMemo(
    () =>
      room
        ? roomAgents({
            roomId: room.id,
            participants: data.participants.state === 'ready' ? data.participants.data : [],
            agents: agentList.state === 'ready' ? agentList.data.rows : [],
            sessions: data.sessions.state === 'ready' ? data.sessions.data : {},
            messages: data.messages.state === 'ready' ? data.messages.data.messages : [],
            inbox,
          })
        : [],
    [room, data.participants, data.sessions, data.messages, agentList, inbox],
  )
}
