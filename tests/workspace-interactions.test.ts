import { describe, it, expect, vi } from 'vitest'
import { placeTab } from '../src/renderer/src/state/tab-order'
import { paneGeometry } from '../src/renderer/src/state/workspace'
import { SettingsStore } from '../src/renderer/src/state/settings'
import { DEFAULT_SETTINGS, validatePatch } from '../src/shared/settings-schema'
import { chromeKey } from '../src/renderer/src/state/chrome-selector'
import { FileState } from '../src/renderer/src/state/file-state'

describe('tab placement by identity', () => {
  const tabs = [{ id: 'p', isPinned: true }, { id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('unpins and places the dragged tab without moving its old neighbor', () => {
    const result = placeTab(tabs, 'p', { section: 'ungrouped', beforeId: 'b' })
    expect(result.map((t) => t.id)).toEqual(['a', 'p', 'b', 'c'])
    expect(result[1].isPinned).toBe(false)
    expect(tabs[0].isPinned).toBe(true)
  })
  it('dropping before the next tab preserves order', () => {
    expect(placeTab(tabs, 'a', { section: 'ungrouped', beforeId: 'b' }).map((t) => t.id)).toEqual(
      tabs.map((t) => t.id)
    )
  })
  it('can enter an empty group and pin directly from another group', () => {
    const grouped = placeTab(tabs, 'a', { section: 'group', groupId: 'g' })
    expect(grouped.at(-1)).toMatchObject({ groupId: 'g' })
    const pinned = placeTab(grouped, 'a', { section: 'pinned', beforeId: 'p' })
    expect(pinned[0]).toMatchObject({ id: 'a', isPinned: true, groupId: null })
  })
})

describe('workspace allocation', () => {
  it('keeps shell selection stable on document edits and updates it for workspace changes', () => {
    const state = FileState.getInstance().getState()
    expect(chromeKey({ ...state, content: 'More typing' })).toBe(chromeKey(state))
    expect(chromeKey({ ...state, splitActive: !state.splitActive })).not.toBe(chromeKey(state))
    expect(chromeKey({ ...state, viewMode: 'source' })).not.toBe(
      chromeKey({ ...state, viewMode: 'reading' })
    )
  })
  it('clamps the rendered pane but restores its preferred width when space returns', () => {
    expect(paneGeometry(900, 700).width).toBe(575)
    expect(paneGeometry(1400, 700).width).toBe(700)
  })
  it('switches surfaces rather than overflowing a narrow window', () => {
    expect(paneGeometry(584, 600)).toMatchObject({ compact: true, width: 584 })
    expect(paneGeometry(645, 600)).toMatchObject({ compact: false, width: 320 })
  })
})

describe('settings lifecycle', () => {
  it('reset notifies exact and section subscribers and reapplies DOM state', () => {
    const store = new SettingsStore()
    // Vertical is the factory default now, so flip it first: reset is only
    // observable if the pre-reset value differs.
    store.set('appearance.panelOrientation', 'horizontal')
    const exact = vi.fn(),
      section = vi.fn()
    store.subscribe('appearance.panelOrientation', exact)
    store.subscribe('appearance', section)
    store.reset()
    expect(exact).toHaveBeenCalledExactlyOnceWith(DEFAULT_SETTINGS.appearance.panelOrientation)
    expect(section).toHaveBeenCalledTimes(1)
    expect(document.documentElement.dataset.panelOrientation).toBe('vertical')
  })
  it('serializes writes and persists the latest queued snapshot', async () => {
    let resolve: (() => void) | undefined
    const set = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((done) => {
            resolve = done
          })
      )
      .mockResolvedValue(undefined)
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { settings: { set } }
    try {
      const store = new SettingsStore()
      store.set('appearance.railWidth', 220)
      await Promise.resolve()
      store.set('appearance.railWidth', 230)
      store.set('appearance.railWidth', 240)
      expect(set).toHaveBeenCalledTimes(1)
      resolve?.()
      expect(await store.whenSaved()).toBe(true)
      expect(set).toHaveBeenCalledTimes(2)
      expect(set.mock.calls[1][0].appearance.railWidth).toBe(240)
    } finally {
      delete (window as unknown as { electronAPI?: unknown }).electronAPI
    }
  })
  it('surfaces persistence failure and allows retry', async () => {
    const set = vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined)
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { settings: { set } }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const store = new SettingsStore()
      store.set('appearance.surfaceOpacity', 80)
      expect(await store.whenSaved()).toBe(false)
      expect(store.saveError).toBe('Disk full')
      store.retrySave()
      expect(await store.whenSaved()).toBe(true)
    } finally {
      delete (window as unknown as { electronAPI?: unknown }).electronAPI
    }
  })
  it('rejects invalid workspace dimensions, opacity and effects at the IPC boundary', () => {
    const result = validatePatch({
      appearance: {
        railWidth: 9999,
        paneWidth: NaN,
        surfaceOpacity: -1,
        backgroundEffect: 'unknown',
        backgroundBlur: 41
      }
    })
    expect(result.problems).toHaveLength(5)
    expect(result.clean).toEqual({})
  })
})
