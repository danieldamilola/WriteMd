import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * The autosave debounce used to capture nothing about which tab it was armed
 * for, while `save()` re-resolves the active tab when the timer fires. Editing
 * tab A and switching to tab B inside the debounce window therefore wrote B's
 * content to B's path and dropped A's edits. These tests pin the tab binding
 * by observing which path actually reaches `file.write`.
 */
const writes: Array<{ path: string; content: string }> = []

vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'writemd-autosave-test') },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => s }
}))

// Stubbed rather than DOM-faked: closeTab's confirmation is a UI concern, and
// faking enough document to render a Lit component is where this test would go
// wrong. `confirmAnswer` is what the user would click.
let confirmAnswer = false
vi.mock('../src/renderer/src/services/confirm', () => ({
  showConfirm: (): Promise<boolean> => Promise.resolve(confirmAnswer)
}))

import { FileState } from '../src/renderer/src/state/file-state'
import { SettingsStore } from '../src/renderer/src/state/settings'

type Api = NonNullable<Window['electronAPI']>

function installApi(): void {
  const api = {
    file: {
      read: async (): Promise<{ content: string; mtime: number }> => ({ content: '', mtime: 1 }),
      write: async (path: string, content: string): Promise<{ mtime: number }> => {
        writes.push({ path, content })
        return { mtime: 1 }
      },
      unwatch: async (): Promise<void> => undefined,
      onChanged: () => (): void => undefined
    },
    vault: { getPath: async (): Promise<string> => 'C:/vault' },
    settings: {
      get: async (): Promise<Record<string, never>> => ({}) as Record<string, never>,
      set: async (): Promise<void> => undefined
    },
    onFileOpenExternal: () => (): void => undefined
  } as unknown as Api
  ;(globalThis as { window?: { electronAPI?: Api } }).window = { electronAPI: api }
}

function clearWindow(): void {
  delete (globalThis as { window?: unknown }).window
}

/** Open a tab at a known path and return its index. */
function openAt(files: FileState, path: string, content = ''): number {
  // openTab is private, but it is the only path to seed a tab with a known
  // path without touching real disk, so reach it explicitly rather than
  // casting the whole instance away.
  const open = (
    files as unknown as {
      openTab: (tab: {
        path: string
        content: string
        originalContent: string
        mtime: number
        dirty: boolean
        isVaultFile: boolean
      }) => void
    }
  ).openTab.bind(files)
  open({
    path,
    content,
    originalContent: content,
    mtime: 1,
    dirty: false,
    isVaultFile: true
  })
  return files.getState().tabs.findIndex((t) => t.path === path)
}

const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('autosave debounce is bound to one tab', () => {
  const files = FileState.getInstance()
  const settings = SettingsStore.getInstance()

  beforeEach(() => {
    writes.length = 0
    confirmAnswer = false
    settings.set('editor.autoSave', true)
    settings.set('editor.autoSaveDelay', 40)
  })

  afterEach(() => {
    clearWindow()
  })

  it('writes the edited tab to its own path after the debounce', async () => {
    installApi()
    const idxA = openAt(files, 'C:/vault/tab-a.md')
    const idxB = openAt(files, 'C:/vault/tab-b.md')
    files.switchTab(idxA)
    files.setContent('content that belongs in A')
    await tick(200)
    expect(writes).toEqual([{ path: 'C:/vault/tab-a.md', content: 'content that belongs in A' }])
    void idxB
  })

  // The regression: a switch inside the debounce window used to redirect the
  // write to the newly-active tab, silently discarding the original edit. It
  // also used to simply drop the timer, which left the edit sitting dirty in a
  // buffer with nothing scheduled to save it. So the write has to happen, and it
  // has to be A's content going to A's path.
  it('writes tab A to its own path when the user switches away mid-debounce', async () => {
    installApi()
    const idxA = openAt(files, 'C:/vault/switch-a.md')
    const idxB = openAt(files, 'C:/vault/switch-b.md')
    files.switchTab(idxA)
    files.setContent('edit made in A only')
    files.switchTab(idxB)
    await tick(200)
    expect(writes).toEqual([{ path: 'C:/vault/switch-a.md', content: 'edit made in A only' }])
    // The invariant this test exists for: B's path is never written.
    expect(writes.some((w) => w.path === 'C:/vault/switch-b.md')).toBe(false)
    const tabA = files.getState().tabs[idxA]
    expect(tabA.content).toBe('edit made in A only')
    expect(tabA.dirty).toBe(false)
  })

  it('writes nothing when switching a clean tab', async () => {
    installApi()
    const idxA = openAt(files, 'C:/vault/clean-a.md')
    const idxB = openAt(files, 'C:/vault/clean-b.md')
    files.switchTab(idxA)
    files.switchTab(idxB)
    await tick(200)
    expect(writes).toEqual([])
  })

  // The user dismissed the confirm, so the tab stays open and dirty. The
  // pending debounce must not fire and save it behind the user's back.
  it('does not write a dirty tab the user declined to close', async () => {
    installApi()
    confirmAnswer = false
    const idx = openAt(files, 'C:/vault/declined.md')
    files.setContent('edit the user wants to keep')
    await files.closeTab(idx)
    await tick(200)
    expect(writes).toEqual([])
    expect(files.getState().tabs[idx].dirty).toBe(true)
  })

  it('does not write a dirty tab that was closed anyway', async () => {
    installApi()
    confirmAnswer = true
    const idx = openAt(files, 'C:/vault/forced.md')
    files.setContent('edit then discarded')
    await files.closeTab(idx)
    await tick(200)
    expect(writes).toEqual([])
    expect(files.getState().tabs.find((t) => t.path === 'C:/vault/forced.md')).toBeUndefined()
  })

  it('coalesces repeated edits into a single write', async () => {
    installApi()
    openAt(files, 'C:/vault/coalesce.md')
    files.setContent('a')
    files.setContent('ab')
    files.setContent('abc')
    await tick(200)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toEqual({ path: 'C:/vault/coalesce.md', content: 'abc' })
  })

  it('clears the dirty flag on the tab it saved', async () => {
    installApi()
    const idx = openAt(files, 'C:/vault/clean.md')
    files.setContent('now on disk')
    await tick(200)
    expect(files.getState().tabs[idx].dirty).toBe(false)
  })
})
