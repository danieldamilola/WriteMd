import { shell } from 'electron'
import log from 'electron-log'
import { isAllowedExternalProtocol } from './path-guard'

/**
 * Navigation, window-open and permission guards for every window we create.
 *
 * The preload is bound to a `webContents`, not to an origin, so any document
 * that window lands on gets the full IPC bridge. That makes "where can this
 * window navigate" a security boundary rather than a UX detail.
 */

/** Schemes Chromium may ask permission for that the app genuinely needs. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write'])

/**
 * @param allowAppUrl which URLs count as the app's own document. Pass `true`
 *   only for a window with no preload, where a top-level navigation cannot
 *   expose the bridge.
 */
export function hardenWebContents(
  contents: Electron.WebContents,
  isAppUrl: (url: string) => boolean
): void {
  // `setWindowOpenHandler` only covers window.open / target=_blank. A plain
  // <a href> is a top-level navigation, so block those too.
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault()
      log.warn('Blocked renderer navigation to', url)
    }
  })
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault()
      log.warn('Blocked renderer redirect to', url)
    }
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalProtocol(url)) {
      void shell.openExternal(url)
    } else {
      log.warn('Blocked window.open to', url)
    }
    return { action: 'deny' }
  })

  // Deny by default. Without a handler Chromium prompts for camera, microphone,
  // geolocation and notifications, and a markdown document is never entitled to
  // any of them.
  contents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ALLOWED_PERMISSIONS.has(permission)
    if (!allowed) log.warn('Blocked permission request:', permission)
    callback(allowed)
  })
  contents.session.setPermissionCheckHandler((_wc, permission) =>
    ALLOWED_PERMISSIONS.has(permission)
  )
}

/** Guards for a window with no preload: nothing may navigate or open. */
export function hardenIsolatedWindow(contents: Electron.WebContents): void {
  hardenWebContents(contents, () => false)
}

/**
 * Content-Security-Policy for the standalone HTML export.
 *
 * Scripts are off outright. Images stay allowed because the exporter inlines
 * local assets as data URIs and leaves remote ones as ordinary URLs, and styles
 * must stay inline because the document ships its own stylesheet.
 */
export const EXPORT_CSP =
  "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data:"
