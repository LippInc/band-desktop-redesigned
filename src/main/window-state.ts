import { screen, type BrowserWindow, type Rectangle } from 'electron'
import type { SettingsStore } from './settings-store'

const STATE_KEY = 'internal.windowState'
const DEFAULT_SIZE = { width: 1280, height: 820 }

export interface PersistedWindowState {
  bounds: Rectangle
  maximized: boolean
}

export function loadWindowState(store: SettingsStore): PersistedWindowState {
  const saved = store.getInternal<PersistedWindowState>(STATE_KEY)
  if (saved && isUsableRect(saved.bounds) && isOnSomeDisplay(saved.bounds)) {
    return { bounds: saved.bounds, maximized: saved.maximized === true }
  }
  const { workArea } = screen.getPrimaryDisplay()
  const width = Math.min(DEFAULT_SIZE.width, workArea.width)
  const height = Math.min(DEFAULT_SIZE.height, workArea.height)
  return {
    bounds: {
      width,
      height,
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + (workArea.height - height) / 2),
    },
    maximized: false,
  }
}

/** Saves the restore bounds and maximized flag while the window lives, so a crash still reopens where it was. */
export function trackWindowState(win: BrowserWindow, store: SettingsStore): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = () => {
    if (win.isDestroyed()) return
    store.setInternal(STATE_KEY, {
      bounds: win.getNormalBounds(),
      maximized: win.isMaximized(),
    } satisfies PersistedWindowState)
  }
  const saveSoon = () => {
    clearTimeout(timer)
    timer = setTimeout(save, 400)
  }
  win.on('resize', saveSoon)
  win.on('move', saveSoon)
  win.on('maximize', save)
  win.on('unmaximize', save)
  win.on('close', () => {
    clearTimeout(timer)
    save()
  })
}

function isUsableRect(rect: unknown): rect is Rectangle {
  if (typeof rect !== 'object' || rect === null) return false
  const { x, y, width, height } = rect as Record<string, unknown>
  return (
    [x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    (width as number) >= 400 &&
    (height as number) >= 300
  )
}

/** A window counts as reachable when its title bar sits at least partly inside some display's work area. */
function isOnSomeDisplay(rect: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: area }) => {
    const overlapsHorizontally = rect.x < area.x + area.width - 100 && rect.x + rect.width > area.x + 100
    const titleBarVisible = rect.y >= area.y - 8 && rect.y < area.y + area.height - 48
    return overlapsHorizontally && titleBarVisible
  })
}
