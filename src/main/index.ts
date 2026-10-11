import { join } from 'node:path'
import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import { APP_PRODUCT_NAME, APP_USER_MODEL_ID } from '@shared/app-identity'
import { nativeThemeSource } from '@shared/chrome'
import { BUILT_AGAINST } from '@shared/daemon'
import { IPC, type AppInfo, type DesktopPlatform } from '@shared/ipc-contract'
import type { Settings } from '@shared/settings'
import { openDatabase } from '../node/db'
import { APP_INDEX_URL, createAppUrlGuard } from './app-url'
import { DaemonClient } from './daemon/client'
import { resolveDaemonMode } from './daemon-mode'
import { registerIpc } from './ipc'
import { installAppMenu } from './menu'
import { registerAppProtocol, registerAppScheme } from './protocol'
import { hardenAllWebContents, hardenSession } from './security'
import { SETTINGS_MIGRATIONS } from './settings-schema'
import { SettingsStore } from './settings-store'
import { applyChrome, createMainWindow } from './window'

// Tests and verification runs of the unpackaged app use a throwaway profile. It must be set before the single-instance lock,
// which lives in userData. Packaged builds ignore the variable (use Chromium's --user-data-dir switch to point one elsewhere).
if (!app.isPackaged && process.env.JAMR_USER_DATA) app.setPath('userData', process.env.JAMR_USER_DATA)

registerAppScheme()
app.enableSandbox()

// electron-vite sets ELECTRON_RENDERER_URL while developing; built runs load the UI from app://.
const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
const isAppUrl = createAppUrlGuard(devServerUrl)
const daemonMode = resolveDaemonMode(app.isPackaged, process.env)

let mainWindow: BrowserWindow | null = null

const broadcast = (channel: string, payload: unknown) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  hardenAllWebContents(isAppUrl)
  // A startup failure (for example settings written by a newer version) must be shown, not leave a process with no window.
  void app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      dialog.showErrorBox(`${APP_PRODUCT_NAME} could not start`, error instanceof Error ? error.message : String(error))
      app.exit(1)
    })
}

function start(): void {
  if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID)
  const settingsDb = openDatabase(join(app.getPath('userData'), 'settings.db'), SETTINGS_MIGRATIONS)
  const settings = new SettingsStore(settingsDb)
  nativeTheme.themeSource = nativeThemeSource(settings.getAll().theme)

  hardenSession()
  registerAppProtocol(join(__dirname, '../renderer'))
  installAppMenu()

  // The Jam daemon: data comes only from its local API, called from here (README, "What this app never does").
  const daemon = new DaemonClient({
    endpoint: daemonMode.kind === 'fake' ? daemonMode.endpoint : undefined,
    discover: daemonMode.kind === 'none' ? () => [] : undefined,
    onStatus: (status) => broadcast(IPC.daemonStatusChanged, status),
    onEvent: (event) => broadcast(IPC.daemonEvent, event),
    log: (line) => console.warn(`[daemon] ${line}`),
  })
  if (daemonMode.kind === 'none') {
    console.warn('[daemon] unpackaged run without a daemon: use `pnpm dev` (fake daemon) or `pnpm dev:live`')
  }

  const appInfo: AppInfo = {
    name: APP_PRODUCT_NAME,
    version: app.getVersion(),
    platform: process.platform as DesktopPlatform,
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    builtAgainst: BUILT_AGAINST,
    fakeDaemon: daemonMode.kind === 'fake',
  }

  registerIpc({
    settings,
    daemon,
    appInfo,
    isAppUrl,
    onSettingsChanged: (next: Settings) => {
      nativeTheme.themeSource = nativeThemeSource(next.theme)
      // Dark to Jam leaves nativeTheme as it was, so no 'updated' comes: the window takes its colours here too.
      for (const win of BrowserWindow.getAllWindows()) applyChrome(win, next.theme)
      broadcast(IPC.settingsChanged, next)
    },
  })

  const openMainWindow = () => {
    mainWindow = createMainWindow({ settings, url: devServerUrl ?? APP_INDEX_URL })
    mainWindow.on('closed', () => {
      mainWindow = null
    })
  }
  openMainWindow()
  void daemon.start()

  nativeTheme.on('updated', () => {
    const { theme } = settings.getAll()
    for (const win of BrowserWindow.getAllWindows()) applyChrome(win, theme)
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('will-quit', () => {
    daemon.stop()
    settingsDb.close()
  })
}
