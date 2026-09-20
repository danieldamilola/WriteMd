import { ipcMain, dialog, shell, net, app, type BrowserWindow } from 'electron'
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
import { exportHtml, exportPdf } from './export'

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

  ipcMain.handle('shell:show-in-folder', (_, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('file:delete', async (_, filePath: string) => {
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

  ipcMain.handle('net:fetch-models', async (_, provider: string, apiKey: string) => {
    try {
      if (provider === 'OpenAI' || provider === 'Groq' || provider === 'Mistral' || provider === 'DeepSeek' || provider === 'xAI' || provider === 'OpenRouter') {
        const urls: Record<string, string> = {
          'OpenAI': 'https://api.openai.com/v1/models',
          'Groq': 'https://api.groq.com/openai/v1/models',
          'Mistral': 'https://api.mistral.ai/v1/models',
          'DeepSeek': 'https://api.deepseek.com/models',
          'xAI': 'https://api.x.ai/v1/models',
          'OpenRouter': 'https://openrouter.ai/api/v1/models'
        }
        // Use Electron's net.fetch
        const res = await net.fetch(urls[provider], {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (data.data) {
          return data.data.map((m: any) => m.id).sort()
        }
      } else if (provider === 'GoogleGemini') {
        const res = await net.fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (data.models) {
          return data.models.map((m: any) => m.name.replace('models/', '')).sort()
        }
      } else if (provider === 'Ollama') {
        const res = await net.fetch('http://localhost:11434/api/tags')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (data.models) {
          return data.models.map((m: any) => m.name).sort()
        }
      } else if (provider === 'Anthropic') {
        return ['claude-3-5-sonnet-20240620', 'claude-3-opus-20240229', 'claude-3-haiku-20240307']
      }
    } catch (e) {
      console.error('Failed to fetch models in main process:', e)
      throw e
    }
    return []
  })

  ipcMain.handle('net:chat', async (_, provider: string, model: string, apiKey: string, messages: any[], systemPrompt?: string) => {
    try {
      if (provider === 'OpenAI' || provider === 'Groq' || provider === 'Mistral' || provider === 'DeepSeek' || provider === 'xAI' || provider === 'OpenRouter' || provider === 'Ollama') {
        const urls: Record<string, string> = {
          'OpenAI': 'https://api.openai.com/v1/chat/completions',
          'Groq': 'https://api.groq.com/openai/v1/chat/completions',
          'Mistral': 'https://api.mistral.ai/v1/chat/completions',
          'DeepSeek': 'https://api.deepseek.com/chat/completions',
          'xAI': 'https://api.x.ai/v1/chat/completions',
          'OpenRouter': 'https://openrouter.ai/api/v1/chat/completions',
          'Ollama': 'http://localhost:11434/v1/chat/completions'
        }
        
        const finalMessages = systemPrompt 
          ? [{ role: 'system', content: systemPrompt }, ...messages] 
          : messages;

        const res = await net.fetch(urls[provider], {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(provider !== 'Ollama' && { 'Authorization': `Bearer ${apiKey}` })
          },
          body: JSON.stringify({ model, messages: finalMessages })
        })
        if (!res.ok) {
          if (res.status === 429) throw new Error('rate limit hit')
          throw new Error(`HTTP ${res.status}: ${await res.text()}`)
        }
        const data = await res.json()
        return data.choices[0].message.content
      } else if (provider === 'GoogleGemini') {
        // Map messages to Gemini format
        const contents = messages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }))
        
        // Gemini API can be finicky with systemInstruction, so let's guarantee it 
        // by prepending it to the first user message's text if it exists.
        if (systemPrompt && contents.length > 0) {
          contents[0].parts[0].text = `[SYSTEM INSTRUCTION]\n${systemPrompt}\n\n[USER MESSAGE]\n${contents[0].parts[0].text}`;
        }
        
        const res = await net.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents })
        })
        if (!res.ok) {
          if (res.status === 429) throw new Error('rate limit hit')
          throw new Error(`HTTP ${res.status}: ${await res.text()}`)
        }
        const data = await res.json()
        return data.candidates[0].content.parts[0].text
      } else if (provider === 'Anthropic') {
        const res = await net.fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            ...(systemPrompt && { system: systemPrompt }),
            messages
          })
        })
        if (!res.ok) {
          if (res.status === 429) throw new Error('rate limit hit')
          throw new Error(`HTTP ${res.status}: ${await res.text()}`)
        }
        const data = await res.json()
        return data.content[0].text
      }
    } catch (e: any) {
      console.error('Chat error:', e)
      throw new Error(e.message || 'Chat failed')
    }
  })
}

