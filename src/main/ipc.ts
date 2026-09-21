import { ipcMain, dialog, shell, net, app, type BrowserWindow } from 'electron'
import { readFile, writeFile, stat, rename, unlink } from 'fs/promises'
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
import { getSettings, setSettings, type WriteMDSettingsPatch } from './settings'
import { exportHtml, exportPdf } from './export'
import { getAiProvider } from '../shared/ai-providers'
import type { ChatMessage } from '../shared/electron-api'
import {
  setVaultRootProvider,
  registerExternalPath,
  registerExternalPaths,
  canAccessPath,
  canProbePath,
  canRenamePath,
  canOpenWithShell,
  assertCanAccess,
  isSubpath
} from './path-guard'

const watchedPaths = new Map<string, FSWatcher>()

/** Restore access to documents referenced by our own persisted config. */
export function registerPersistedPaths(): void {
  const settings = getSettings()
  registerExternalPaths([
    ...settings.files.openTabs,
    settings.files.activeTabPath,
    ...settings.files.recentFiles
  ])
}

/** Close all fs watchers; called on app quit so nothing leaks. */
export function closeAllWatchers(): void {
  for (const watcher of watchedPaths.values()) {
    try {
      watcher.close()
    } catch {
      // already closed
    }
  }
  watchedPaths.clear()
}

