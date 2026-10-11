/// <reference types="vite/client" />
import type { JamApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    /** The preload bridge; absent when the page runs outside the desktop app. */
    jam?: JamApi
  }
}
