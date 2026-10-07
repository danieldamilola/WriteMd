import { describe, expect, it } from 'vitest'
import {
  searchSettingsRows,
  searchSettingsTabs,
  searchTargetTab,
  searchTokens
} from '../src/renderer/src/state/settings-search'

describe('searchSettingsTabs', () => {
  it('returns every tab on an empty query', () => {
    expect(searchSettingsTabs('')).toHaveLength(8)
    expect(searchSettingsTabs('   ')).toHaveLength(8)
  })

  it('finds Appearance from an unvisited setting value', () => {
    // Regression: panels render lazily, so matching rendered text could never
    // find "vertical" (appearance.panelOrientation) from the General panel.
    expect(searchSettingsTabs('vertical')).toEqual(['appearance'])
  })

  it('matches labels case-insensitively', () => {
    expect(searchSettingsTabs('AI')).toContain('ai')
    expect(searchSettingsTabs('short')).toEqual(['shortcuts'])
  })

  it('finds renamed categories and keeps the previous General search term', () => {
    expect(searchTargetTab('new notes')).toBe('general')
    expect(searchTargetTab('general')).toBe('general')
    expect(searchTargetTab('keyboard shortcuts')).toBe('shortcuts')
    expect(searchTargetTab('about writemd')).toBe('about')
  })

  it('matches keywords without matching everything', () => {
    const tabs = searchSettingsTabs('mermaid')
    expect(tabs).toEqual(['advanced'])
  })

  it('returns no tabs when nothing matches', () => {
    expect(searchSettingsTabs('zzz-no-such-setting')).toEqual([])
  })

  it('requires every word of a multi-word query', () => {
    expect(searchSettingsTabs('vault disk')).toEqual(['files'])
    expect(searchSettingsTabs('page size')).toEqual(['advanced'])
    // Words in one section cannot be borrowed from another.
    expect(searchSettingsTabs('vault zzz-no-such-setting')).toEqual([])
  })
})

describe('searchTokens', () => {
  it('drops punctuation and repeated words', () => {
    expect(searchTokens('Auto auto-save!')).toEqual(['auto', 'save'])
    expect(searchTokens('   ')).toEqual([])
  })
})

describe('searchSettingsRows', () => {
  it('routes auto save to the row that owns it, not to Editor', () => {
    // Regression: the section index listed "auto save" under editor, so the
    // search jumped to a panel with no such row.
    const rows = searchSettingsRows('auto auto save')
    expect(rows).toHaveLength(1)
    expect(rows[0].tab).toBe('files')
    expect(rows[0].label).toBe('Auto-save')
  })

  it('finds rows by description and option values', () => {
    expect(searchSettingsRows('a4').map((r) => r.label)).toContain('PDF page size')
    expect(searchSettingsRows('grok').map((r) => r.label)).toContain('Provider')
  })

  it('ranks label hits above description hits', () => {
    const rows = searchSettingsRows('model')
    expect(rows[0].label).toBe('Model')
  })

  it('returns nothing for an empty query or a miss', () => {
    expect(searchSettingsRows('')).toEqual([])
    expect(searchSettingsRows('zzz-no-such-setting')).toEqual([])
  })

  it('indexes a row for every non-dynamic panel setting', () => {
    const labels = searchSettingsRows('').length
    expect(labels).toBe(0)
    expect(searchSettingsRows('word wrap')[0].tab).toBe('editor')
    expect(searchSettingsRows('vault')[0].tab).toBe('files')
    expect(searchSettingsRows('motion')[0].tab).toBe('appearance')
    expect(searchSettingsRows('beta')).toEqual([])
    expect(searchSettingsRows('system prompt')[0].tab).toBe('ai')
    expect(searchSettingsRows('release notes')[0].tab).toBe('about')
  })
})

describe('searchTargetTab', () => {
  it('prefers the tab holding a matching row', () => {
    expect(searchTargetTab('auto save')).toBe('files')
    expect(searchTargetTab('font size')).toBe('editor')
  })

  it('falls back to section keywords', () => {
    expect(searchTargetTab('nord')).toBe('appearance')
  })

  it('returns nothing when nothing matches', () => {
    expect(searchTargetTab('zzz-no-such-setting')).toBeUndefined()
  })
})
