import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FileState, type FileStateData, type TabDoc } from '../src/renderer/src/state/file-state'
import { SettingsStore } from '../src/renderer/src/state/settings'

vi.mock('../src/renderer/src/services/confirm', () => ({ showConfirm: async () => true }))

type Api = NonNullable<Window['electronAPI']>

const BACKSLASH = 'C:\\Users\\Daniel\\Documents\\WriteMd Vault\\testing.md'
const SLASH = 'C:/Users/Daniel/Documents/WriteMd Vault/testing.md'
const OTHER = 'C:/Users/Daniel/Documents/WriteMd Vault/other.md'

const files = FileState.getInstance()
const settings = SettingsStore.getInstance()
const initial = files.getState()

const read = vi.fn<(path: string) => Promise<{ content: string; mtime: number }>>(async () => ({
  content: 'Original',
  mtime: 1
}))
const write = vi.fn<(path: string, content: string) => Promise<{ mtime: number }>>(async () => ({
  mtime: 2
}))
const exists = vi.fn<(path: string) => Promise<boolean>>(async () => true)

/**
 * Force the case-insensitive-fs branch. jsdom reports an empty platform, and
 * slash normalisation must hold on any platform, so the case fold is what this
 * suite is actually checking once it is switched on.
 */
function setPlatform(value: string): void {
  Object.defineProperty(window.navigator, 'platform', { value, configurable: true })
}

let originalPlatform: PropertyDescriptor | undefined

beforeEach(() => {
  originalPlatform = Object.getOwnPropertyDescriptor(window.navigator, 'platform')
  setPlatform('Win32')
  ;(files as unknown as { state: FileStateData }).state = { ...initial, tabs: [] }
  ;(files as unknown as { refreshes: Map<string, symbol> }).refreshes = new Map()
  read.mockReset().mockResolvedValue({ content: 'Original', mtime: 1 })
  write.mockReset().mockResolvedValue({ mtime: 2 })
  exists.mockReset().mockResolvedValue(true)
  settings.setMany({
    'files.openTabs': [],
    'files.activeTabPath': null,
    'files.pinnedTabs': [],
    'files.tabGroups': '[]',
    'editor.autoSave': false
  })
  window.electronAPI = {
    file: { read, write, exists, watch: async () => undefined, unwatch: async () => undefined },
    settings: { set: async () => undefined },
    vault: { getPath: async () => 'C:/Users/Daniel/Documents/WriteMd Vault' }
  } as unknown as Api
  vi.spyOn(window, 'alert').mockImplementation(() => undefined)
})

afterEach(() => {
  ;(files as unknown as { clearAutoSaveTimer(): void }).clearAutoSaveTimer()
  if (originalPlatform) Object.defineProperty(window.navigator, 'platform', originalPlatform)
  delete window.electronAPI
})

function tabPaths(): string[] {
  return files.getState().tabs.map((tab) => tab.path ?? '')
}

/** Put a duplicate pair straight into memory, as an old session restore left it. */
function seedAliasTabs(): void {
  const state = files.getState()
  const base = {
    content: 'Original',
    originalContent: 'Original',
    mtime: 1,
    dirty: false,
    isVaultFile: true,
    lastWritten: null,
    pendingWrite: null
  }
  const alias: TabDoc = { ...base, id: 'tab-alias', path: SLASH, groupId: 'g1', isPinned: true }
  const back: TabDoc = { ...base, id: 'tab-back', path: BACKSLASH, groupId: null, isPinned: false }
  ;(files as unknown as { state: FileStateData }).state = {
    ...state,
    tabs: [alias, back],
    activeTab: 1,
    tabGroups: [{ id: 'g1', label: 'Work', collapsed: false }]
  }
  ;(files as unknown as { syncMirror(): void }).syncMirror()
}

it('opens one tab for a slash alias of an already open file', async () => {
  await files.openFile(SLASH)
  await files.openFile(BACKSLASH)
  expect(tabPaths()).toEqual([SLASH])
  expect(files.getState().activeTab).toBe(0)
})

it('restores one tab per physical file', async () => {
  settings.setMany({
    'files.openTabs': [SLASH, BACKSLASH, OTHER],
    'files.activeTabPath': BACKSLASH
  })
  expect(await files.restoreTabs()).toBe(true)
  expect(tabPaths()).toEqual([SLASH, OTHER])
})

