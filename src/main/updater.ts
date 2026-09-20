import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import { ipcMain, BrowserWindow } from 'electron'

export function setupUpdater(getWindow: () => BrowserWindow | null): void {
  log.transports.file.level = 'info'
  autoUpdater.logger = log
  
  autoUpdater.autoDownload = false // Ask before downloading
  
  autoUpdater.on('update-available', (info) => {
    getWindow()?.webContents.send('updater:update-available', info)
  })

  autoUpdater.on('update-not-available', (info) => {
    getWindow()?.webContents.send('updater:update-not-available', info)
  })

  autoUpdater.on('update-downloaded', (info) => {
    getWindow()?.webContents.send('updater:update-downloaded', info)
  })
  
  autoUpdater.on('download-progress', (progressObj) => {
    getWindow()?.webContents.send('updater:download-progress', progressObj)
  })

  autoUpdater.on('error', (err) => {
    getWindow()?.webContents.send('updater:error', err?.message || 'Update error')
  })

  ipcMain.handle('updater:check', async () => {
    try {
      return await autoUpdater.checkForUpdates()
    } catch (e) {
      log.error('Check for updates failed', e)
      return null
    }
  })

  ipcMain.handle('updater:download', () => {
    return autoUpdater.downloadUpdate()
  })

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall(false, true)
  })
}