export function setupIpc(getWindow: () => BrowserWindow | null): void {
  setVaultRootProvider(getVaultPath)
  registerPersistedPaths()

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

  ipcMain.handle('window:zoom-in', () => {
    const contents = getWindow()?.webContents
    if (contents) contents.setZoomFactor(Math.min(3, contents.getZoomFactor() * 1.1))
  })

  ipcMain.handle('window:zoom-out', () => {
    const contents = getWindow()?.webContents
    if (contents) contents.setZoomFactor(Math.max(0.5, contents.getZoomFactor() / 1.1))
  })

  ipcMain.handle('window:zoom-reset', () => {
    getWindow()?.webContents.setZoomFactor(1)
  })

  ipcMain.handle('file:read', async (_, filePath: string) => {
    assertCanAccess(filePath)
    const content = await readFile(filePath, 'utf-8')
    const stats = await stat(filePath)
    return { content, mtime: stats.mtimeMs }
  })

  ipcMain.handle('file:write', async (_, filePath: string, content: string) => {
    assertCanAccess(filePath)
    mkdirSync(dirname(filePath), { recursive: true })
    // Unique temp name: concurrent writes to the same file must not clobber
    // each other's temp file (and stale temps are cleaned up on failure).
    const tempPath = `${filePath}.${randomUUID()}.tmp`
    try {
      await writeFile(tempPath, content, 'utf-8')
      await rename(tempPath, filePath)
    } catch (e) {
      await unlink(tempPath).catch(() => {})
      throw e
    }
    const stats = await stat(filePath)
    return { mtime: stats.mtimeMs }
  })

  ipcMain.handle('file:open-dialog', async (_, options: Electron.OpenDialogOptions) => {
    const w = getWindow()
    if (!w) return { canceled: true, filePaths: [] }
    const result = await dialog.showOpenDialog(w, options)
    registerExternalPaths(result.filePaths)
    return result
  })

  ipcMain.handle('file:save-dialog', async (_, options: Electron.SaveDialogOptions) => {
    const w = getWindow()
    if (!w) return { canceled: true, filePath: '' }
    const result = await dialog.showSaveDialog(w, options)
    registerExternalPath(result.filePath)
    return result
  })

  ipcMain.handle('file:exists', async (_, filePath: string) => {
    if (!canProbePath(filePath)) return false
    return existsSync(filePath)
  })

  ipcMain.handle('file:rename', async (_, oldPath: string, newPath: string) => {
    if (!canRenamePath(oldPath, newPath)) {
      console.error(`file:rename denied: ${oldPath} -> ${newPath}`)
      return false
    }
    try {
      await rename(oldPath, newPath)
      registerExternalPath(newPath)
      return true
    } catch (e) {
      // Surface the real reason in the main log instead of swallowing it.
      console.error(`file:rename failed (${oldPath} -> ${newPath}):`, e)
      return false
    }
  })

  ipcMain.handle('file:list-dir', async (_, dirPath: string) => {
    if (!canAccessPath(dirPath)) return []
    return listMarkdownFiles(dirPath)
  })

  ipcMain.handle('file:watch', (_, filePath: string) => {
    if (watchedPaths.has(filePath)) return
    if (!canAccessPath(filePath)) return
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
    assertCanAccess(docPath)
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
      assertCanAccess(docPath)
      const docDir = dirname(docPath)
      const fullPath = resolve(docDir, relativePath)
      // The resolved asset must stay inside the document's directory tree.
      if (!isSubpath(fullPath, docDir)) return null
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
  ipcMain.handle('settings:set', async (_, settings: WriteMDSettingsPatch) => {
    await setSettings(settings)
  })

  ipcMain.handle('dialog:show-open-dialog', async (_, options: Electron.OpenDialogOptions) => {
    const w = getWindow()
    if (!w) return { canceled: true, filePaths: [] }
    const result = await dialog.showOpenDialog(w, options)
    registerExternalPaths(result.filePaths)
    return result
  })

  ipcMain.handle('shell:open-path', async (_, targetPath: string) => {
    assertCanAccess(targetPath)
    if (!canOpenWithShell(targetPath)) {
      throw new Error(`shell:open-path denied for file type: ${targetPath}`)
    }
    await shell.openPath(targetPath)
  })

  ipcMain.handle('shell:open-external', async (_, url: string) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error(`Invalid URL: ${url}`)
    }
    // Only well-known safe schemes may leave the app; file:/// or custom
    // protocol handlers would let a crafted link launch arbitrary content.
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      throw new Error(`Protocol not allowed: ${parsed.protocol}`)
    }
    await shell.openExternal(url)
  })

  ipcMain.handle('shell:show-in-folder', (_, filePath: string) => {
    if (!canProbePath(filePath)) return
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('file:delete', async (_, filePath: string) => {
    if (!canAccessPath(filePath)) {
      console.error(`file:delete denied: ${filePath}`)
      return false
    }
    try {
      await shell.trashItem(filePath)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('export:pdf', async (_, markdown: string, docPath: string | null) =>
    exportPdf(getWindow, markdown, docPath)
  )

  ipcMain.handle('export:html', async (_, markdown: string, docPath: string | null) =>
    exportHtml(getWindow, markdown, docPath)
  )

  async function assertOk(res: Response): Promise<void> {
    if (res.ok) return
    if (res.status === 429) throw new Error('rate limit hit')
    throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  }

  ipcMain.handle('net:fetch-models', async (_, provider: string, apiKey: string) => {
    const adapter = getAiProvider(provider)
    if (!adapter) throw new Error(`Unknown AI provider: ${provider}`)
    if (adapter.staticModels) return [...adapter.staticModels]
    const req = adapter.buildModelsRequest(apiKey)
    if (!req) return []
    try {
      const res = await net.fetch(req.url, { headers: req.headers })
      await assertOk(res)
      return adapter.extractModelIds(await res.json())
    } catch (e) {
      console.error('Failed to fetch models in main process:', e)
      throw e
    }
  })

  ipcMain.handle(
    'net:chat',
    async (
      _,
      provider: string,
      model: string,
      apiKey: string,
      messages: ChatMessage[],
      systemPrompt?: string
    ) => {
      const adapter = getAiProvider(provider)
      if (!adapter) throw new Error(`Unknown AI provider: ${provider}`)
      try {
        const req = adapter.buildChatRequest({ model, apiKey, messages, systemPrompt })
        const res = await net.fetch(req.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...req.headers },
          body: JSON.stringify(req.body)
        })
        await assertOk(res)
        return adapter.extractChatText(await res.json())
      } catch (e) {
        console.error('Chat error:', e)
        throw new Error(e instanceof Error ? e.message : 'Chat failed')
      }
    }
  )
}
