/**
 * Shared settings contract for both the main process and the renderer.
 * The main process persists this to config.json in the userData directory.
 */

import { validModelPreferences, type ModelPreferences } from './ai/model-options'

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
     * Show the document path on the left of the document footer.
     *
     * The path used to live in the document header, which had no way to hide
     * it. It moved to the footer, so the toggle moved with it.
     */
    showFilePath: boolean
    /**
     * Where the user last dragged the floating table toolbar, in pixels from the
     * spot CodeMirror anchors it to. Per-editor while the session lives (so the
     * two split panes can sit on different tables); this copy seeds new editors
     * and survives restarts.
     */
    tableToolbarOffset: { x: number; y: number }
  }
  appearance: {
    designVersion: number
    themeHue: number
    themeSaturation: number
    themeDarkLightness: number
    theme: string
    accentColor: string
    panelOrientation: 'horizontal' | 'vertical'
    /** Full-screen settings shell. Off restores the centered popup dialog. */
    /**
     * `system` follows the OS animation setting, `full` animates regardless of
     * it, `reduced` never animates. Written onto `<html>` as `data-motion`, which
     * is what every animated surface tests.
     */
    motion: 'system' | 'full' | 'reduced'
    paneWidth: number
    railWidth: number
    aiDockWidth: number
    backgroundId: string
    backgroundEffect: 'none' | 'haze' | 'dither' | 'ascii' | 'halftone' | 'scanlines'
    backgroundTarget: 'workspace'
    backgroundShowOn: 'all' | 'empty'
    backgroundEmptyOpacity: number
    backgroundContentOpacity: number
    backgroundBlur: number
    surfaceOpacity: number
    windowMaterial: 'none' | 'mica' | 'acrylic'
  }
  files: {
    vaultPath: string
    recentFilesMax: number
    recentFiles: string[]
    openTabs: string[]
    activeTabPath: string | null
    pinnedTabs: string[]
    tabGroups: string
    defaultNewFileContent: string
    defaultNewFileName: string
  }
  export: {
    pdfMargin: number
    pdfPageSize: string
    pdfTheme: string
  }
  ai: {
    /** Master switch. New profiles show the assistant; a key is still required to send. */
    enabled: boolean
    /** Apply completed floating-bar suggestions through the normal acceptance path. */
    autoAcceptEdits: boolean
    /** 0 follows the provider default. Other values cap one generated response. */
    maxOutputTokens: number
    /** Which preset. See `PRESETS` in src/main/ai/providers. */
    providerId: string
    /** Editable, so a self-hosted or proxied endpoint works without a new adapter. */
    baseUrl: string
    model: string
    /**
     * Whether an API key is stored on this machine. The key itself lives in a
     * separate safeStorage-encrypted file and never in config.json, which is
     * plain JSON on disk and is fine to read, copy, and commit.
     */
    apiKeySet: boolean
    /** Previous chat turns replayed with each message. 0 makes each turn stateless. */
    historyTurns: number
    /** Model ids the last Fetch returned, so the picker survives a restart. */
    cachedModels: string[]
    modelPreferences: ModelPreferences
  }
  advanced: {
    enableMermaid: boolean
    hardwareAcceleration: boolean
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
}

/** A nested-partial settings object, e.g. `{ files: { vaultPath: '...' } }`. */
export type WriteMdSettingsPatch = {
  [K in keyof WriteMdSettings]?: Partial<WriteMdSettings[K]>
}

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
    showFilePath: true,
    tableToolbarOffset: { x: 0, y: 0 }
  },
  appearance: {
    designVersion: 1,
    themeHue: 240,
    themeSaturation: 0,
    themeDarkLightness: 9,
    theme: 'graphite',
    accentColor: '#f24e1e',
    panelOrientation: 'vertical',
    motion: 'system',
    paneWidth: 600,
    railWidth: 208,
    aiDockWidth: 360,
    backgroundId: '',
    backgroundEffect: 'none',
    backgroundTarget: 'workspace',
    backgroundShowOn: 'all',
    backgroundEmptyOpacity: 31,
    backgroundContentOpacity: 19,
    backgroundBlur: 12,
    surfaceOpacity: 100,
    windowMaterial: 'none'
  },
  files: {
    vaultPath: '',
    recentFilesMax: 10,
    recentFiles: [],
    openTabs: [],
    activeTabPath: null,
    pinnedTabs: [],
    tabGroups: '[]',
    defaultNewFileContent: '',
    defaultNewFileName: 'Untitled.md'
  },
  export: {
    pdfMargin: 24,
    pdfPageSize: 'A4',
    pdfTheme: 'light'
  },
  ai: {
    enabled: true,
    autoAcceptEdits: false,
    maxOutputTokens: 0,
    providerId: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKeySet: false,
    historyTurns: 8,
    cachedModels: [],
    modelPreferences: {}
  },
  advanced: {
    enableMermaid: true,
    hardwareAcceleration: true
  },
  updates: {
    autoCheckForUpdates: true,
    lastSeenWhatsNewVersion: '',
    skippedVersion: ''
  },
  shortcuts: {
    bindings: {}
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
  'files.pinnedTabs': 'string',
  'shortcuts.bindings': 'string',
  'ai.cachedModels': 'string'
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
  'appearance.motion': ['system', 'full', 'reduced'],
  'appearance.panelOrientation': ['horizontal', 'vertical'],
  'appearance.backgroundEffect': ['none', 'haze', 'dither', 'ascii', 'halftone', 'scanlines'],
  'appearance.backgroundTarget': ['workspace'],
  'appearance.backgroundShowOn': ['all', 'empty'],
  'appearance.windowMaterial': ['none', 'mica', 'acrylic'],
  'ai.providerId': [
    'chatgpt',
    'opencode',
    'openai',
    'anthropic',
    'gemini',
    'openrouter',
    'deepseek',
    'groq',
    'mistral',
    'xai',
    'ollama',
    'lmstudio'
  ]
}

const NUMBER_BOUNDS: Record<string, readonly [number, number]> = {
  'appearance.designVersion': [1, 1],
  'appearance.themeHue': [0, 360],
  'appearance.themeSaturation': [0, 100],
  'appearance.themeDarkLightness': [0, 30],
  'appearance.paneWidth': [320, 10000],
  'appearance.railWidth': [160, 360],
  'appearance.aiDockWidth': [280, 640],
  'appearance.backgroundEmptyOpacity': [0, 100],
  'appearance.backgroundContentOpacity': [0, 100],
  'appearance.surfaceOpacity': [0, 100],
  'appearance.backgroundBlur': [0, 40],
  'ai.historyTurns': [0, 50],
  'ai.maxOutputTokens': [0, 131072]
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
      if (value === null || value === undefined) continue
      const fallback = (defaults as Record<string, unknown>)[key]
      if (dotted === 'ai.modelPreferences' && !validModelPreferences(value)) {
        problems.push(
          'ai.modelPreferences must contain valid per-model reasoning and service-tier choices'
        )
        continue
      }
      const bounds = NUMBER_BOUNDS[dotted]
      if (
        typeof value === 'number' &&
        (!Number.isFinite(value) || (bounds && (value < bounds[0] || value > bounds[1])))
      ) {
        problems.push(
          `${dotted} must be a finite number${bounds ? ` between ${bounds[0]} and ${bounds[1]}` : ''}`
        )
        continue
      }
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
