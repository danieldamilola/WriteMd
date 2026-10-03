import { describe, expect, it } from 'vitest'
import { searchSettingsTabs } from '../src/renderer/src/state/settings-search'

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

  it('matches keywords without matching everything', () => {
    const tabs = searchSettingsTabs('mermaid')
    expect(tabs).toEqual(['advanced'])
  })

  it('returns no tabs when nothing matches', () => {
    expect(searchSettingsTabs('zzz-no-such-setting')).toEqual([])
  })
})
