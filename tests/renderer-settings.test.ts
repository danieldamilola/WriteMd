import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SettingsStore, applySettingsToDOM } from '../src/renderer/src/state/settings'
import { DEFAULT_SETTINGS } from '../src/shared/settings-schema'

/**
 * `tests/settings.test.ts` covers `src/main/settings.ts`, a different module.
 * Nothing exercised the renderer's own store, which is why a settings toggle
 * could write a key name that no reader anywhere understood and CI stayed
 * green. `tests/settings-contract.test.ts` now guards the key names; this file
 * guards the store's behaviour.
 */
function freshStore(): SettingsStore {
  // getInstance is a singleton, so reach past it for an isolated instance.
  return new SettingsStore()
}

describe('SettingsStore', () => {
  let store: SettingsStore

  beforeEach(() => {
    store = freshStore()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-panel-orientation')
    document.documentElement.removeAttribute('style')
  })

  it('uses a contrasting theme surface for monochrome accent controls', () => {
    store.set('appearance.accentColor', '#ffffff')
    applySettingsToDOM(store)
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('var(--text)')
    expect(document.documentElement.style.getPropertyValue('--accent-text')).toBe(
      'var(--bg-elevated)'
    )
    store.set('appearance.accentColor', '#f2994a')
    applySettingsToDOM(store)
    expect(document.documentElement.style.getPropertyValue('--accent-text')).toBe(
      'var(--accent-ink-dark)'
    )
  })

  describe('get', () => {
    it('defaults to the Graphite theme with the red accent', () => {
      expect(store.get('appearance.theme', '')).toBe('graphite')
      expect(store.get('appearance.accentColor', '')).toBe('#f24e1e')
    })

    it('reads a nested key', () => {
      expect(store.get('editor.fontSize', 0)).toBe(DEFAULT_SETTINGS.editor.fontSize)
    })

    it('falls back for an unknown key rather than throwing', () => {
      expect(store.get('editor.nope', 'fallback')).toBe('fallback')
      expect(store.get('nope.nope.nope', 42)).toBe(42)
    })

    it('does not mistake a falsy stored value for missing', () => {
      store.set('appearance.accentColor', '')
      expect(store.get('appearance.accentColor', 'x')).toBe('')
      store.set('editor.autoSave', false)
      expect(store.get('editor.autoSave', true)).toBe(false)
    })
  })

  describe('set', () => {
    it('writes a nested key and leaves its siblings alone', () => {
      store.set('editor.fontSize', 21)
      expect(store.get('editor.fontSize', 0)).toBe(21)
      expect(store.get('editor.fontFamily', '')).toBe(DEFAULT_SETTINGS.editor.fontFamily)
    })

    it('notifies exact-key subscribers', () => {
      const seen: unknown[] = []
      store.subscribe('editor.fontSize', (v) => seen.push(v))
      store.set('editor.fontSize', 19)
      expect(seen).toEqual([19])
    })

    it('notifies section subscribers for a nested change', () => {
      const seen: unknown[] = []
      store.subscribe('editor', (v) => seen.push(v))
      store.set('editor.fontSize', 19)
      expect(seen).toHaveLength(1)
      expect((seen[0] as { fontSize: number }).fontSize).toBe(19)
    })

    it('stops notifying after unsubscribe', () => {
      const seen: unknown[] = []
      const off = store.subscribe('editor.fontSize', (v) => seen.push(v))
      store.set('editor.fontSize', 19)
      off()
      store.set('editor.fontSize', 20)
      expect(seen).toEqual([19])
    })

    it('does not notify a subscriber for a different section', () => {
      const seen: unknown[] = []
      store.subscribe('files.vaultPath', (v) => seen.push(v))
      store.set('editor.fontSize', 19)
      expect(seen).toEqual([])
    })

    it('accepts every key the schema declares', () => {
      // Guards against a key being added to the schema but never writable.
      store.set('editor.showLineNumbers', true)
      store.set('editor.wordWrap', false)
      store.set('editor.tabSize', 4)
      store.set('editor.autoSave', false)
      store.set('advanced.enableMermaid', false)
      expect(store.get('editor.showLineNumbers', false)).toBe(true)
      expect(store.get('editor.wordWrap', true)).toBe(false)
      expect(store.get('editor.tabSize', 0)).toBe(4)
      expect(store.get('editor.autoSave', true)).toBe(false)
      expect(store.get('advanced.enableMermaid', true)).toBe(false)
    })
  })

  describe('reset', () => {
    it('restores every default', () => {
      store.set('editor.fontSize', 30)
      store.set('appearance.theme', 'nord')
      store.reset()
      expect(store.get('editor.fontSize', 0)).toBe(DEFAULT_SETTINGS.editor.fontSize)
      expect(store.get('appearance.theme', '')).toBe(DEFAULT_SETTINGS.appearance.theme)
    })
  })

  describe('applySettingsToDOM', () => {
    it('writes the theme and panel orientation onto the document element', () => {
      store.set('appearance.theme', 'dracula')
      store.set('appearance.panelOrientation', 'vertical')
      applySettingsToDOM(store)
      expect(document.documentElement.getAttribute('data-theme')).toBe('dracula')
      expect(document.documentElement.getAttribute('data-panel-orientation')).toBe('vertical')
    })

    it('publishes editor metrics as CSS custom properties', () => {
      store.set('editor.fontSize', 18)
      store.set('editor.lineHeight', 2)
      applySettingsToDOM(store)
      const root = document.documentElement
      expect(root.style.getPropertyValue('--editor-font-size')).toBe('18px')
      expect(root.style.getPropertyValue('--editor-line-height')).toBe('2')
    })

    it('falls back to monochrome when no accent is set', () => {
      store.set('appearance.accentColor', '')
      applySettingsToDOM(store)
      expect(document.documentElement.style.getPropertyValue('--accent')).toBe('var(--text)')
    })

    it('uses the accent when one is set', () => {
      store.set('appearance.accentColor', '#ff00aa')
      applySettingsToDOM(store)
      expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#ff00aa')
    })

    it('does nothing when there is no document', () => {
      const original = globalThis.document
      // @ts-expect-error deliberately removing the global for this assertion
      delete globalThis.document
      try {
        expect(() => applySettingsToDOM(store)).not.toThrow()
      } finally {
        globalThis.document = original
      }
    })
  })

  describe('init', () => {
    it('falls back to defaults when the bridge is unavailable', async () => {
      await store.init()
      expect(store.get('editor.fontSize', 0)).toBe(DEFAULT_SETTINGS.editor.fontSize)
    })

    it('only loads once', async () => {
      const get = vi.fn()
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
        settings: { get, set: vi.fn() }
      }
      try {
        const s = freshStore()
        await s.init()
        await s.init()
        expect(get).toHaveBeenCalledTimes(1)
      } finally {
        delete (window as unknown as { electronAPI?: unknown }).electronAPI
      }
    })
  })
})
