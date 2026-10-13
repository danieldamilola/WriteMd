import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { FileState, type FileStateData } from '../src/renderer/src/state/file-state'
import { SettingsStore } from '../src/renderer/src/state/settings'

vi.mock('../src/renderer/src/services/confirm', () => ({ showConfirm: async () => true }))

type Api = NonNullable<Window['electronAPI']>
const files = FileState.getInstance()
const initial = files.getState()
const read = vi.fn<(path: string) => Promise<{ content: string; mtime: number }>>(async () => ({
  content: 'Original',
  mtime: 1
}))
const write = vi.fn<(path: string, content: string) => Promise<{ mtime: number }>>(async () => ({
  mtime: 2
}))

beforeEach(() => {
  ;(files as unknown as { state: FileStateData }).state = { ...initial, tabs: [] }
  read.mockReset().mockResolvedValue({ content: 'Original', mtime: 1 })
  write.mockReset().mockResolvedValue({ mtime: 2 })
  window.electronAPI = {
    file: { read, write, watch: async () => undefined, unwatch: async () => undefined },
    settings: { set: async () => undefined },
    vault: { getPath: async () => 'C:/vault' }
  } as unknown as Api
  SettingsStore.getInstance().set('editor.autoSave', false)
  vi.spyOn(window, 'alert').mockImplementation(() => undefined)
})
afterEach(() => {
  ;(files as unknown as { clearAutoSaveTimer(): void }).clearAutoSaveTimer()
  delete window.electronAPI
})

it.each([false, true])('starts an AI write synchronously with autosave %s', async (autoSave) => {
  SettingsStore.getInstance().set('editor.autoSave', autoSave)
  SettingsStore.getInstance().set('editor.autoSaveDelay', 30000)
  await files.openFile('C:/vault/note.md')
  let finish!: (value: { mtime: number }) => void
  write.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const saving = files.applyAiEdit('C:/vault/note.md', 'Original', 'AI edit')
  expect(files.getState().content).toBe('AI edit')
  expect(write).toHaveBeenCalledWith('C:/vault/note.md', 'AI edit')
  expect(files.getState().dirty).toBe(true)
  finish({ mtime: 2 })
  expect(await saving).toBe(true)
  expect(files.getState().dirty).toBe(false)
})

it('keeps newer typing dirty and saves the captured file across a tab switch', async () => {
  await files.openFile('C:/vault/other.md')
  await files.openFile('C:/vault/note.md')
  let finish!: (value: { mtime: number }) => void
  let finishNewer!: (value: { mtime: number }) => void
  write.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  write.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishNewer = resolve
      })
  )
  const saving = files.applyAiEdit('C:/vault/note.md', 'Original', 'AI edit')
  files.setContent('Newer typing')
  files.switchTab(0)
  finish({ mtime: 2 })
  expect(await saving).toBe(true)
  expect(write.mock.calls).toEqual([
    ['C:/vault/note.md', 'AI edit'],
    ['C:/vault/note.md', 'Newer typing']
  ])
  expect(files.getState().path).toBe('C:/vault/other.md')
  expect(files.getState().tabs[1]).toMatchObject({
    content: 'Newer typing',
    originalContent: 'AI edit',
    dirty: true
  })
  finishNewer({ mtime: 3 })
  await vi.waitFor(() => expect(files.getState().tabs[1].originalContent).toBe('Newer typing'))
})

it('accepts an empty replacement and rejects an obsolete suggestion', async () => {
  await files.openFile('C:/vault/note.md')
  expect(await files.applyAiEdit('C:/vault/note.md', 'Stale', 'Overwrite')).toBe(false)
  expect(write).not.toHaveBeenCalled()
  expect(await files.applyAiEdit('C:/vault/note.md', 'Original', '')).toBe(true)
  expect(write).toHaveBeenCalledWith('C:/vault/note.md', '')
})

it('saves a secondary-only AI edit immediately with autosave off', async () => {
  await files.openFile('C:/vault/primary.md')
  await files.openSecondaryFile('C:/vault/split.md', 'Original')
  const saving = files.applyAiEdit('C:/vault/split.md', 'Original', 'AI edit')
  expect(files.getState().secondaryDoc?.content).toBe('AI edit')
  expect(write).toHaveBeenCalledWith('C:/vault/split.md', 'AI edit')
  expect(await saving).toBe(true)
  expect(files.getState().content).toBe('Original')
})

it('does not treat a secondary write echo as an external conflict', async () => {
  await files.openSecondaryFile('C:/vault/split.md', 'Original')
  let finish!: (value: { mtime: number }) => void
  write.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const saving = files.applyAiEdit('C:/vault/split.md', 'Original', '')
  read.mockResolvedValue({ content: '', mtime: 2 })
  await files.refreshFile('C:/vault/split.md')
  expect(files.getState().conflict).toBeNull()
  finish({ mtime: 2 })
  expect(await saving).toBe(true)
})

it('preserves unsaved text when an immediate write fails', async () => {
  await files.openFile('C:/vault/note.md')
  write.mockRejectedValueOnce(new Error('Read-only file'))
  expect(await files.applyAiEdit('C:/vault/note.md', 'Original', 'AI edit')).toBe(false)
  expect(files.getState()).toMatchObject({ content: 'AI edit', dirty: true })
})

it('refreshes a background tab and matching split pane without stealing focus', async () => {
  await files.openFile('C:/vault/background.md')
  await files.openFile('C:/vault/active.md')
  await files.openSecondaryFile('C:/vault/background.md', 'Original')
  read.mockResolvedValue({ content: 'External update', mtime: 2 })
  await files.refreshFile('C:\\vault\\background.md')
  expect(files.getState().tabs[0].content).toBe('External update')
  expect(files.getState().secondaryDoc?.content).toBe('External update')
  expect(files.getState().path).toBe('C:/vault/active.md')
})

it('ignores an older refresh that finishes after a newer one', async () => {
  await files.openFile('C:/vault/note.md')
  let finish!: (value: { content: string; mtime: number }) => void
  read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const older = files.refreshFile('C:/vault/note.md')
  read.mockResolvedValue({ content: 'Latest', mtime: 3 })
  await files.refreshFile('C:/vault/note.md')
  finish({ content: 'Obsolete', mtime: 2 })
  await older
  expect(files.getState().content).toBe('Latest')
})

it('refreshes an external undo that returns to an earlier saved version', async () => {
  await files.openFile('C:/vault/note.md')
  await files.applyAiEdit('C:/vault/note.md', 'Original', 'Saved version')
  read.mockResolvedValue({ content: 'Side-panel edit', mtime: 3 })
  await files.refreshFile('C:/vault/note.md')
  read.mockResolvedValue({ content: 'Saved version', mtime: 4 })
  await files.refreshFile('C:/vault/note.md')
  expect(files.getState().content).toBe('Saved version')
})

it('preserves dirty typing and raises a conflict on external changes', async () => {
  await files.openFile('C:/vault/note.md')
  files.setContent('Unsaved typing')
  read.mockResolvedValue({ content: 'External update', mtime: 2 })
  await files.refreshFile('C:/vault/note.md')
  expect(files.getState().content).toBe('Unsaved typing')
  expect(files.getState().conflict?.diskContent).toBe('External update')
})
