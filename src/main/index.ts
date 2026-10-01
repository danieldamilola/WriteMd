import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import log from 'electron-log'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { setupIpc, closeAllWatchers } from './ipc'
import { registerExternalPath, isAllowedExternalProtocol } from './path-guard'
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
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const contents = mainWindow.webContents

  // `setWindowOpenHandler` only covers window.open / target=_blank. A plain
  // <a href> is a top-level navigation, so block those too: the preload is
  // bound to this webContents and would re-expose the full IPC bridge on
  // whatever origin the renderer navigated to.
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

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    // Skip flags; match supported markdown extensions case-insensitively.
    const filePath = argv.find(
      (arg) => !arg.startsWith('-') && /\.(md|markdown|mdown|mkd)$/i.test(arg)
    )
    if (filePath) {
      registerExternalPath(filePath)
      mainWindow.webContents.send('file:open-external', filePath)
    }
  }
})
