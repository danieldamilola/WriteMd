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
 * Searchable words per tab: labels, setting names, and option values shown in
 * each panel. The panels render lazily (only the active tab exists in the
 * DOM), so matching against rendered text can never find an unvisited tab -
 * "vertical" lives under Appearance while the panel shows General.
 */
export const SETTINGS_SEARCH_INDEX: Record<SettingsTab, string> = {
  general: 'general new files default file name untitled',
  appearance:
    'appearance theme dark graphite nord midnight light paper dracula accent color panel orientation horizontal vertical',
  editor:
    'editor font family size line height word wrap tab size auto save delay line numbers highlight active line',
  files:
    'files vault path recent files tabs open pdf page size theme margin export danger reset preferences',
  shortcuts: 'shortcuts keyboard keys bindings commands',
  advanced: 'advanced mermaid diagrams',
  ai: 'ai assistant provider model api key system prompt web search opencode cli console login',
  about: 'about version updates release notes whats new auto check'
}

/** Tabs whose label or keywords match the query. Pure for unit testing. */
export function searchSettingsTabs(query: string): SettingsTab[] {
  const all = Object.keys(TAB_LABELS) as SettingsTab[]
  const q = query.trim().toLowerCase()
  if (!q) return all
  return all.filter(
    (t) => TAB_LABELS[t].toLowerCase().includes(q) || SETTINGS_SEARCH_INDEX[t].includes(q)
  )
}
