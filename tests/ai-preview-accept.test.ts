import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeTempRoot, cleanupTempRoot } from './helpers/temp-root'
import type { RunTurnRequest, TurnEvent } from '../src/main/ai/turn'
import type { FileChangeSnapshot, FileReadResult, PreviewChangeView } from '../src/shared/electron-api'
import { FileState, type FileStateData } from '../src/renderer/src/state/file-state'

const mocks = vi.hoisted(() => ({
  root: '',
  run: vi.fn<(request: RunTurnRequest) => AsyncGenerator<TurnEvent>>()
}))
vi.mock('electron', () => ({ app: { getPath: () => mocks.root } }))
vi.mock('../src/main/settings', () => ({
  getSettings: () => ({
    ai: {
      enabled: true,
      providerId: 'lmstudio',
      baseUrl: 'http://localhost:1234/v1',
      model: 'test',
      historyTurns: 0
    }
  })
}))
vi.mock('../src/main/vault', () => ({ getVaultPath: () => join(mocks.root, 'vault') }))
vi.mock('../src/main/ai/key-store', () => ({ getApiKey: () => '' }))
vi.mock('../src/main/ai/turn', () => ({ runTurn: mocks.run }))
// The renderer half of this event lives in FileState, which pulls the confirm
// service in transitively; that service lazily imports a Lit element.
vi.mock('../src/renderer/src/services/confirm', () => ({ showConfirm: async () => true }))

import {
  acceptPreview,
  cancelAll,
  getJournal,
  setEventEmitter,
  setFileChangeEmitter,
  startTurn
} from '../src/main/ai/service'
import { canAccessPath, resetRegisteredPaths } from '../src/main/path-guard'

beforeAll(() => {
  mocks.root = makeTempRoot('ai-preview-accept')
  mkdirSync(join(mocks.root, 'vault'))
})
beforeEach(() => mocks.run.mockReset())
afterEach(() => {
  cancelAll()
  setEventEmitter(null)
  setFileChangeEmitter(null)
  resetRegisteredPaths()
})
afterAll(() => cleanupTempRoot(mocks.root))

async function suggest(
  path: string,
  original = 'Original',
  content = 'Revised',
  kind: PreviewChangeView['kind'] = 'modified'
): Promise<string> {
  const changes: PreviewChangeView[] = []
  setEventEmitter((event) => {
    if (event.type === 'preview') changes.push(...(event.changes as PreviewChangeView[]))
  })
  mocks.run.mockImplementation(async function* () {
    yield { type: 'preview', changes: [{ path, original, content, kind }], skipped: [] }
    yield { type: 'done', text: 'Review this change.' }
  })
  await startTurn('request', {
    previewOnly: true,
    sessionId: 'session',
    userText: `Edit ${path}`,
    document: null,
    selection: null,
    references: [],
    attachments: [],
    openPaths: []
  })
  return changes[0].previewId!
}

it('accepts an external proposal, grants access to that exact file, and supports undo', async () => {
  const changed = vi.fn()
  setFileChangeEmitter(changed)
  const path = join(mocks.root, 'external.md')
  writeFileSync(path, 'Original')
  const id = await suggest(path)
  expect(canAccessPath(path)).toBe(false)
  expect(readFileSync(path, 'utf8')).toBe('Original')
  const change = await acceptPreview(id)
  expect(change).toMatchObject({ path, kind: 'modified' })
  expect(readFileSync(path, 'utf8')).toBe('Revised')
  expect(changed).toHaveBeenCalledExactlyOnceWith(
    path,
    // The committed text rides along with the path, so the editor can update
    // without reading the file back. `mtime` is the stat taken after the write.
    expect.objectContaining({ before: 'Original', content: 'Revised', mtime: expect.any(Number) })
  )
  expect(canAccessPath(path)).toBe(true)
  expect(canAccessPath(join(mocks.root, 'other.md'))).toBe(false)
  expect(getJournal().undo(change!.id).status).toBe('restored')
  expect(readFileSync(path, 'utf8')).toBe('Original')
  await expect(acceptPreview(id)).rejects.toThrow('expired')
})

