import { describe, it, expect } from 'vitest'
import { validatePatch, DEFAULT_SETTINGS, settingKeys } from '../src/shared/settings-schema'
import { isAllowedExternalProtocol } from '../src/shared/external-url'

/** Keys the main process derives; they are readable but never settable. */
const DERIVED_KEYS = new Set(['ai.apiKeySet', 'ai.apiKeyUndecryptable'])

describe('validatePatch', () => {
  it('accepts a well-formed nested patch', () => {
    const { clean, problems } = validatePatch({ editor: { fontSize: 18, wordWrap: false } })
    expect(problems).toEqual([])
    expect(clean).toEqual({ editor: { fontSize: 18, wordWrap: false } })
  })

  it('drops an unknown section', () => {
    const { clean, problems } = validatePatch({ nope: { x: 1 } })
    expect(problems).toContain('unknown section: nope')
    expect(clean).toEqual({})
  })

  it('drops an unknown key and says so', () => {
    // This is the class of bug the guard test caught: `files.autoSave` and
    // `editor.lineNumbers` were written by the settings UI, accepted by
    // deepMerge, and read by nothing.
    const { clean, problems } = validatePatch({
      files: { autoSave: true },
      editor: { lineNumbers: true }
    })
    expect(problems).toEqual(['unknown key: files.autoSave', 'unknown key: editor.lineNumbers'])
    expect(clean).toEqual({})
  })

  it('rejects a value whose type disagrees with the default', () => {
    const { clean, problems } = validatePatch({ editor: { fontSize: 'big' } })
    expect(problems).toEqual(['editor.fontSize must be a number, got string'])
    expect(clean).toEqual({})
  })

  it('checks array element types', () => {
    const ok = validatePatch({ files: { recentFiles: ['a.md', 'b.md'] } })
    expect(ok.problems).toEqual([])

    const bad = validatePatch({ files: { recentFiles: [1, 2] } })
    expect(bad.problems[0]).toMatch(/files\.recentFiles must be an array of string/)
  })

  it('accepts every member of a string union', () => {
    for (const motion of ['system', 'full', 'reduced']) {
      const { clean, problems } = validatePatch({ appearance: { motion } })
      expect(problems).toEqual([])
      expect(clean).toEqual({ appearance: { motion } })
    }
  })

  it('rejects a string outside a union, which typeof alone let through', () => {
    // `appearance.motion` is a union, erased at runtime, so the type check was
    // satisfied by any string. A typo persisted and then resolved to "match the
    // system", which looks like the setting had been applied.
    const { clean, problems } = validatePatch({ appearance: { motion: 'fulll' } })
    expect(problems[0]).toBe('appearance.motion must be one of: system, full, reduced')
    expect(clean).toEqual({})
  })

  it('refuses to let a client set the derived api flags', () => {
    const { clean, problems } = validatePatch({
      ai: { apiKeySet: true, apiKeyUndecryptable: true }
    })
    expect(problems).toEqual([
      'ai.apiKeySet is derived and cannot be set',
      'ai.apiKeyUndecryptable is derived and cannot be set'
    ])
    expect(clean).toEqual({})
  })

  it('treats null and undefined as no-ops rather than errors', () => {
    const { clean, problems } = validatePatch({ editor: { fontSize: null } })
    expect(problems).toEqual([])
    expect(clean).toEqual({})
  })

  it('rejects non-object input', () => {
    expect(validatePatch(null).problems).toEqual(['patch is not an object'])
    expect(validatePatch([1, 2]).problems).toEqual(['patch is not an object'])
    expect(validatePatch('x').problems).toEqual(['patch is not an object'])
  })

  it('rejects a section that is not an object', () => {
    expect(validatePatch({ editor: 5 }).problems).toEqual(['editor is not an object'])
  })

  /**
   * Every key in the schema must be settable through `validatePatch`, or a
   * legitimate setting would silently stop persisting.
   */
  it('accepts every schema key with its default value', () => {
    for (const key of settingKeys()) {
      const [section, name] = key.split('.')
      const defaults = DEFAULT_SETTINGS as unknown as Record<string, Record<string, unknown>>
      const value = defaults[section][name]
      const patch = { [section]: { [name]: value } }
      if (DERIVED_KEYS.has(key)) {
        // Intentionally not settable; covered separately above.
        continue
      }
      const { problems } = validatePatch(patch)
      expect(problems, `${key} cannot be set`).toEqual([])
    }
  })
})

describe('isAllowedExternalProtocol', () => {
  it('permits only http, https and mailto', () => {
    expect(isAllowedExternalProtocol('https://example.com')).toBe(true)
    expect(isAllowedExternalProtocol('http://example.com')).toBe(true)
    expect(isAllowedExternalProtocol('mailto:a@b.c')).toBe(true)
  })

  it('refuses file:, custom schemes and bare paths', () => {
    expect(isAllowedExternalProtocol('file:///etc/passwd')).toBe(false)
    expect(isAllowedExternalProtocol('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalProtocol('vscode://x')).toBe(false)
    expect(isAllowedExternalProtocol('note.md')).toBe(false)
    expect(isAllowedExternalProtocol('')).toBe(false)
  })

  it('refuses a Windows path, whose drive letter parses as a scheme', () => {
    expect(isAllowedExternalProtocol('C:/Users/me/notes.md')).toBe(false)
  })
})
