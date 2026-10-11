import type { JamApi } from '@shared/ipc-contract'

/**
 * The page's only door to the app: the renderer never touches Node or Electron, only this bridge (src/preload).
 * Outside the desktop app there is no bridge; the shell then renders with the daemon offline.
 */
export function jam(): JamApi | null {
  return typeof window !== 'undefined' && window.jam ? window.jam : null
}

export const isMac = () => jam()?.platform === 'darwin'

/** How a shortcut is written on this platform: Ctrl+K on Windows and Linux, ⌘K on macOS. */
export function shortcutLabel(keys: string): string {
  if (!isMac()) return keys
  return keys
    .replace(/Ctrl\+/g, '⌘')
    .replace(/Alt\+/g, '⌥')
    .replace(/Shift\+/g, '⇧')
}
