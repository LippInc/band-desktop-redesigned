import { useSettings } from '@/stores/settings'
import { useUi, type RoomPanel } from '@/stores/ui'

/** Shows one tab of the open room's right panel, opening the side pane if it is folded. */
export function showRoomPanel(panel: RoomPanel): void {
  useUi.getState().setRoomPanel(panel)
  const { settings, update } = useSettings.getState()
  if (!settings.sidePaneOpen) void update({ sidePaneOpen: true })
}

/**
 * The room header's buttons, which show a tab of the right panel and hide it again, as Jam Desktop's "Show
 * participants" turns into "Hide participants" while that panel is showing.
 */
export function toggleRoomPanel(panel: RoomPanel): void {
  const { settings, update } = useSettings.getState()
  if (settings.sidePaneOpen && useUi.getState().roomPanel === panel) {
    void update({ sidePaneOpen: false })
    return
  }
  showRoomPanel(panel)
}
