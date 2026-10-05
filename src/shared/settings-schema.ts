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
    autoSave: boolean
    autoSaveDelay: number
    showLineNumbers: boolean
    highlightActiveLine: boolean
    /**
     * Where the user last dragged the floating table toolbar, in pixels from the
     * spot CodeMirror anchors it to. Per-editor while the session lives (so the
     * two split panes can sit on different tables); this copy seeds new editors
     * and survives restarts.
     */
    tableToolbarOffset: { x: number; y: number }
  }
  appearance: {
    theme: string
    accentColor: string
    panelOrientation: 'horizontal' | 'vertical'
    /** Full-screen settings shell. Off restores the centered popup dialog. */
    newSettingsDesign: boolean
    /**
     * `system` follows the OS animation setting, `full` animates regardless of
     * it, `reduced` never animates. Written onto `<html>` as `data-motion`, which
     * is what every animated surface tests.
     */
    motion: 'system' | 'full' | 'reduced'
  }
  files: {
    vaultPath: string
    recentFilesMax: number
    recentFiles: string[]
    openTabs: string[]
    activeTabPath: string | null
    defaultNewFileContent: string
    defaultNewFileName: string
  }
  export: {
    pdfMargin: number
    pdfPageSize: string
    pdfTheme: string
  }
  advanced: {
    enableMermaid: boolean
  }
  updates: {
    autoCheckForUpdates: boolean
    lastSeenWhatsNewVersion: string
    /**
     * Version the user dismissed, so a declined update does not reappear on
     * every launch. A newer version string does not match, so the next
     * release prompts again.
     */
    skippedVersion: string
  }
  shortcuts: {
    bindings: Record<string, string>
  }
  ai: {
    provider: string
    model: string
    apiKey: string
    /**
     * Whether a key is stored, without revealing it. Derived in the main
     * process and stripped before the config is written, so the renderer can
     * show "configured" state without the plaintext ever crossing the bridge.
     */
    apiKeySet: boolean
    /** A key is stored but this install cannot decrypt it; the user must retype. */
    apiKeyUndecryptable: boolean
    systemPrompt: string
    /** Explicit opencode CLI path (e.g. %APPDATA%\npm\opencode.cmd); empty = autodetect. */
    opencodeCliPath: string
    /** Ground answers with a keyless web search before sending to the model. */
    webSearchEnabled: boolean
  }
}

/** A nested-partial settings object, e.g. `{ files: { vaultPath: '...' } }`. */
export type WriteMdSettingsPatch = {
  [K in keyof WriteMdSettings]?: Partial<WriteMdSettings[K]>
}

/** Default instruction sent with every AI request (file context is appended at runtime). */
export const DEFAULT_AI_SYSTEM_PROMPT = `You are the AI assistant inside the WriteMd markdown editor. Write direct, concise, human-sounding markdown. No filler openers ("Here is...", "I'll help..."), no exclamations ("Great!", "Perfect!"), no preamble, postamble, or summaries unless asked. If filler slips in, stop, delete, rewrite.

FILE EDITS: when the user asks to change the file, output the entire updated file and nothing else inside one \`\`\`writemd-replace block:
\`\`\`writemd-replace
(entire new file content)
\`\`\`
The app applies that block to the document automatically.

FILE TRACKING: every user message names its file. If it differs from the file the conversation started in, stop and ask which file to work in before editing anything.

WEB SEARCH: appended live results count as pages you opened: answer from them, cite sources with links. Never discuss search mechanics, tools, or your own capabilities. With no results supplied, answer from your own knowledge.`

export const DEFAULT_SETTINGS: WriteMdSettings = {
  editor: {
    fontSize: 15,
    fontFamily: 'JetBrains Mono',
    lineHeight: 1.7,
    wordWrap: true,
    tabSize: 2,
    autoSave: true,
    autoSaveDelay: 500,
    showLineNumbers: false,
    highlightActiveLine: true,
    tableToolbarOffset: { x: 0, y: 0 }
  },
  appearance: {
    theme: 'graphite',
    accentColor: '#f24e1e',
    panelOrientation: 'horizontal',
    newSettingsDesign: true,
    motion: 'system'
  },
  files: {
    vaultPath: '',
    recentFilesMax: 10,
    recentFiles: [],
    openTabs: [],
    activeTabPath: null,
    defaultNewFileContent: '',
    defaultNewFileName: 'Untitled.md'
  },
  export: {
    pdfMargin: 24,
    pdfPageSize: 'A4',
    pdfTheme: 'light'
  },
  advanced: {
    enableMermaid: true
  },
  updates: {
    autoCheckForUpdates: true,
    lastSeenWhatsNewVersion: '',
    skippedVersion: ''
  },
  shortcuts: {
    bindings: {}
  },
  ai: {
    provider: 'OpenAI',
    model: 'gpt-4o',
    apiKey: '',
    apiKeySet: false,
    apiKeyUndecryptable: false,
    systemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
    opencodeCliPath: '',
    webSearchEnabled: false
  }
}