it('keeps a newer disk edit when accepting a stale external proposal', async () => {
  const path = join(mocks.root, 'stale.md')
  writeFileSync(path, 'Original')
  const id = await suggest(path)
  writeFileSync(path, 'Newer edit')
  await expect(acceptPreview(id)).rejects.toThrow('changed on disk')
  expect(readFileSync(path, 'utf8')).toBe('Newer edit')
  expect(canAccessPath(path)).toBe(false)
})

it('creates an accepted external Markdown file and undo removes it', async () => {
  const path = join(mocks.root, 'new.markdown')
  const id = await suggest(path, '', 'New note', 'created')
  expect(existsSync(path)).toBe(false)
  const change = await acceptPreview(id)
  expect(change).toMatchObject({ path, kind: 'created' })
  expect(readFileSync(path, 'utf8')).toBe('New note')
  expect(getJournal().undo(change!.id).status).toBe('gone')
  expect(existsSync(path)).toBe(false)
})

it('rejects a fabricated proposal id and a non-Markdown proposal', async () => {
  await expect(acceptPreview('fabricated')).rejects.toThrow('expired')
  const path = join(mocks.root, 'config.json')
  writeFileSync(path, 'Original')
  await expect(acceptPreview(await suggest(path))).rejects.toThrow('path changed')
  expect(readFileSync(path, 'utf8')).toBe('Original')
})

it('rejects an external proposal whose path was replaced by a symlink', async () => {
  const path = join(mocks.root, 'moved.md')
  const target = join(mocks.root, 'target.md')
  writeFileSync(path, 'Original')
  writeFileSync(target, 'Original')
  const id = await suggest(path)
  unlinkSync(path)
  try {
    symlinkSync(target, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
    return
  }
  await expect(acceptPreview(id)).rejects.toThrow('path changed')
  expect(readFileSync(target, 'utf8')).toBe('Original')
})

it('expires a prior suggestion when the session sends another request', async () => {
  const path = join(mocks.root, 'expired.md')
  writeFileSync(path, 'Original')
  const first = await suggest(path)
  await suggest(path)
  await expect(acceptPreview(first)).rejects.toThrow('expired')
  expect(readFileSync(path, 'utf8')).toBe('Original')
})

/**
 * The renderer's half of the same event.
 *
 * Main emits `(path, snapshot)` where `snapshot.content` is what it just wrote,
 * and FileState.refreshFile takes that snapshot straight. Reading the file back
 * would be a round trip that lands after the user's next keystroke, so the
 * committed text is already known and asking the disk for it is the one thing
 * worth not doing.
 */
describe('editor notification for an accepted edit', () => {
  const files = FileState.getInstance()
  const initial = files.getState()
  const read = vi.fn<(path: string) => Promise<FileReadResult>>(async () => ({
    content: 'Original',
    mtime: 1
  }))
  const snapshot: FileChangeSnapshot = { before: 'Original', content: 'AI edit', mtime: 2 }

  beforeEach(() => {
    ;(files as unknown as { state: FileStateData }).state = { ...initial, tabs: [] }
    read.mockReset().mockResolvedValue({ content: 'Original', mtime: 1 })
    window.electronAPI = {
      file: { read, write: async () => ({ mtime: 2 }), watch: async () => undefined, unwatch: async () => undefined },
      settings: { set: async () => undefined },
      vault: { getPath: async () => 'C:/vault' }
    } as unknown as NonNullable<Window['electronAPI']>
  })
  afterEach(() => {
    ;(files as unknown as { clearAutoSaveTimer(): void }).clearAutoSaveTimer()
    delete window.electronAPI
  })

  it('shows the committed text before the notification resolves and never reads the file', async () => {
    await files.openFile('C:/vault/note.md')
    read.mockClear()
    const refreshing = files.refreshFile('C:/vault/note.md', snapshot)
    // Asserted before awaiting on purpose. If refreshFile fell back to
    // file.read, the buffer would still hold the old text at this point and the
    // read would be on the wire.
    expect(files.getState().content).toBe('AI edit')
    expect(read).not.toHaveBeenCalled()
    await refreshing
    expect(read).not.toHaveBeenCalled()
    expect(files.getState()).toMatchObject({
      content: 'AI edit',
      originalContent: 'AI edit',
      dirty: false,
      mtime: 2
    })
  })
})
