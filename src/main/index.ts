import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { setupIpc, closeAllWatchers } from './ipc'
import { registerExternalPath } from './path-guard'
import { hardenWebContents } from './harden'
import { ensureVaultExists } from './vault'
import { registerFileAssociations } from './file-associations'
import { setupUpdater } from './updater'

let mainWindow: BrowserWindow | null = null

/**
 * The renderer's own document is the only location it may end up at. In dev the
 * document is served over http by the vite dev server; in production it is a
 * file:// URL. Everything else is blocked.
 *
 * Production is an exact match against the built index.html, not a `file://`
 * prefix test. The preload is bound to this webContents rather than to an
 * origin, so any file:// document it lands on gets the full bridge re-exposed.
 * A prefix check would let a top-level navigation to, say,
 * file:///C:/Users/<user>/.aws/credentials read local files with full Node
 * access. Compare parsed URLs so path traversal in the fragment/query cannot
 * smuggle a different target past a string comparison.
 */
const BUILT_RENDERER_URL = pathToFileURL(join(__dirname, '../renderer/index.html')).href

function isAppUrl(url: string): boolean {
  if (is.dev) {
    const devServerUrl = process.env['ELECTRON_RENDERER_URL']
    if (typeof devServerUrl === 'string' && devServerUrl.length > 0) {
      return url.startsWith(devServerUrl)
    }
  }
  try {
    return new URL(url).href === BUILT_RENDERER_URL
  } catch {
    return false
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The renderer needs no Node access; the preload is bundled and only
      // touches `electron`, so it runs fine sandboxed.
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const contents = mainWindow.webContents

  // The preload is bound to this webContents rather than to an origin, so any
  // document it lands on gets the full bridge re-exposed. A top-level
  // navigation to, say, file:///C:/Users/<user>/.aws/credentials would otherwise
  // be able to read local files through the app.
  hardenWebContents(contents, isAppUrl)
  // Content-Security-Policy comes from the <meta> tag in index.html. A header
  // via `onHeadersReceived` would be redundant here and does not reliably fire
  // for the file:// protocol.

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Paths the app was asked to open, before a window exists to send them to. */
const pendingOpens: string[] = []

const MARKDOWN_FILE_RE = /\.(md|markdown|mdown|mkd)$/i

/** Pick the first supported document out of an argv array, skipping flags. */
function documentFromArgv(argv: readonly string[]): string | null {
  return argv.find((arg) => !arg.startsWith('-') && MARKDOWN_FILE_RE.test(arg)) ?? null
}

function openPathInWindow(filePath: string): void {
  registerExternalPath(filePath)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('file:open-external', filePath)
  }
}

/**
 * Hand every queued path to the renderer.
 *
 * Waited on `did-finish-load` because the renderer subscribes to
 * `file:open-external` in its own `connectedCallback`. Sending any earlier
 * dropped the event on the floor and the app launched to an empty window.
 */
function flushPendingOpens(): void {
  while (pendingOpens.length > 0) {
    const filePath = pendingOpens.shift()
    if (filePath) mainWindow?.webContents.send('file:open-external', filePath)
  }
}

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.writemd.editor')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ensureVaultExists()
  registerFileAssociations()
  setupIpc(() => mainWindow)
  setupUpdater(() => mainWindow)

  createWindow()

  // Flush anything the OS asked us to open before the window existed. Cold
  // start with a file argument used to open nothing at all.
  mainWindow?.webContents.once('did-finish-load', () => flushPendingOpens())

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  closeAllWatchers()
})

app.on('second-instance', (_event, argv) => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
  const filePath = documentFromArgv(argv)
  if (filePath) openPathInWindow(filePath)
})

/**
 * macOS delivers Finder and dock opens through `open-file`, not argv. Without
 * this handler, double-clicking a `.md` in Finder launched the app and did
 * nothing.
 *
 * Registered before `whenReady` because macOS can deliver the event during
 * launch, and queued when there is no window yet.
 */
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (mainWindow) {
    openPathInWindow(filePath)
  } else {
    pendingOpens.push(filePath)
  }
})

// Cold start on Windows and Linux: the path arrives in argv rather than an
// event. The single-instance lock means this process is the one that survives.
const coldStartPath = documentFromArgv(process.argv)
if (coldStartPath) pendingOpens.push(coldStartPath)
