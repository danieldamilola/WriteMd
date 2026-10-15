import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileState } from '../src/renderer/src/state/file-state'
import { SettingsStore } from '../src/renderer/src/state/settings'

vi.mock('../src/renderer/src/services/confirm', () => ({ showConfirm: vi.fn(async () => true) }))
const files = FileState.getInstance()
const settings = SettingsStore.getInstance()
beforeEach(async () => {
  settings.setMany(
    {
      'editor.autoSave': false,
      'files.defaultNewFileName': 'Untitled.md',
      'files.defaultNewFileContent': ''
    },
    false
  )
  for (let i = files.getState().tabs.length - 1; i >= 0; i--) await files.closeTab(i)
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      settings: { set: vi.fn().mockResolvedValue(undefined) },
      vault: {
        getPath: vi.fn().mockResolvedValue('C:/Vault'),
        getTree: vi.fn().mockResolvedValue({
          name: 'Vault',
          path: 'C:/Vault',
          isDirectory: true,
          children: [
            { name: 'Untitled.md', path: 'C:/Vault/Untitled.md', isDirectory: false },
            { name: 'Untitled 2.md', path: 'C:/Vault/Untitled 2.md', isDirectory: false }
          ]
        })
      },
      file: {
        write: vi
          .fn()
          .mockRejectedValue(new Error('New note creation must not write existing files'))
      }
    }
  })
})
afterEach(async () => {
  await settings.whenSaved()
  Reflect.deleteProperty(window, 'electronAPI')
})
describe('new note names', () => {
  it('skips default filenames on disk and in open tabs without replacing their buffers', async () => {
    await files.newFile()
    expect(files.getState().path).toBe('C:/Vault/Untitled 3.md')
    files.setContent('Keep this unsaved draft')
    await files.newFile()
    expect(files.getState().path).toBe('C:/Vault/Untitled 4.md')
    expect(
      files.getState().tabs.find((tab) => tab.path === 'C:/Vault/Untitled 3.md')?.content
    ).toBe('Keep this unsaved draft')
    expect(window.electronAPI!.file.write).not.toHaveBeenCalled()
  })
  it('preserves the configured filename and extension when no collision exists', async () => {
    settings.set('files.defaultNewFileName', 'New script.markdown')
    await files.newFile()
    expect(files.getState().path).toBe('C:/Vault/New script.markdown')
    await files.newFile()
    expect(files.getState().path).toBe('C:/Vault/New script 2.markdown')
  })
})
