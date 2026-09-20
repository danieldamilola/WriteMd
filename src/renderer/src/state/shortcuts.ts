/** App-level command registry: ids, defaults, binding parse/match. No DOM. */

export interface CommandDef {
  id: string
  title: string
  category: string
  /** Default binding like "Ctrl+P". Empty means unbound. */
  defaultBinding: string
  /** Extra bindings that also trigger the command, e.g. Ctrl++ for Ctrl+=. */
  aliases?: string[]
}

export const COMMANDS: CommandDef[] = [
  { id: 'new-file', title: 'New File', category: 'File', defaultBinding: 'Ctrl+N' },
  { id: 'open-file', title: 'Open File', category: 'File', defaultBinding: 'Ctrl+O' },
  { id: 'save', title: 'Save', category: 'File', defaultBinding: 'Ctrl+S' },
  { id: 'save-as', title: 'Save As', category: 'File', defaultBinding: 'Ctrl+Shift+S' },
  { id: 'export-pdf', title: 'Export PDF', category: 'File', defaultBinding: '' },
  { id: 'export-html', title: 'Export HTML', category: 'File', defaultBinding: '' },
  { id: 'quick-toggle', title: 'Toggle Reading / Live', category: 'View', defaultBinding: 'Ctrl+E' },
  { id: 'toggle-split', title: 'Toggle Split View', category: 'View', defaultBinding: 'Ctrl+Alt+S' },
  { id: 'split-files', title: 'Show Files Panel', category: 'View', defaultBinding: 'Ctrl+Shift+E' },
  { id: 'split-backlinks', title: 'Show Backlinks Panel', category: 'View', defaultBinding: 'Ctrl+Shift+B' },
  { id: 'split-ai', title: 'Show AI Panel', category: 'View', defaultBinding: 'Ctrl+Alt+A' },
  { id: 'open-settings', title: 'Open Settings', category: 'App', defaultBinding: 'Ctrl+,' },
  { id: 'command-palette', title: 'Command Palette', category: 'App', defaultBinding: 'Ctrl+P' },
  { id: 'zoom-in', title: 'Zoom In', category: 'View', defaultBinding: 'Ctrl+=', aliases: ['Ctrl++', 'Ctrl+Shift++'] },
  { id: 'zoom-out', title: 'Zoom Out', category: 'View', defaultBinding: 'Ctrl+-' },
  { id: 'zoom-reset', title: 'Reset Zoom', category: 'View', defaultBinding: 'Ctrl+0' }
]

export interface ParsedBinding {
  mod: boolean
  shift: boolean
  alt: boolean
  key: string
}

/** Parse "Ctrl+Shift+S" into parts. Returns null when no plain key is present. */
export function parseBinding(text: string): ParsedBinding | null {
  let rest = text.trim()
  // Trailing "+" means the plus key itself, as in "Ctrl++"
  let plusKey = false
  if (rest.endsWith('+') && rest.length > 1) {
    plusKey = true
    rest = rest.slice(0, -1)
  }
  const parts = rest
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0)
  let mod = false
  let shift = false
  let alt = false
  let key: string | null = null
  for (const part of parts) {
    if (part === 'ctrl' || part === 'control' || part === 'cmd' || part === 'meta') mod = true
    else if (part === 'shift') shift = true
    else if (part === 'alt' || part === 'option') alt = true
    else if (key === null) key = part
    else return null
  }
  if (key === null) {
    if (plusKey) key = '+'
    else return null
  }
  return { mod, shift, alt, key }
}

/** Canonical display form: "Ctrl+Shift+S". */
export function formatBinding(b: ParsedBinding): string {
  const key = b.key.length === 1 ? b.key.toUpperCase() : b.key
  return `${b.mod ? 'Ctrl+' : ''}${b.shift ? 'Shift+' : ''}${b.alt ? 'Alt+' : ''}${key}`
}

/** Normalize free text, returns null when invalid. */
export function normalizeBinding(text: string): string | null {
  const parsed = parseBinding(text)
  return parsed ? formatBinding(parsed) : null
}

export function bindingFromEvent(e: KeyboardEvent): ParsedBinding {
  return {
    mod: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey,
    key: e.key.toLowerCase()
  }
}

export function bindingsEqual(a: ParsedBinding, b: ParsedBinding): boolean {
  return a.mod === b.mod && a.shift === b.shift && a.alt === b.alt && a.key === b.key
}

/** Effective binding for a command id given user overrides. */
export function effectiveBinding(
  id: string,
  overrides: Record<string, string>
): ParsedBinding | null {
  const raw = overrides[id] ?? COMMANDS.find((c) => c.id === id)?.defaultBinding ?? ''
  if (!raw) return null
  return parseBinding(raw)
}

/** All bindings that trigger a command: primary plus aliases. */
export function effectiveBindings(id: string, overrides: Record<string, string>): ParsedBinding[] {
  const cmd = COMMANDS.find((c) => c.id === id)
  if (!cmd) return []
  const raws = [overrides[id] ?? cmd.defaultBinding, ...(overrides[id] ? [] : (cmd.aliases ?? []))]
  const out: ParsedBinding[] = []
  for (const raw of raws) {
    if (!raw) continue
    const parsed = parseBinding(raw)
    if (parsed) out.push(parsed)
  }
  return out
}

/** Id of another command using the same binding, if any. */
export function findConflict(
  id: string,
  binding: ParsedBinding,
  overrides: Record<string, string>
): string | null {
  for (const cmd of COMMANDS) {
    if (cmd.id === id) continue
    if (effectiveBindings(cmd.id, overrides).some((other) => bindingsEqual(binding, other))) {
      return cmd.id
    }
  }
  return null
}

/** Subsequence fuzzy match: all query chars appear in order in target. */
export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase().replace(/\s+/g, '')
  const t = target.toLowerCase()
  if (!q) return true
  let i = 0
  for (const ch of t) {
    if (ch === q[i]) i++
    if (i >= q.length) return true
  }
  return false
}

export function commandTitle(id: string): string {
  return COMMANDS.find((c) => c.id === id)?.title ?? id
}
