import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { DEFAULT_SETTINGS, settingKeys } from '../src/shared/settings-schema'

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

const sources = walk(SRC)
const corpus = sources.map((f) => ({ file: f, text: readFileSync(f, 'utf-8') }))

/**
 * Keys that legitimately have no reader. Each one needs a reason, because the
 * default answer to "this setting does nothing" is a bug, not a decision.
 */
const NO_READER_ALLOWED = new Map<string, string>([
  [
    'appearance.designVersion',
    'migration sentinel; migrateDesign reads it as a property, not a dotted key'
  ],
  ['shortcuts.bindings', 'read by the settings UI only, which writes the map back'],
  ['files.openTabs', 'session restore input, persisted and read by FileState.restoreTabs'],
  ['files.activeTabPath', 'session restore input, persisted and read by FileState.restoreTabs'],
  ['files.recentFiles', 'persisted session state, read by the welcome screen and backlinks']
])

describe('settings schema', () => {
  const keys = settingKeys()

  it('produces a key for every entry in DEFAULT_SETTINGS', () => {
    const counted = Object.values(DEFAULT_SETTINGS).reduce(
      (n, section) => n + Object.keys(section as Record<string, unknown>).length,
      0
    )
    expect(keys).toHaveLength(counted)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('gives every key a non-empty default', () => {
    for (const key of keys) {
      const [section, name] = key.split('.')
      const value = (DEFAULT_SETTINGS as unknown as Record<string, Record<string, unknown>>)[
        section
      ]
      expect(value, `missing section for ${key}`).toBeDefined()
      expect(name in value, `missing default for ${key}`).toBe(true)
    }
  })

  /**
   * The bug this exists for: `SettingsModal` wrote `files.autoSave`,
   * `editor.lineNumbers` and `editor.wordWrap`, none of which were in the
   * schema or read by anything, so three visible toggles did nothing and CI was
   * green. A key nobody reads is a dead control.
   */
  it.each(keys)('%s has at least one reader outside the settings schema', (key) => {
    if (NO_READER_ALLOWED.has(key)) return
    const [section, name] = key.split('.')
    // A read looks like `get('section.name'` or `facet.of(...)` for the editor.
    const readerPattern = new RegExp(`['"\`]${section}\\.${name}['"\`]`)
    const hits = corpus.filter(
      (c) => !c.file.endsWith('settings-schema.ts') && readerPattern.test(c.text)
    )
    expect(
      hits.map((h) => h.file.replace(ROOT, '.')),
      `${key} is never read; the control would be a no-op`
    ).not.toHaveLength(0)
  })

  /**
   * The other half of the same bug: a writer using a key name that is not in
   * the schema writes straight into config.json, where `deepMerge` accepts it
   * and nothing ever complains.
   */
  it('has no dotted setting key outside the schema', () => {
    const known = new Set(keys)
    const literal = /['"`]([a-z]+\.[a-zA-Z]+)['"`]/g
    const suspects = new Map<string, Set<string>>()
    for (const { file, text } of corpus) {
      if (file.endsWith('settings-schema.ts')) continue
      for (const m of text.matchAll(literal)) {
        const candidate = m[1]
        // Only consider keys that look like settings: a known section prefix.
        const section = candidate.split('.')[0]
        if (
          ![
            'editor',
            'appearance',
            'files',
            'export',
            'advanced',
            'shortcuts',
            'ai',
            'preview'
          ].includes(section)
        ) {
          continue
        }
        if (known.has(candidate)) continue
        if (!suspects.has(candidate)) suspects.set(candidate, new Set())
        suspects.get(candidate)?.add(file.replace(ROOT, '.'))
      }
    }
    expect([...suspects.entries()].map(([k, files]) => `${k} in ${[...files].join(', ')}`)).toEqual(
      []
    )
  })
})
