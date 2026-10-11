import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { resolveAppPath } from './app-path'
import { APP_SCHEME } from './app-url'

/** Content security policy for everything served from app:// in built runs. Dev runs on the Vite server without it. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

/** Must run before the app is ready. Serving the UI from a privileged custom scheme instead of file:// follows Electron's security checklist. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true },
    },
  ])
}

/** Every app:// response carries these, including errors. */
const SECURITY_HEADERS = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
}

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  })

export function registerAppProtocol(rootDir: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const target = resolveAppPath(rootDir, request.url)
    if (!target) return notFound()
    const file = await net.fetch(pathToFileURL(target).toString()).catch(() => null)
    if (!file?.ok) return notFound()
    return new Response(file.body, {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        'Content-Type': MIME_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
      },
    })
  })
}
