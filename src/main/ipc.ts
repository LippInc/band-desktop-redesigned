import { BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { ROOM_ID } from '@shared/daemon'
import { DAEMON_OPERATION_NAMES } from '@shared/daemon-api'
import { isSafeExternalUrl } from '@shared/external-url'
import { daemonChannel, IPC, type AppInfo, type WindowState } from '@shared/ipc-contract'
import { PROFILE_PATTERN, type Settings } from '@shared/settings'
import type { DaemonClient } from './daemon/client'
import { actOnFile, verifyFile } from './files'
import { readGuide } from './guide'
import { choosePlanSource } from './plan'
import type { SettingsStore } from './settings-store'

/** An artifact id: with the account profile (PROFILE_PATTERN), the whole of what the page may say about a file. */
const ARTIFACT_ID = /^[A-Za-z0-9_-]{1,128}$/

function fileInput(raw: unknown): { profile: string; id: string; action: unknown } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('The input must be an object')
  const { profile, id, action } = raw as Record<string, unknown>
  if (typeof profile !== 'string' || !PROFILE_PATTERN.test(profile)) throw new Error('Unknown account profile')
  if (typeof id !== 'string' || !ARTIFACT_ID.test(id)) throw new Error('Unknown file')
  return { profile, id, action }
}

/** The room the page may set the plan of: a profile and a room id, and nothing else - no path ever comes from it. */
function planInput(raw: unknown): { profile: string; roomId: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('The input must be an object')
  const { profile, roomId } = raw as Record<string, unknown>
  if (typeof profile !== 'string' || !PROFILE_PATTERN.test(profile)) throw new Error('Unknown account profile')
  if (typeof roomId !== 'string' || !ROOM_ID.test(roomId)) throw new Error('Unknown room')
  return { profile, roomId }
}

interface IpcDependencies {
  settings: SettingsStore
  daemon: DaemonClient
  appInfo: AppInfo
  isAppUrl: (url: string) => boolean
  onSettingsChanged: (settings: Settings) => void
}

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

export function windowStateOf(win: BrowserWindow | null): WindowState {
  return {
    isMaximized: win?.isMaximized() ?? false,
    isFullScreen: win?.isFullScreen() ?? false,
    isFocused: win?.isFocused() ?? false,
  }
}

export function registerIpc({ settings, daemon, appInfo, isAppUrl, onSettingsChanged }: IpcDependencies): void {
  // Every handler refuses callers that are not our own UI (security checklist: validate the sender of all IPC messages).
  const handle = (channel: string, handler: Handler) => {
    ipcMain.handle(channel, (event, ...args) => {
      const url = event.senderFrame?.url ?? ''
      if (!isAppUrl(url)) throw new Error(`Refused ${channel} from an untrusted frame`)
      return handler(event, ...args)
    })
  }

  handle(IPC.appGetInfo, () => appInfo)

  // Jam's own guide, from the install beside the running daemon. The path stays in this process.
  handle(IPC.guideRead, async () => readGuide(await daemon.installPath()))

  // A room's files. The page names a file by its artifact id only; where it is stored is looked up here.
  handle(IPC.filesAct, async (_event, input) => {
    const { profile, id, action } = fileInput(input)
    if (action !== 'open' && action !== 'reveal') throw new Error('Unknown file action')
    return actOnFile(daemon, action, profile, id)
  })
  handle(IPC.filesVerify, async (_event, input) => {
    const { profile, id } = fileInput(input)
    return verifyFile(daemon, profile, id)
  })

  // A room's plan: the file is chosen in a dialog this process opens, and its path never crosses to the page.
  handle(IPC.planChoose, async (event, input) => {
    const { profile, roomId } = planInput(input)
    return choosePlanSource(daemon, BrowserWindow.fromWebContents(event.sender), profile, roomId)
  })

  handle(IPC.settingsGetAll, () => settings.getAll())

  handle(IPC.settingsUpdate, (_event, patch) => {
    const next = settings.update(patch)
    onSettingsChanged(next)
    return next
  })

  handle(IPC.windowGetState, (event) => windowStateOf(BrowserWindow.fromWebContents(event.sender)))

  handle(IPC.shellOpenExternal, async (_event, url) => {
    if (!isSafeExternalUrl(url)) throw new Error('Only https and mailto links can be opened')
    await shell.openExternal(url)
  })

  handle(IPC.daemonGetStatus, () => daemon.status())

  // The inbox the daemon's stream sent last, for the account asked about; the profile is checked as every operation's is.
  handle(IPC.daemonGetInbox, (_event, profile) => {
    if (typeof profile !== 'string' || !PROFILE_PATTERN.test(profile)) throw new Error('Unknown account profile')
    return daemon.inbox(profile)
  })

  handle(IPC.daemonReconnect, () => daemon.start())

  // One channel per named operation. The operation table (daemon/operations.ts) validates the input and the answer; a
  // name that is not in it has no channel, so the page cannot reach any other route.
  for (const name of DAEMON_OPERATION_NAMES) {
    handle(daemonChannel(name), (_event, input) => daemon.run(name, input))
  }
}
