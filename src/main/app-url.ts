import { APP_HOST } from '@shared/app-identity'

export const APP_SCHEME = 'app'
export { APP_HOST }
export const APP_INDEX_URL = `${APP_SCHEME}://${APP_HOST}/index.html`

/**
 * Returns a predicate for "this URL is our own UI": the app:// protocol, plus the Vite dev server origin in development.
 * Used to gate navigation and every IPC call.
 */
export function createAppUrlGuard(devServerUrl?: string): (url: string) => boolean {
  const devOrigin = devServerUrl ? new URL(devServerUrl).origin : null
  return (raw) => {
    try {
      const url = new URL(raw)
      if (url.protocol === `${APP_SCHEME}:`) return url.host === APP_HOST
      return devOrigin !== null && url.origin === devOrigin
    } catch {
      return false
    }
  }
}
