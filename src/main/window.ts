import { join } from 'node:path'
import { BrowserWindow, nativeTheme } from 'electron'
import { APP_PRODUCT_NAME } from '@shared/app-identity'
import { TITLE_BAR_HEIGHT, chromeColorsFor } from '@shared/chrome'
import { IPC } from '@shared/ipc-contract'
import type { ThemePreference } from '@shared/settings'
import { windowStateOf } from './ipc'
import type { SettingsStore } from './settings-store'
import { loadWindowState, trackWindowState } from './window-state'

const isMac = process.platform === 'darwin'

function chromeColors(theme: ThemePreference) {
  return chromeColorsFor(theme, nativeTheme.shouldUseDarkColors)
}

/** Keeps the native parts of the window (background, Windows caption buttons) in the theme. */
export function applyChrome(win: BrowserWindow, theme: ThemePreference): void {
  const colors = chromeColors(theme)
  win.setBackgroundColor(colors.surface)
  if (!isMac) win.setTitleBarOverlay({ color: colors.surface, symbolColor: colors.symbol, height: TITLE_BAR_HEIGHT })
}

export function createMainWindow({ settings, url }: { settings: SettingsStore; url: string }): BrowserWindow {
  const state = loadWindowState(settings)
  const colors = chromeColors(settings.getAll().theme)

  const win = new BrowserWindow({
    ...state.bounds,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: APP_PRODUCT_NAME,
    backgroundColor: colors.surface,
    // Hidden title bar: the UI draws its own 48px header. Windows and Linux keep native caption buttons through the overlay.
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 18, y: 17 } }
      : {
          titleBarOverlay: { color: colors.surface, symbolColor: colors.symbol, height: TITLE_BAR_HEIGHT },
          autoHideMenuBar: true,
        }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // On Windows and Linux, Electron's spellchecker downloads its dictionaries from Google's CDN; macOS uses its own.
      spellcheck: isMac,
    },
  })

  if (!isMac) win.setMenuBarVisibility(false)
  trackWindowState(win, settings)

  const sendState = () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.windowStateChanged, windowStateOf(win))
  }
  win.on('maximize', sendState)
  win.on('unmaximize', sendState)
  win.on('enter-full-screen', sendState)
  win.on('leave-full-screen', sendState)
  win.on('focus', sendState)
  win.on('blur', sendState)

  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize()
    win.show()
  })

  void win.loadURL(url)
  return win
}
