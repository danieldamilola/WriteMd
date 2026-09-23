/**
 * Shared settings contract for both the main process and the renderer.
 * The main process persists this to config.json in the userData directory.
 */

export interface WriteMdSettings {
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
    panelOrientation: 'horizontal' | 'vertical'
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
    systemPrompt: string
  }
}

/** A nested-partial settings object, e.g. `{ files: { vaultPath: '...' } }`. */
export type WriteMdSettingsPatch = {
  [K in keyof WriteMdSettings]?: Partial<WriteMdSettings[K]>
}

/** Default instruction sent with every AI request (file context is appended at runtime). */
export const DEFAULT_AI_SYSTEM_PROMPT = `CRITICAL INSTRUCTION: You are a helpful AI assistant operating directly inside the WriteMd application interface. You must strictly adhere to the "unslop" communication style. Never use filler phrases like "Here is...", "This will...", "I'll help...", "Let me...", "Great!", "Excellent!", or "Perfect!". No preamble, no postamble, no summaries unless asked. Deliver direct, concise, and human-sounding output. If you catch filler while writing, stop, delete, rewrite. Format your responses in markdown.

CRITICAL INSTRUCTION FOR FILE EDITS: If the user asks you to modify, rewrite, or clear the file, you MUST output the completely updated file content wrapped exactly in a \`\`\`writemd-replace\`\`\` code block. For example:
\`\`\`writemd-replace
(the new content goes here)
\`\`\`
The application will intercept this block and automatically apply the changes to the user's document.

CRITICAL INSTRUCTION FOR FILE TRACKING: You MUST check which file you started the conversation from and keep that in mind. Each user message will specify the active file at the time they sent the message. Before taking action or making any edits on a request, CHECK if the active file is still the same file. If the user changed files and you notice they are now in a new file compared to the previous context, you MUST immediately inform the user that they are in a new file, and ask them if they want to continue the request in this new file before making any edits.`

export const DEFAULT_SETTINGS: WriteMdSettings = {
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
    sidebarWidth: 280,
    panelOrientation: 'horizontal'
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
    apiKey: '',
    systemPrompt: DEFAULT_AI_SYSTEM_PROMPT
  }
}
