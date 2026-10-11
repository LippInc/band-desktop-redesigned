import { create } from 'zustand'

/** The tabs of a room's right panel, in the side pane (user guide: "the right panel for participants and files"). */
export const ROOM_PANELS = ['participants', 'files', 'plan'] as const
export type RoomPanel = (typeof ROOM_PANELS)[number]

interface UiState {
  paletteOpen: boolean
  setPaletteOpen(open: boolean): void
  /** Which tab a room's right panel shows. */
  roomPanel: RoomPanel
  setRoomPanel(panel: RoomPanel): void
  /**
   * On a narrow window, whether the sidebar's drawer is open. Choosing a room leaves it open, with the room behind it,
   * until Hide rooms, the backdrop or Escape closes it (user guide: "Select a room, then close the drawer with Hide rooms
   * or the backdrop"); a wide window closes it.
   */
  drawerOpen: boolean
  setDrawerOpen(open: boolean): void
  /** The sidebar's room sections folded, by title: kept here, as the sidebar moves in the page when the window narrows. */
  foldedSections: readonly string[]
  toggleSection(title: string): void
  /**
   * The moment of the plan each room was last showing, by room. The room's header marks a plan that has changed since
   * with Jam Desktop's dot; a room's first read sets it, so the dot means "changed while you were here".
   */
  planSeen: Record<string, number>
  markPlanSeen(roomId: string, at: number): void
  /** Whether Find in conversation is open in the room on screen (Ctrl/Cmd+F; it closes with the room). */
  findOpen: boolean
  setFindOpen(open: boolean): void
  /** How many times Find has been asked for: pressing its shortcut again puts the caret back in the field. */
  findAsked: number
  askFind(): void
}

/** Interface state that is not a setting and not daemon data. */
export const useUi = create<UiState>((set) => ({
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  roomPanel: 'participants',
  setRoomPanel: (roomPanel) => set({ roomPanel }),
  drawerOpen: false,
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  planSeen: {},
  markPlanSeen: (roomId, at) => set((state) => ({ planSeen: { ...state.planSeen, [roomId]: at } })),
  findOpen: false,
  setFindOpen: (findOpen) => set({ findOpen }),
  findAsked: 0,
  askFind: () => set((state) => ({ findOpen: true, findAsked: state.findAsked + 1 })),
  foldedSections: [],
  toggleSection: (title) =>
    set(({ foldedSections }) => ({
      foldedSections: foldedSections.includes(title)
        ? foldedSections.filter((folded) => folded !== title)
        : [...foldedSections, title],
    })),
}))
