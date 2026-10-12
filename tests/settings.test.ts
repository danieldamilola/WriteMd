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

  it('drops settings for the removed AI feature and repairs the background target', async () => {
    mockElectron()
    // A config written by a build that still had the AI panel.
    writeFileSync(
      CONFIG,
      JSON.stringify({
        appearance: { backgroundTarget: 'ai', theme: 'nord' },
        ai: { provider: 'OpenAI', apiKey: 'sk-should-be-gone' }
      }),
      'utf-8'
    )
    const { getSettings, setSettings } = await import('../src/main/settings')

    const s = getSettings()
    expect(s).not.toHaveProperty('ai')
    // Otherwise Background.ts compares against 'workspace' forever and the
    // artwork never appears again, with nothing on screen to explain it.
    expect(s.appearance.backgroundTarget).toBe('workspace')
    expect(s.appearance.theme).toBe('nord')

    // And it must not come back on the next save.
    await setSettings({ editor: { fontSize: 17 } })
    const persisted = JSON.parse(readFileSync(CONFIG, 'utf-8'))
    expect(persisted).not.toHaveProperty('ai')
    expect(persisted.appearance.backgroundTarget).toBe('workspace')
    expect(readFileSync(CONFIG, 'utf-8')).not.toContain('sk-should-be-gone')
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
