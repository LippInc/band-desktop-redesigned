import { app, session, shell, type Session, type WebContents } from 'electron'
import { isSafeExternalUrl } from '@shared/external-url'

/** The UI needs clipboard writes and nothing else; every other permission (camera, notifications, ...) is refused. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])

export function hardenSession(target: Session = session.defaultSession): void {
  target.setPermissionRequestHandler((_contents, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)))
  target.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission))
}

/** Applies to every web contents the app ever creates. Must be registered before the first window opens. */
export function hardenAllWebContents(isAppUrl: (url: string) => boolean): void {
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents, isAppUrl))
}

function hardenWebContents(contents: WebContents, isAppUrl: (url: string) => boolean): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // will-frame-navigate covers the main frame and every subframe; will-navigate would only see the main frame.
  contents.on('will-frame-navigate', (event) => {
    if (!isAppUrl(event.url)) event.preventDefault()
  })
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  void contents.setVisualZoomLevelLimits(1, 1)
}
