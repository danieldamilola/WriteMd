import { ipcMain, dialog, shell, app, type BrowserWindow } from 'electron'
import { readFile, writeFile, stat, rename } from 'fs/promises'
import { watch, existsSync, mkdirSync, type FSWatcher } from 'fs'
import { dirname, join, resolve } from 'path'
import { randomUUID } from 'crypto'
import {
  getVaultPath,
  setVaultPath,
  ensureVaultExists,
  listMarkdownFiles,
  getVaultTree
} from './vault'
import { getSettings, setSettings, type WriteMDSettings } from './settings'

const watchedPaths = new Map<string, FSWatcher>()

export function setupIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('app:get-path', (_, name: 'home' | 'documents' | 'downloads' | 'temp') =>
    app.getPath(name)
  )
  ipcMain.handle('app:quit', () => app.quit())

  ipcMain.handle('window:minimize', () => getWindow()?.minimize())
  ipcMain.handle('window:maximize', () => {
    const w = getWindow()
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.handle('window:close', () => getWindow()?.close())
  ipcMain.handle('window:is-maximized', () => getWindow()?.isMaximized() ?? false)

  ipcMain.handle('file:read', async (_, filePath: string) => {
    const content = await readFile(filePath, 'utf-8')
    const stats = await stat(filePath)
    return { content, mtime: stats.mtimeMs }
  })

  ipcMain.handle('file:write', async (_, filePath: string, content: string) => {
    mkdirSync(dirname(filePath), { recursive: true })
    const tempPath = `${filePath}.tmp`
    await writeFile(tempPath, content, 'utf-8')
    await rename(tempPath, filePath)
    const stats = await stat(filePath)
    return { mtime: stats.mtimeMs }
  })

  ipcMain.handle('file:open-dialog', async (_, options: Electron.OpenDialogOptions) => {
    const w = getWindow()
    if (!w) return { canceled: true, filePaths: [] }
    return dialog.showOpenDialog(w, options)
  })

  ipcMain.handle('file:save-dialog', async (_, options: Electron.SaveDialogOptions) => {
    const w = getWindow()
    if (!w) return { canceled: true, filePath: '' }
    return dialog.showSaveDialog(w, options)
  })

  ipcMain.handle('file:exists', async (_, filePath: string) => existsSync(filePath))

  ipcMain.handle('file:rename', async (_, oldPath: string, newPath: string) => {
    try {
      await rename(oldPath, newPath)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('file:list-dir', async (_, dirPath: string) => listMarkdownFiles(dirPath))

  ipcMain.handle('file:watch', (_, filePath: string) => {
    if (watchedPaths.has(filePath)) return
    try {
      const watcher = watch(filePath, { persistent: false })
      watcher.on('change', () => getWindow()?.webContents.send('file:changed', filePath))
      watcher.on('error', () => watchedPaths.delete(filePath))
      watchedPaths.set(filePath, watcher)
    } catch {
      // ignore
    }
  })

  ipcMain.handle('file:unwatch', (_, filePath: string) => {
    const watcher = watchedPaths.get(filePath)
    if (watcher) {
      watcher.close()
      watchedPaths.delete(filePath)
    }
  })

  ipcMain.handle('file:save-image', async (_, docPath: string, base64Data: string, ext: string) => {
    const docDir = dirname(docPath)
    const assetsDir = join(docDir, '_assets')
    mkdirSync(assetsDir, { recursive: true })
    const filename = `${randomUUID()}.${ext.replace(/^\./, '')}`
    const fullPath = join(assetsDir, filename)
    const buffer = Buffer.from(base64Data, 'base64')
    await writeFile(fullPath, buffer)
    return {
      relativePath: `./_assets/${filename}`,
      fullPath
    }
  })

  ipcMain.handle('file:resolve-asset', async (_, docPath: string, relativePath: string) => {
    try {
      const docDir = dirname(docPath)
      const fullPath = resolve(docDir, relativePath)
      if (!existsSync(fullPath)) return null
      const buffer = await readFile(fullPath)
      const ext = fullPath.split('.').pop()?.toLowerCase() || 'png'
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        svg: 'image/svg+xml',
        webp: 'image/webp',
        bmp: 'image/bmp'
      }
      const mime = mimeMap[ext] || 'image/png'
      return `data:${mime};base64,${buffer.toString('base64')}`
    } catch {
      return null
    }
  })

  ipcMain.handle('vault:get-path', () => getVaultPath())
  ipcMain.handle('vault:set-path', async (_, vaultPath: string) => {
    await setVaultPath(vaultPath)
    ensureVaultExists()
  })
  ipcMain.handle('vault:ensure-exists', () => ensureVaultExists())
  ipcMain.handle('vault:list-files', () => listMarkdownFiles(getVaultPath()))
  ipcMain.handle('vault:get-tree', () => getVaultTree())

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', async (_, settings: Partial<WriteMDSettings>) => {
    await setSettings(settings)
  })

  ipcMain.handle('dialog:show-open-dialog', async (_, options: Electron.OpenDialogOptions) => {
    const w = getWindow()
    if (!w) return { canceled: true, filePaths: [] }
    return dialog.showOpenDialog(w, options)
  })

  ipcMain.handle('shell:open-path', async (_, targetPath: string) => {
    await shell.openPath(targetPath)
  })

  ipcMain.handle('shell:open-external', async (_, url: string) => {
    await shell.openExternal(url)
  })
}

