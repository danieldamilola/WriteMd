import { describe, it, expect } from 'vitest'
import { FileState } from '../src/renderer/src/state/file-state'
import { SettingsStore } from '../src/renderer/src/state/settings'

describe('multi-tab file state', () => {
  const files = FileState.getInstance()
  const settings = SettingsStore.getInstance()

  it('opens each new file in its own tab with the latest active', async () => {
    const before = files.getState().tabs.length
    await files.newFile()
    await files.newFile()
    const s = files.getState()
    expect(s.tabs.length).toBe(before + 2)
    expect(s.activeTab).toBe(s.tabs.length - 1)
    expect(s.path).toBe(s.tabs[s.activeTab].path)
  })

  it('keeps per-tab buffers across switches', () => {
    const s0 = files.getState()
    const first = s0.tabs.length - 2
    const second = s0.tabs.length - 1
    files.switchTab(first)
    files.setContent('buffer of first tab')
    files.switchTab(second)
    expect(files.getState().content).not.toBe('buffer of first tab')
    files.switchTab(first)
    expect(files.getState().content).toBe('buffer of first tab')
    expect(files.getState().dirty).toBe(true)
  })

  it('opening an already-open path switches instead of duplicating', async () => {
    const s0 = files.getState()
    const count = s0.tabs.length
    const target = s0.tabs[0].path
    if (!target) return
    await files.openFile(target)
    const s1 = files.getState()
    expect(s1.tabs.length).toBe(count)
    expect(s1.activeTab).toBe(0)
  })

  it('closes clean tabs and persists the remainder', async () => {
    const s0 = files.getState()
    const last = s0.tabs.length - 1
    files.switchTab(last)
    files.setContent(files.getState().originalContent)
    await files.closeTab(last)
    const s1 = files.getState()
    expect(s1.tabs.length).toBe(s0.tabs.length - 1)
    expect(s1.activeTab).toBeLessThan(s1.tabs.length)
    expect(settings.get<string[]>('files.openTabs', [])).toEqual(
      s1.tabs.map((t) => t.path)
    )
  })
})
