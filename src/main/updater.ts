import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import { ipcMain, BrowserWindow } from 'electron'
import type { UpdaterState } from '../shared/electron-api'
import { getSettings } from './settings'

let snapshot: UpdaterState = { status: 'idle', version: '', percent: 0, error: '' }

function setSnapshot(patch: Partial<UpdaterState>): void {
  snapshot = { ...snapshot, ...patch }
}

export function setupUpdater(getWindow: () => BrowserWindow | null): void {
  log.transports.file.level = 'info'
  autoUpdater.logger = log

  autoUpdater.autoDownload = false // Ask before downloading

  autoUpdater.on('update-available', (info) => {
    setSnapshot({ status: 'available', version: info?.version ?? '', error: '' })
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
    const message = err?.message || 'Update error'
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
      return { updateInfo: result?.updateInfo }
    } catch (e) {
      log.error('Check for updates failed', e)
      const message = e instanceof Error ? e.message : String(e)
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