it('keeps the active tab on the surviving alias', async () => {
  settings.setMany({
    'files.openTabs': [SLASH, BACKSLASH],
    'files.activeTabPath': BACKSLASH
  })
  await files.restoreTabs()
  expect(files.getState().tabs[files.getState().activeTab].path).toBe(SLASH)
})

it('carries pin and group identity across the dropped alias', async () => {
  settings.setMany({
    'files.openTabs': [SLASH, BACKSLASH],
    'files.pinnedTabs': [BACKSLASH],
    'files.tabGroups': JSON.stringify({
      groups: [{ id: 'g1', label: 'Work', collapsed: false }],
      assignments: [{ path: BACKSLASH, groupId: 'g1' }]
    })
  })
  await files.restoreTabs()
  const [tab] = files.getState().tabs
  expect(tab.isPinned).toBe(true)
  expect(tab.groupId).toBe('g1')
  expect(files.getState().tabGroups).toEqual([{ id: 'g1', label: 'Work', collapsed: false }])
})

it('reports a vault file restored under a slash alias as a vault file', async () => {
  settings.setMany({ 'files.openTabs': [BACKSLASH] })
  await files.restoreTabs()
  expect(files.getState().tabs[0].isVaultFile).toBe(true)
})

it('applies an AI edit to the active alias and writes it to disk', async () => {
  seedAliasTabs()
  const applied = await files.applyAiEdit(SLASH, 'Original', 'Original\n\nRewritten by DeepSeek')
  expect(applied).toBe(true)
  // The active tab is the backslash copy, so that is the buffer the user sees.
  expect(files.getState().content).toBe('Original\n\nRewritten by DeepSeek')
  expect(files.getState().tabs.map((t) => t.content)).toEqual([
    'Original\n\nRewritten by DeepSeek',
    'Original\n\nRewritten by DeepSeek'
  ])
  expect(write).toHaveBeenCalledTimes(1)
  expect(write).toHaveBeenCalledWith(SLASH, 'Original\n\nRewritten by DeepSeek')
})

it('settles both aliases clean after the write', async () => {
  seedAliasTabs()
  await files.applyAiEdit(SLASH, 'Original', 'Original\n\nRewritten by DeepSeek')
  expect(files.getState().tabs.map((t) => t.dirty)).toEqual([false, false])
  expect(files.getState().tabs.map((t) => t.originalContent)).toEqual([
    'Original\n\nRewritten by DeepSeek',
    'Original\n\nRewritten by DeepSeek'
  ])
})

it('refuses the write when one alias has moved on', async () => {
  seedAliasTabs()
  files.setContent('Edited by hand')
  expect(await files.applyAiEdit(SLASH, 'Original', 'Original\n\nRewritten by DeepSeek')).toBe(false)
  expect(write).not.toHaveBeenCalled()
  expect(files.getState().content).toBe('Edited by hand')
})

it('refreshes every alias from one watcher event', async () => {
  seedAliasTabs()
  await files.refreshFile(SLASH, { content: 'Changed elsewhere', mtime: 9, before: 'Original' })
  expect(files.getState().tabs.map((t) => t.content)).toEqual([
    'Changed elsewhere',
    'Changed elsewhere'
  ])
})

it('updates the editor without a read when a snapshot carries the content', async () => {
  seedAliasTabs()
  read.mockClear()
  await files.refreshFile(SLASH, { content: 'Changed elsewhere', mtime: 9, before: 'Original' })
  expect(read).not.toHaveBeenCalled()
  expect(files.getState().content).toBe('Changed elsewhere')
})

it('still treats different-case paths as one file on Windows', async () => {
  await files.openFile(SLASH)
  await files.openFile('c:/users/daniel/documents/writemd vault/TESTING.md')
  expect(tabPaths()).toHaveLength(1)
})

it('keeps case-distinct paths apart where the filesystem does', async () => {
  setPlatform('LinuxX86_64')
  await files.openFile(SLASH)
  await files.openFile('c:/users/daniel/documents/writemd vault/TESTING.md')
  expect(tabPaths()).toHaveLength(2)
})