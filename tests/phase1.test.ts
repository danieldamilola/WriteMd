import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync, rmSync } from 'fs'
import { makeTempRoot } from './helpers/temp-root'

// Was a fixed 'C:/Temp/writemd-phase1-test': Windows-only, and the name
// collided with the phase2/3/5 suites when vitest ran files in parallel.
const TEST_ROOT = makeTempRoot('phase1')

// vault.ts builds paths with path.join, so on Windows they come back with
// backslashes. Compare with separators normalized on both sides rather than
// assuming one flavour.
const norm = (p: string): string => p.replace(/\\/g, '/')

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) =>
      name === 'documents' ? `${TEST_ROOT}/Documents` : `${TEST_ROOT}/userData`
  }
}))

describe('phase 1 foundation', () => {
  beforeEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true })
    vi.resetModules()
  })

  it('creates the vault folder on ensureVaultExists', async () => {
    const { ensureVaultExists } = await import('../src/main/vault')
    const p = ensureVaultExists()
    expect(norm(p)).toBe(norm(`${TEST_ROOT}/Documents/WriteMd Vault`))
    expect(existsSync(p)).toBe(true)
  })

  it('migrates a legacy WriteMD vault folder forward', async () => {
    const { mkdirSync, writeFileSync, existsSync: exists } = await import('fs')
    const legacy = `${TEST_ROOT}/Documents/WriteMD`
    mkdirSync(legacy, { recursive: true })
    writeFileSync(`${legacy}/note.md`, '# hi')
    const { getDefaultVaultPath } = await import('../src/main/vault')
    const p = getDefaultVaultPath()
    expect(norm(p)).toBe(norm(`${TEST_ROOT}/Documents/WriteMd Vault`))
    expect(exists(`${TEST_ROOT}/Documents/WriteMd Vault/note.md`)).toBe(true)
    expect(exists(legacy)).toBe(false)
  })

  it('round-trips settings to config.json', async () => {
    const { getSettings, setSettings } = await import('../src/main/settings')
    expect(getSettings().editor.fontSize).toBe(15)
    await setSettings({ editor: { ...getSettings().editor, fontSize: 18 } })
    expect(getSettings().editor.fontSize).toBe(18)
    expect(existsSync(`${TEST_ROOT}/userData/config.json`)).toBe(true)
  })

  it('file-state cycles view modes through the quick toggle', async () => {
    const { FileState } = await import('../src/renderer/src/state/file-state')
    const fs = FileState.getInstance()
    expect(fs.getState().viewMode).toBe('wysiwyg')
    // 'wysiwyg' is a legacy alias for 'live', so the first toggle compares equal
    // and moves to the pair's other mode.
    fs.quickToggle()
    expect(fs.getState().viewMode).toBe('reading')
    fs.setViewMode('source')
    expect(fs.getState().viewMode).toBe('source')
  })

  it('lists only markdown files', async () => {
    const { mkdirSync, writeFileSync } = await import('fs')
    const { listMarkdownFiles } = await import('../src/main/vault')
    const dir = `${TEST_ROOT}/mixed`
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/a.md`, '# a')
    writeFileSync(`${dir}/b.markdown`, '# b')
    writeFileSync(`${dir}/c.txt`, 'nope')
    const files = listMarkdownFiles(dir)
    expect(files.map((f) => f.name).sort()).toEqual(['a.md', 'b.markdown'])
  })
})
