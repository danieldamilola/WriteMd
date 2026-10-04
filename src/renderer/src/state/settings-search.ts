export type SettingsTab =
  'general' | 'appearance' | 'editor' | 'files' | 'shortcuts' | 'advanced' | 'ai' | 'about'

/** Human labels used both by the nav buttons and by search filtering. */
export const TAB_LABELS: Record<SettingsTab, string> = {
  general: 'General',
  appearance: 'Appearance',
  editor: 'Editor',
  files: 'Files',
  shortcuts: 'Shortcuts',
  advanced: 'Advanced',
  ai: 'AI Assistant',
  about: 'About'
}

/**
 * Section keywords: words that mean "this section is worth a look" even when
 * the exact setting lives somewhere else. Row labels are indexed separately in
 * SETTINGS_ROW_INDEX, which is what routes a search to the right section.
 */
export const SETTINGS_SEARCH_INDEX: Record<SettingsTab, string> = {
  general: 'general new files default file name untitled workspace',
  appearance:
    'appearance theme dark graphite nord midnight light paper dracula accent color font panel orientation horizontal vertical tabs side rail top bar design layout window full screen shell classic popup dialog modal beta',
  editor: 'editor font family size word wrap line numbers source mode highlight active line',
  files: 'files vault location path storage folder recent tabs open disk',
  shortcuts: 'shortcuts keyboard keys bindings commands rebind reset',
  advanced: 'advanced features mermaid diagrams export pdf page size theme margin paper a4 letter legal danger reset preferences factory defaults',
  ai: 'ai assistant provider model api key system prompt instructions web search opencode cli console login managed server nvidia ollama grok',
  about: 'about version updates release notes whats new auto check download restart install'
}

/**
 * Every labelled row in the panels, with the words that should find it. The
 * panels render lazily (only the active tab exists in the DOM), so search has
 * to know up front where a row lives: matching against rendered text alone
 * would send "auto save" to whichever section happened to be open, and
 * Auto-save lives under Files, not Editor.
 */
export interface SettingsRowEntry {
  tab: SettingsTab
  /** Label exactly as rendered, so a hit can be located in the DOM again. */
  label: string
  /** Extra words: descriptions, option values, synonyms. */
  terms: string
}

export const SETTINGS_ROW_INDEX: SettingsRowEntry[] = [
  {
    tab: 'general',
    label: 'Default file name',
    terms: 'new vault files name untitled'
  },
  {
    tab: 'appearance',
    label: 'Vertical tabs',
    terms: 'side rail top bar panel orientation layout'
  },
  {
    tab: 'appearance',
    label: 'New Design',
    terms: 'beta settings window full screen shell classic popup dialog modal'
  },
  {
    tab: 'editor',
    label: 'Font Size',
    terms: 'base size inter jetbrains mono'
  },
  {
    tab: 'editor',
    label: 'Word Wrap',
    terms: 'wrap lines width'
  },
  {
    tab: 'editor',
    label: 'Line Numbers',
    terms: 'gutter show source mode'
  },
  {
    tab: 'files',
    label: 'Vault Location',
    terms: 'storage folder path documents default change'
  },
  {
    tab: 'files',
    label: 'Auto-save',
    terms: 'automatically write modifications to disk timer'
  },
  {
    tab: 'shortcuts',
    label: 'Reset Shortcuts',
    terms: 'restore all bindings defaults rebind'
  },
  {
    tab: 'advanced',
    label: 'Enable Mermaid',
    terms: 'render diagrams live preview features'
  },
  {
    tab: 'advanced',
    label: 'PDF page size',
    terms: 'export paper a4 a5 letter legal tabloid'
  },
  {
    tab: 'advanced',
    label: 'PDF theme',
    terms: 'export color scheme light dark'
  },
  {
    tab: 'advanced',
    label: 'PDF margin',
    terms: 'export page millimeters'
  },
  {
    tab: 'advanced',
    label: 'Reset Preferences',
    terms: 'restore all options factory defaults danger zone'
  },
  {
    tab: 'ai',
    label: 'Provider',
    terms:
      'backend openai anthropic google gemini mistral groq openrouter opencode nvidia deepseek grok xai ollama local select'
  },
  { tab: 'ai', label: 'Web search', terms: 'ground answers keyless before sending' },
  {
    tab: 'ai',
    label: 'Model',
    terms: 'fetch list gpt claude llama suggestions grok'
  },
  { tab: 'ai', label: 'API Key', terms: 'secret stored locally password replace decrypt' },
  {
    tab: 'ai',
    label: 'Connect via Console',
    terms: 'login browser sign in opencode managed server'
  },
  {
    tab: 'ai',
    label: 'CLI path',
    terms: 'browse recheck opencode npm appdata not found'
  },
  { tab: 'ai', label: 'System Prompt', terms: 'instructions every request reset default' },
  { tab: 'about', label: 'WriteMd Desktop', terms: 'version unavailable' },
  {
    tab: 'about',
    label: 'Auto-check for updates',
    terms: 'quietly background check'
  },
  { tab: 'about', label: 'Release notes', terms: 'changed this version whats new' },
  { tab: 'about', label: 'Updates', terms: 'check download restart install ready' }
]

/** Split a query into words, ignoring punctuation and repeats. */
export function searchTokens(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))]
}

function includesAll(haystack: string, tokens: string[]): boolean {
  const h = haystack.toLowerCase()
  return tokens.every((t) => h.includes(t))
}

/** Tabs whose label or keywords contain every word of the query. */
export function searchSettingsTabs(query: string): SettingsTab[] {
  const all = Object.keys(TAB_LABELS) as SettingsTab[]
  const tokens = searchTokens(query)
  if (tokens.length === 0) return all
  return all.filter((t) => includesAll(`${TAB_LABELS[t]} ${SETTINGS_SEARCH_INDEX[t]}`, tokens))
}

/**
 * Rows matching the query, most specific first: a hit on the label itself
 * outranks a hit on the description or synonyms.
 */
export function searchSettingsRows(query: string): SettingsRowEntry[] {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return []
  const rows = SETTINGS_ROW_INDEX.filter((r) =>
    includesAll(`${r.label} ${r.terms}`, tokens)
  )
  const byLabel = rows.filter((r) => includesAll(r.label, tokens))
  return [...byLabel, ...rows.filter((r) => !byLabel.includes(r))]
}

/** The tab a query should open, preferring a matching row over a section. */
export function searchTargetTab(query: string): SettingsTab | undefined {
  return searchSettingsRows(query)[0]?.tab ?? searchSettingsTabs(query)[0]
}