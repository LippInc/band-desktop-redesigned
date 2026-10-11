import { BUILT_AGAINST, type InboxRead } from './daemon'
import type { GuideRead } from './guide'
import type { DaemonEvent, DaemonOperationName, DaemonOperationsApi, DaemonStatus } from './daemon-api'
import type { Settings, SettingsPatch } from './settings'

/** Every IPC channel name lives here. Main, preload and tests import it; nothing else spells a channel. */
export const IPC = {
  appGetInfo: 'app:get-info',
  settingsGetAll: 'settings:get-all',
  settingsUpdate: 'settings:update',
  settingsChanged: 'settings:changed',
  windowGetState: 'window:get-state',
  windowStateChanged: 'window:state-changed',
  shellOpenExternal: 'shell:open-external',
  guideRead: 'guide:read',
  filesAct: 'files:act',
  filesVerify: 'files:verify',
  planChoose: 'plan:choose',
  daemonGetStatus: 'daemon:get-status',
  daemonGetInbox: 'daemon:get-inbox',
  daemonReconnect: 'daemon:reconnect',
  daemonStatusChanged: 'daemon:status-changed',
  daemonEvent: 'daemon:event',
} as const

/** The channel of one named daemon operation. */
export const daemonChannel = (name: DaemonOperationName): string => `daemon:op:${name}`

/** What the app does with a room's file on this computer (Jam's own Open and Reveal). */
export type FileAction = 'open' | 'reveal'

/**
 * What became of it. `runnable`: the file would have been run rather than opened, so it was shown in the file manager
 * instead (`src/main/files.ts`). `missing`: this computer has no copy of it. `unavailable`: Jam did not answer, which
 * is not the same thing and is never reported as one. `elsewhere`: the file is not on this computer at all.
 * `unopenable`: the copy is here, and the system refused to open it - no program for this kind of file, or no
 * permission. Which of those it was stays in the main process, because the system says it in a sentence that can
 * name the path.
 */
export interface FileResult {
  done: boolean
  reason?: 'missing' | 'runnable' | 'unavailable' | 'elsewhere' | 'unopenable'
}

/**
 * What a checksum check found. `matches` and `differs` are the answer; `missing` is no local copy, `unknown` is a file
 * the daemon recorded no checksum for, `too-large` is one this app will not read in full, and `unavailable` is Jam not
 * answering - which is never reported as any of the others.
 */
export type FileVerdict = 'matches' | 'differs' | 'missing' | 'unknown' | 'too-large' | 'unavailable'

/**
 * What became of setting a room's plan from a file the person chose. The file is chosen in a dialog the main
 * process opens and its path stays there; the page asks by room and learns only this. `not-markdown`: what was
 * chosen is not a `.md` file, so nothing was sent. `elsewhere`: it is not a file on this computer. `missing`: it
 * was a path to a file this computer no longer has - not Jam refusing. `unavailable`: Jam did not take it.
 * `canceled`: the person closed the dialog, and nothing needs saying.
 */
export interface PlanChoiceResult {
  done: boolean
  reason?: 'canceled' | 'not-markdown' | 'elsewhere' | 'missing' | 'unavailable'
}

export type DesktopPlatform = 'win32' | 'darwin' | 'linux'
export type Platform = DesktopPlatform | 'web'

export interface AppInfo {
  /** The product name on this machine ("Jam Redesign"). */
  name: string
  version: string
  platform: Platform
  /** Runtime versions; null outside the desktop app. */
  versions: { electron: string; chrome: string; node: string } | null
  /** The daemon version and wire protocol this build was made against. */
  builtAgainst: typeof BUILT_AGAINST
  /** True when this run talks to the fake daemon (development and checks), never in a packaged build. */
  fakeDaemon: boolean
}

export interface WindowState {
  isMaximized: boolean
  isFullScreen: boolean
  isFocused: boolean
}

export type Unsubscribe = () => void

/**
 * The whole surface the renderer may use (`window.jam`). The Electron preload implements it over IPC; the page never
 * touches Node, Electron or the daemon directly.
 */
export interface JamApi {
  platform: Platform
  app: {
    getInfo(): Promise<AppInfo>
  }
  settings: {
    getAll(): Promise<Settings>
    update(patch: SettingsPatch): Promise<Settings>
    onChange(listener: (settings: Settings) => void): Unsubscribe
  }
  window: {
    getState(): Promise<WindowState>
    onStateChange(listener: (state: WindowState) => void): Unsubscribe
  }
  shell: {
    /** https and mailto only; anything else is refused in the main process. */
    openExternal(url: string): Promise<void>
  }
  guide: {
    /**
     * Jam's own user guide, read from the Jam install beside the running daemon. The text only: where it
     * was read from never crosses to the page.
     */
    read(): Promise<GuideRead>
  }
  files: {
    /**
     * Opens one of a room's files, or shows it in the file manager. A file is named by its artifact id: where it is
     * stored is looked up in the main process and never crosses to the page.
     */
    act(input: { profile: string; id: string; action: FileAction }): Promise<FileResult>
    /** Checks a room's file against the checksum the daemon recorded for it. */
    verify(input: { profile: string; id: string }): Promise<FileVerdict>
  }
  plan: {
    /**
     * Sets the room's plan from a Markdown file the person chooses. The dialog, the file's kind and its path all
     * stay in the main process; the page asks by room and learns only what became of it (`PlanChoiceResult`).
     */
    choose(input: { profile: string; roomId: string }): Promise<PlanChoiceResult>
  }
  daemon: DaemonOperationsApi & {
    getStatus(): Promise<DaemonStatus>
    /**
     * The account's latest inbox from the daemon's stream (what waits on the person: permission requests and questions),
     * `changed` when the last one did not fit its schema, or null until the daemon has sent one on this connection.
     */
    getInbox(profile: string): Promise<InboxRead | null>
    /** Looks for the daemon again now, instead of waiting for the next check. */
    reconnect(): Promise<DaemonStatus>
    onStatus(listener: (status: DaemonStatus) => void): Unsubscribe
    onEvent(listener: (event: DaemonEvent) => void): Unsubscribe
  }
}