/**
 * Flattened dotted keys, e.g. `editor.showLineNumbers`.
 *
 * `Object.keys` walks own enumerable properties, which `DEFAULT_SETTINGS` has
 * for every key the app supports. Used to validate an incoming patch and to
 * assert in tests that each key has a reader, so a control can never silently
 * become a no-op again.
 */
export function settingKeys(): string[] {
  const out: string[] = []
  for (const [section, values] of Object.entries(DEFAULT_SETTINGS)) {
    for (const key of Object.keys(values as Record<string, unknown>)) {
      out.push(`${section}.${key}`)
    }
  }
  return out
}

/**
 * Element types for array-valued settings. The default for each is an empty
 * array, so there is no runtime instance to infer the element type from.
 */
const ARRAY_ELEMENT_TYPES: Record<string, 'string' | 'number' | 'boolean'> = {
  'files.recentFiles': 'string',
  'files.openTabs': 'string',
  'shortcuts.bindings': 'string'
}

/**
 * Settings whose value is one of a fixed set of strings.
 *
 * A union type is erased at runtime, so `typeof value !== typeof fallback` is
 * satisfied by any string. These are the ones where an unexpected member is not
 * harmless: an unknown `motion` resolved to "match the system", so a typo looked
 * like it had been set.
 */
const STRING_UNIONS: Record<string, readonly string[]> = {
  'appearance.motion': ['system', 'full', 'reduced']
}

/**
 * Drop anything the schema does not declare, and reject a value whose type
 * disagrees with its default.
 *
 * `settings:set` runs this before merging. Without it `deepMerge` accepts any
 * key and any type, so a renderer bug (or a compromised renderer) can poison
 * config.json with values nothing can read back. Returns the problems found so
 * the caller can log them.
 */
export function validatePatch(patch: unknown): {
  clean: WriteMdSettingsPatch
  problems: string[]
} {
  const problems: string[] = []
  const clean: Record<string, Record<string, unknown>> = {}
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return { clean: {}, problems: ['patch is not an object'] }
  }

  for (const [section, values] of Object.entries(patch as Record<string, unknown>)) {
    const defaults = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[section]
    if (!defaults) {
      problems.push(`unknown section: ${section}`)
      continue
    }
    if (typeof values !== 'object' || values === null || Array.isArray(values)) {
      problems.push(`${section} is not an object`)
      continue
    }
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      const dotted = `${section}.${key}`
      if (!(key in (defaults as Record<string, unknown>))) {
        problems.push(`unknown key: ${dotted}`)
        continue
      }
      // apiKeySet and apiKeyUndecryptable are derived in the main process and
      // must not be client-set.
      if (dotted === 'ai.apiKeySet' || dotted === 'ai.apiKeyUndecryptable') {
        problems.push(`${dotted} is derived and cannot be set`)
        continue
      }
      if (value === null || value === undefined) continue
      const fallback = (defaults as Record<string, unknown>)[key]
      if (Array.isArray(fallback)) {
        const element = ARRAY_ELEMENT_TYPES[dotted]
        if (!element) {
          problems.push(`${dotted} has no declared element type`)
          continue
        }
        if (!Array.isArray(value) || value.some((v) => typeof v !== element)) {
          problems.push(`${dotted} must be an array of ${element}`)
          continue
        }
      } else if (typeof value !== typeof fallback) {
        problems.push(`${dotted} must be a ${typeof fallback}, got ${typeof value}`)
        continue
      } else {
        // A union needs its members named. `typeof` alone let any string through
        // for `appearance.motion`, which the renderer then cast its way past, so
        // a typo persisted and silently resolved to "match the system".
        const allowed = STRING_UNIONS[dotted]
        if (allowed && !allowed.includes(value as string)) {
          problems.push(`${dotted} must be one of: ${allowed.join(', ')}`)
          continue
        }
      }
      clean[section] ??= {}
      clean[section][key] = value
    }
  }

  return { clean: clean as WriteMdSettingsPatch, problems }
}
