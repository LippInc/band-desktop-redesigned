import { resolve, sep } from 'node:path'
import { APP_HOST, APP_SCHEME } from './app-url'

/** Maps an app:// request to a file inside rootDir. Returns null for other hosts, malformed URLs and path traversal. */
export function resolveAppPath(rootDir: string, requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const root = resolve(rootDir)
    const target = resolve(root, `.${pathname}`)
    return target.startsWith(root + sep) ? target : null
  } catch {
    return null
  }
}
