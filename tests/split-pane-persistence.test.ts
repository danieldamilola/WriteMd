import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * The split pane writes to disk now, so its teardown paths are the ones that can
 * lose a file's edits.
 *
 * Three things used to go wrong, all covered below: closing the pane cancelled
 * the debounce without writing, opening another file in it dropped the outgoing
 * document without a word, and its file had no watcher, so the new autosave
 * overwrote edits made outside the app with nothing on screen to say so.
 */
const writes: Array<{ path: string; content: string }> = []
const watched: string[] = []
/** Every change listener the store has registered, across all installed APIs. */
const changeListeners: Array<(path: string) => void> = []

vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'writemd-split-persistence-test') },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => s }
}))

let confirmAnswer = true
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
      watch: async (path: string): Promise<void> => {
        watched.push(path)
      },
      unwatch: async (): Promise<void> => undefined,
      onChanged: (cb: (path: string) => void): (() => void) => {
        changeListeners.push(cb)
        return (): void => undefined
      }
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

/** Deliver a file-changed event to whichever listener the store registered. */
function emitChanged(path: string): Promise<void> {
  for (const listener of changeListeners) listener(path)
  return tick(30)
}

// Installed before `FileState.getInstance()` is ever called, because the store
// subscribes to the change channel once in its constructor and never again.
installApi()

