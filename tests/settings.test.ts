import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeTempRoot } from './helpers/temp-root'

// Was a fixed 'C:/Temp/writemd-settings-test': Windows-only, so the suite could
// not run on the release workflow's linux/macos legs.
const TEST_ROOT = makeTempRoot('settings')
const CONFIG = join(TEST_ROOT, 'userData', 'config.json')

function mockElectron(): void {
  vi.doMock('electron', () => ({
    app: {
      getPath: (name: string) => (name === 'userData' ? `${TEST_ROOT}/userData` : TEST_ROOT)
    }
  }))
}

describe('settings persistence', () => {
  beforeEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true })
    mkdirSync(join(TEST_ROOT, 'userData'), { recursive: true })
    vi.resetModules()
  })

  it('repairs the background target left by a build that used the AI panel', async () => {
    mockElectron()
    // A config written by a build that had the AI panel. That panel is back, so
    // the `ai` block is no longer dead weight - but `backgroundTarget: 'ai'` is
    // still invalid and the artwork is still hidden behind it.
    writeFileSync(
      CONFIG,
      JSON.stringify({
        appearance: { backgroundTarget: 'ai', theme: 'nord' },
        ai: { enabled: false, providerId: 'openai', apiKey: 'sk-legacy-value' }
      }),
      'utf-8'
    )
    const { getSettings, setSettings } = await import('../src/main/settings')

    const s = getSettings()
    expect(s.appearance.backgroundTarget).toBe('workspace')
    expect(s.appearance.theme).toBe('nord')
    // The section survives, and the known keys are read from it.
    expect(s.ai.providerId).toBe('openai')

    // And the repair must survive a save, which is where a stale value would
    // otherwise be written back out and undo itself.
    await setSettings({ editor: { fontSize: 17 } })
    const persisted = JSON.parse(readFileSync(CONFIG, 'utf-8'))
    expect(persisted.appearance.backgroundTarget).toBe('workspace')
  })

  it('never persists an api key into config.json', async () => {
    mockElectron()
    // The key lives in a safeStorage-encrypted file, not in plain JSON. A key
    // reaching config.json would be copied, backed up and pasted into bug
    // reports with the rest of the file, and nothing would ever remove it.
    writeFileSync(CONFIG, JSON.stringify({ ai: { enabled: true } }), 'utf-8')
    const { getSettings, setSettings } = await import('../src/main/settings')

    const s = getSettings()
    expect(s.ai).not.toHaveProperty('apiKey')

    // Even a patch that tries to smuggle one in is dropped by the schema, which
    // only accepts declared keys.
    await setSettings({ ai: { apiKey: 'sk-should-not-be-written' } } as never)
    const raw = readFileSync(CONFIG, 'utf-8')
    expect(raw).not.toContain('sk-should-not-be-written')
    // Quoted, so this cannot match `apiKeySet`, which is a legitimate boolean.
    expect(raw).not.toContain('"apiKey"')
  })

  it('moves a corrupt config aside instead of silently resetting', async () => {
    mockElectron()
    writeFileSync(CONFIG, '{not valid json', 'utf-8')
    const { getSettings } = await import('../src/main/settings')
    expect(getSettings().editor.fontSize).toBe(15)
    expect(existsSync(`${CONFIG}.corrupt`)).toBe(true)
  })

  it('deep-merges partial settings over defaults', async () => {
    mockElectron()
    const { getSettings, setSettings } = await import('../src/main/settings')
    await setSettings({ editor: { fontSize: 21 } })
    const s = getSettings()
    expect(s.editor.fontSize).toBe(21)
    expect(s.editor.fontFamily).toBe('JetBrains Mono')
    expect(s.appearance.theme).toBe('graphite')
  })

  it('recovers the write queue after an atomic rename fails', async () => {
    mockElectron()
    const { setSettings, getSettings } = await import('../src/main/settings')
    getSettings()
    mkdirSync(CONFIG)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(setSettings({ appearance: { railWidth: 224 } })).rejects.toThrow()
    rmSync(CONFIG, { recursive: true })
    await setSettings({ appearance: { railWidth: 240 } })
    expect(JSON.parse(readFileSync(CONFIG, 'utf-8')).appearance.railWidth).toBe(240)
  })
})
