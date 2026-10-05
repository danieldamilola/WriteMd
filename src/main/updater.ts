import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import { ipcMain, BrowserWindow } from 'electron'
import type { UpdaterState } from '../shared/electron-api'
import { getSettings } from './settings'
import { humanizeUpdaterError } from './updater-error'

let snapshot: UpdaterState = { status: 'idle', version: '', percent: 0, error: '' }

function setSnapshot(patch: Partial<UpdaterState>): void {
  snapshot = { ...snapshot, ...patch }
}

export function setupUpdater(getWindow: () => BrowserWindow | null): void {
  log.transports.file.level = 'info'
  autoUpdater.logger = log

  autoUpdater.autoDownload = false // Ask before downloading

  autoUpdater.on('update-available', (info) => {
    // The renderer persists a declined version. Honoured here rather than in
    // the UI so the button does not appear and then vanish, and so the manual
    // check in Settings reports the same thing the toolbar does.
    const version = info?.version ?? ''
    if (version && version === getSettings().updates.skippedVersion) {
      log.info(`Update v${version} was skipped by the user; not offering it`)
      setSnapshot({ status: 'idle', version: '', percent: 0, error: '' })
      return
    }
    setSnapshot({ status: 'available', version, percent: 0, error: '' })
    getWindow()?.webContents.send('updater:update-available', info)
  })

  autoUpdater.on('update-not-available', (info) => {
    setSnapshot({ status: 'idle', version: '', error: '' })
    getWindow()?.webContents.send('updater:update-not-available', info)
  })

  autoUpdater.on('update-downloaded', (info) => {
    setSnapshot({ status: 'downloaded', version: info?.version ?? snapshot.version, percent: 100 })
    getWindow()?.webContents.send('updater:update-downloaded', info)
  })

  autoUpdater.on('download-progress', (progressObj) => {
    setSnapshot({ status: 'downloading', percent: Math.round(progressObj.percent ?? 0) })
    getWindow()?.webContents.send('updater:download-progress', progressObj)
  })

  autoUpdater.on('error', (err) => {
    // Full detail to the log, one sentence to the renderer.
    log.error('Updater error', err)
    const message = humanizeUpdaterError(err)
    setSnapshot({ status: 'error', error: message })
    getWindow()?.webContents.send('updater:error', message)
  })

  ipcMain.handle('updater:check', async () => {
    setSnapshot({ status: 'checking', error: '' })
    try {
      const result = await autoUpdater.checkForUpdates()
      // autoUpdater also fires events for this; this exists so Settings can
      // react to the check itself completing with no update found.
      if (result == null) {
        setSnapshot({ status: 'idle' })
      }
      const version = result?.updateInfo?.version ?? ''
      if (version && version === getSettings().updates.skippedVersion) {
        // The event handler already cleared the snapshot; this only stops the
        // returning payload from reading as "here is your update".
        return { skipped: version }
      }
      return { updateInfo: result?.updateInfo }
    } catch (e) {
      log.error('Check for updates failed', e)
      const message = humanizeUpdaterError(e)
      setSnapshot({ status: 'error', error: message })
      return { error: message }
    }
  })

  ipcMain.handle('updater:download', async () => {
    setSnapshot({ status: 'downloading', percent: 0, error: '' })
    return autoUpdater.downloadUpdate()
  })

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall(false, true)
  })

  ipcMain.handle('updater:get-state', () => snapshot)

  // Silent startup check. Opt-out via Settings → About → Auto-check for updates.
  setTimeout(() => {
    if (getSettings().updates.autoCheckForUpdates) {
      autoUpdater.checkForUpdates().catch((e) => {
        log.warn('Background update check failed', e)
      })
    }
  }, 10_000)
}
