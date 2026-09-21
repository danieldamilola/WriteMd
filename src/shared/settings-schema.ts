/**
 * Shared settings contract for both the main process and the renderer.
 * The main process persists this to config.json in the userData directory.
 */

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
    accentColor: string
    customCSS: string
    toolbarVisible: boolean
    statusBarVisible: boolean
    sidebarWidth: number
  }
  files: {
    vaultPath: string
    recentFilesMax: number
    recentFiles: string[]
    openTabs: string[]
    activeTabPath: string | null
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
  shortcuts: {
    bindings: Record<string, string>
  }
  ai: {
    provider: string
    model: string
    apiKey: string
  }
}

/** A nested-partial settings object, e.g. `{ files: { vaultPath: '...' } }`. */
export type WriteMDSettingsPatch = {
  [K in keyof WriteMDSettings]?: Partial<WriteMDSettings[K]>
}

export const DEFAULT_SETTINGS: WriteMDSettings = {
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
    accentColor: '',
    customCSS: '',
    toolbarVisible: true,
    statusBarVisible: true,
    sidebarWidth: 280
  },
  files: {
    vaultPath: '',
    recentFilesMax: 10,
    recentFiles: [],
    openTabs: [],
    activeTabPath: null,
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
  },
  shortcuts: {
    bindings: {}
  },
  ai: {
    provider: 'OpenAI',
    model: 'gpt-4o',
    apiKey: ''
  }
}
