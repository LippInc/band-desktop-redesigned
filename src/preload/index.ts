import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { DAEMON_OPERATION_NAMES, type DaemonOperationsApi } from '@shared/daemon-api'
import { daemonChannel, IPC, type DesktopPlatform, type JamApi, type Unsubscribe } from '@shared/ipc-contract'

// Sandboxed preload: only the typed API below reaches the page. No Node or Electron objects are exposed.

function subscribe<T>(channel: string, listener: (payload: T) => void): Unsubscribe {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

// One function per named daemon operation, and nothing that takes a route.
const operations = Object.fromEntries(
  DAEMON_OPERATION_NAMES.map((name) => [name, (input?: unknown) => ipcRenderer.invoke(daemonChannel(name), input)]),
) as unknown as DaemonOperationsApi

const api: JamApi = {
  platform: process.platform as DesktopPlatform,
  app: {
    getInfo: () => ipcRenderer.invoke(IPC.appGetInfo),
  },
  settings: {
    getAll: () => ipcRenderer.invoke(IPC.settingsGetAll),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    onChange: (listener) => subscribe(IPC.settingsChanged, listener),
  },
  window: {
    getState: () => ipcRenderer.invoke(IPC.windowGetState),
    onStateChange: (listener) => subscribe(IPC.windowStateChanged, listener),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(IPC.shellOpenExternal, url),
  },
  guide: {
    read: () => ipcRenderer.invoke(IPC.guideRead),
  },
  files: {
    act: (input) => ipcRenderer.invoke(IPC.filesAct, input),
    verify: (input) => ipcRenderer.invoke(IPC.filesVerify, input),
  },
  plan: {
    choose: (input) => ipcRenderer.invoke(IPC.planChoose, input),
  },
  daemon: {
    ...operations,
    getStatus: () => ipcRenderer.invoke(IPC.daemonGetStatus),
    getInbox: (profile) => ipcRenderer.invoke(IPC.daemonGetInbox, profile),
    reconnect: () => ipcRenderer.invoke(IPC.daemonReconnect),
    onStatus: (listener) => subscribe(IPC.daemonStatusChanged, listener),
    onEvent: (listener) => subscribe(IPC.daemonEvent, listener),
  },
}

contextBridge.exposeInMainWorld('jam', api)
