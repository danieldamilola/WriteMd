import { app } from 'electron'
import { join, dirname } from 'path'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { writeFile } from 'fs/promises'

export const SETTINGS_FILE = join(app.getPath('userData'), 'config.json')

export interface WriteMDSettings {
  editor: {
    fontSize: number
    fontFamily: string
    lineHeight: number
    wordWrap: boolean
    tabSize: number
    vimMode: boolean
    typewriterMode: boolean
    autoSave: boolean
    autoSaveDelay: number
    showLineNumbers: boolean
    highlightActiveLine: boolean
  }
  preview: {
    fontSize: number
    fontFamily: string
    lineHeight: number
    maxWidth: number
    showMargin: boolean
  }
  appearance: {
    theme: string
    customCSS: string
    toolbarVisible: boolean
    statusBarVisible: boolean
    sidebarWidth: number
  }
  files: {
    vaultPath: string
    recentFilesMax: number
    recentFiles: string[]
    imageFolderName: string
    cleanupUnusedImages: string
    defaultNewFileContent: string
    defaultNewFileName: string
  }
  export: {
    pdfMargin: number
    pdfPageSize: string
    pdfTheme: string
    htmlStandalone: boolean
  }
  advanced: {
    enableMermaid: boolean
    enableWikiLinks: boolean
    spellCheck: boolean
    portableMode: boolean
  }
}

const DEFAULT_SETTINGS: WriteMDSettings = {
  editor: {
    fontSize: 15,
    fontFamily: 'JetBrains Mono',
    lineHeight: 1.7,
    wordWrap: true,
    tabSize: 2,
    vimMode: false,
    typewriterMode: false,
    autoSave: true,
    autoSaveDelay: 500,
    showLineNumbers: false,
    highlightActiveLine: true
  },
  preview: {
    fontSize: 16,
    fontFamily: 'Source Serif Pro',
    lineHeight: 1.8,
    maxWidth: 800,
    showMargin: true
  },
  appearance: {
    theme: 'dark',
    customCSS: '',
    toolbarVisible: true,
    statusBarVisible: true,
    sidebarWidth: 280
  },
  files: {
    vaultPath: '',
    recentFilesMax: 10,
    recentFiles: [],
    imageFolderName: '_assets',
    cleanupUnusedImages: 'prompt',
    defaultNewFileContent: '',
    defaultNewFileName: 'Untitled.md'
  },
  export: {
    pdfMargin: 24,
    pdfPageSize: 'A4',
    pdfTheme: 'light',
    htmlStandalone: true
  },
  advanced: {
    enableMermaid: true,
    enableWikiLinks: false,
    spellCheck: false,
    portableMode: false
  }
}

let settingsCache: WriteMDSettings | null = null

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target }
  for (const key of Object.keys(source)) {
    const sVal = source[key]
    const tVal = target[key]
    if (
      sVal &&
      typeof sVal === 'object' &&
      !Array.isArray(sVal) &&
      tVal &&
      typeof tVal === 'object'
    ) {
      result[key] = deepMerge(tVal as Record<string, unknown>, sVal as Record<string, unknown>)
    } else {
      result[key] = sVal
    }
  }
  return result
}

export function getSettings(): WriteMDSettings {
  if (settingsCache) return settingsCache
  let next: WriteMDSettings = { ...DEFAULT_SETTINGS }
  try {
    if (existsSync(SETTINGS_FILE)) {
      next = deepMerge(
        DEFAULT_SETTINGS as unknown as Record<string, unknown>,
        JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'))
      ) as unknown as WriteMDSettings
    }
  } catch {
    next = { ...DEFAULT_SETTINGS }
  }
  settingsCache = next
  return next
}

export async function setSettings(partial: Partial<WriteMDSettings>): Promise<void> {
  const current = getSettings()
  const merged = deepMerge(
    current as unknown as Record<string, unknown>,
    partial as unknown as Record<string, unknown>
  ) as unknown as WriteMDSettings
  settingsCache = merged
  try {
    const dir = dirname(SETTINGS_FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    await writeFile(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf-8')
  } catch (e) {
    console.error('Failed to write settings:', e)
  }
}