function openAt(files: FileState, path: string, content = ''): number {
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

/**
 * Unique per test. FileState is a singleton that keeps its tabs for the life of
 * the process, so a path reused by two tests silently inherits the first one's
 * tab state.
 */
let n = 0
let A = ''
let B = ''
const nextPaths = (): void => {
  n += 1
  A = `C:/vault/m${n}-a.md`
  B = `C:/vault/m${n}-b.md`
}

describe('split pane persistence', () => {
  const files = FileState.getInstance()
  const settings = SettingsStore.getInstance()

  beforeEach(async () => {
    nextPaths()
    writes.length = 0
    watched.length = 0
    confirmAnswer = true
    settings.set('editor.autoSave', false)
    settings.set('editor.autoSaveDelay', 40)
    files.closeSecondaryFile()
    await tick(60)
    writes.length = 0
  })

  afterEach(() => {
    clearWindow()
    installApi()
  })

  it('writes a dirty split document to its own path when the pane closes', async () => {
    openAt(files, A, 'original')
    await files.openSecondaryFile(B, 'pane content')
    files.setSecondaryContent('edited in the pane')
    files.closeSecondaryFile()
    await tick(60)
    expect(writes).toEqual([{ path: B, content: 'edited in the pane' }])
  })

  it('renames the split document without changing a different primary document', async () => {
    const index = openAt(files, A, 'primary')
    files.switchTab(index)
    await files.openSecondaryFile(B, 'secondary')
    const bridge = window.electronAPI!
    bridge.file.exists = vi.fn(async () => true)
    bridge.file.rename = vi.fn(async () => true)
    expect(await files.renameFile('renamed-pane', true)).toBe(true)
    expect(files.getState().path).toBe(A)
    expect(files.getState().secondaryDoc?.path).toBe('C:/vault/renamed-pane.md')
    expect(bridge.file.rename).toHaveBeenCalledWith(B, 'C:/vault/renamed-pane.md')
    expect(watched).toContain('C:/vault/renamed-pane.md')
  })

  it('renaming a shared document updates both panes and preserves later save targets', async () => {
    const index = openAt(files, A, 'shared')
    files.switchTab(index)
    await files.openSecondaryFile(A, 'shared')
    window.electronAPI!.file.exists = vi.fn(async () => true)
    window.electronAPI!.file.rename = vi.fn(async () => true)
    expect(await files.renameFile('shared-renamed', true)).toBe(true)
    expect(files.getState().path).toBe('C:/vault/shared-renamed.md')
    expect(files.getState().secondaryDoc?.path).toBe('C:/vault/shared-renamed.md')
    files.setSecondaryContent('edited after rename')
    await files.save()
    expect(writes).toContainEqual({
      path: 'C:/vault/shared-renamed.md',
      content: 'edited after rename'
    })
  })

  it('moves the secondary file using the chosen directory while keeping primary edits', async () => {
    const index = openAt(files, A, 'primary')
    files.switchTab(index)
    await files.openSecondaryFile(B, 'secondary')
    files.setContent('primary edits')
    const bridge = window.electronAPI!
    bridge.dialog = {
      ...bridge.dialog,
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/destination'] }))
    }
    bridge.file.rename = vi.fn(async () => true)
    expect(await files.moveActiveFile(true)).toBe(true)
    expect(files.getState().path).toBe(A)
    expect(files.getState().content).toBe('primary edits')
    expect(files.getState().secondaryDoc?.path).toBe(`C:/destination/${B.split('/').at(-1)}`)
  })

  it('asks before discarding a dirty split document, and keeps it when refused', async () => {
    openAt(files, A, 'original')
    await files.openSecondaryFile(B, 'pane content')
    files.setSecondaryContent('work in progress')
    confirmAnswer = false
    await files.openSecondaryFile('C:/vault/split-c.md', 'other')
    await tick(60)
    // The pane still holds the document the user asked to keep.
    expect(files.getState().secondaryDoc?.path).toBe(B)
    expect(files.getState().secondaryDoc?.content).toBe('work in progress')
    expect(writes).toEqual([])
  })

  it('flushes the outgoing split document when the user does discard it', async () => {
    openAt(files, A, 'original')
    await files.openSecondaryFile(B, 'pane content')
    files.setSecondaryContent('work in progress')
    confirmAnswer = true
    await files.openSecondaryFile('C:/vault/split-d.md', 'other')
    await tick(60)
    expect(writes).toContainEqual({ path: B, content: 'work in progress' })
    expect(files.getState().secondaryDoc?.path).toBe('C:/vault/split-d.md')
  })

  it('watches the split document, since the pane can now write to it', async () => {
    await files.openSecondaryFile(B, 'pane content')
    expect(watched).toContain(B)
  })

  it('raises a conflict when the split file changes underneath a dirty pane', async () => {
    await files.openSecondaryFile(B, 'pane content')
    files.setSecondaryContent('edited in the pane')
    await emitChanged(B)
    // The edit is still in the pane and the conflict is on screen, rather than
    // the autosave quietly overwriting whatever the other app wrote.
    expect(files.getState().secondaryDoc?.content).toBe('edited in the pane')
    expect(files.getState().conflict?.path).toBe(B)
    expect(writes).toEqual([])
  })

  it('mirrors a same-file edit into the tab instead of writing it twice', async () => {
    const idx = openAt(files, A, 'original')
    files.switchTab(idx)
    await files.openSecondaryFile(A, 'original')
    files.setSecondaryContent('edited once')
    await tick(60)
    // The tab owns persistence for this path, so there is nothing for the pane
    // to write on its own.
    expect(writes).toEqual([])
    expect(files.getState().tabs[idx].content).toBe('edited once')
  })
})

describe('conflict merge stays on its own document', () => {
  const files = FileState.getInstance()
  const settings = SettingsStore.getInstance()

  beforeEach(async () => {
    nextPaths()
    writes.length = 0
    confirmAnswer = true
    settings.set('editor.autoSave', false)
    files.closeSecondaryFile()
    await tick(60)
    writes.length = 0
  })

  afterEach(() => {
    clearWindow()
    installApi()
  })

  it('refuses to switch tabs while a tab merge is open', async () => {
    const idxA = openAt(files, A, 'a')
    const idxB = openAt(files, B, 'b')
    files.switchTab(idxA)
    files.raiseConflict({ path: A, diskContent: 'a from disk', diskMtime: 2 })
    files.resolveConflictReview()
    files.switchTab(idxB)
    expect(files.getState().activeTab).toBe(idxA)
    void idxB
  })

  it('writes the merge to the tab it was raised against, not the active one', async () => {
    const idxA = openAt(files, A, 'a')
    const idxB = openAt(files, B, 'b')
    files.switchTab(idxA)
    files.raiseConflict({ path: A, diskContent: 'a from disk', diskMtime: 2 })
    files.resolveConflictReview()
    files.setSecondaryContent('merged a')
    await tick(60)
    expect(writes).toEqual([{ path: A, content: 'merged a' }])
    expect(writes.some((w) => w.path === B)).toBe(false)
    void idxB
  })

  it('merges the split document when the conflict was raised against the pane', async () => {
    openAt(files, A, 'a')
    await files.openSecondaryFile(B, 'pane original')
    files.setSecondaryContent('pane edited')
    files.raiseConflict({ path: B, diskContent: 'b from disk', diskMtime: 2 })
    files.resolveConflictReview()
    // The merge view holds the pane's text, not the tab's.
    expect(files.getState().secondaryDoc?.content).toBe('pane edited')
    expect(files.getState().secondaryDoc?.mergeTarget).toBe('secondary')
    files.setSecondaryContent('merged pane')
    await tick(60)
    expect(writes).toEqual([{ path: B, content: 'merged pane' }])
    expect(writes.some((w) => w.path === A)).toBe(false)
  })

  it('reloads the split document when the conflict was raised against the pane', async () => {
    openAt(files, A, 'a')
    await files.openSecondaryFile(B, 'pane original')
    files.setSecondaryContent('pane edited')
    files.raiseConflict({ path: B, diskContent: 'b from disk', diskMtime: 2 })
    // Reload without Review: the two are alternative buttons in the dialog, so
    // this is the sequence a user can actually produce.
    files.resolveConflictReload()
    expect(files.getState().secondaryDoc?.content).toBe('b from disk')
    expect(files.getState().secondaryDoc?.dirty).toBe(false)
    // The tab was never involved, so it keeps its own text.
    expect(files.getState().tabs.find((t) => t.path === A)?.content).toBe('a')
  })

  it('reloads the tab when the conflict was raised against the tab', async () => {
    const idx = openAt(files, A, 'a')
    files.switchTab(idx)
    files.raiseConflict({ path: A, diskContent: 'a from disk', diskMtime: 2 })
    files.resolveConflictReload()
    expect(files.getState().tabs[idx].content).toBe('a from disk')
    expect(files.getState().conflict).toBeNull()
  })
})
