import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const TEST_ROOT = 'C:/Temp/writemd-settings-test'
const CONFIG = join(TEST_ROOT, 'userData', 'config.json')

function mockElectron(encryptAvailable: boolean): void {
  vi.doMock('electron', () => ({
    app: {
      getPath: (name: string) => (name === 'userData' ? `${TEST_ROOT}/userData` : TEST_ROOT)
    },
    safeStorage: {
      isEncryptionAvailable: () => encryptAvailable,
      encryptString: (plain: string) => Buffer.from(`enc(${plain})`, 'utf-8'),
      decryptString: (buf: Buffer) => {
        const s = buf.toString('utf-8')
        if (s.startsWith('enc(') && s.endsWith(')')) return s.slice(4, -1)
        throw new Error('not encrypted')
      }
    }
  }))
}

describe('settings persistence', () => {
  beforeEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true })
    mkdirSync(join(TEST_ROOT, 'userData'), { recursive: true })
    vi.resetModules()
  })

  it('encrypts the API key at rest and decrypts it in memory', async () => {
    mockElectron(true)
    const { getSettings, setSettings } = await import('../src/main/settings')
    await setSettings({ ai: { ...getSettings().ai, apiKey: 'sk-secret-123' } })

    const raw = readFileSync(CONFIG, 'utf-8')
    const persisted = JSON.parse(raw)
    expect(persisted.ai.apiKey).toMatch(/^enc:v1:/)
    expect(raw).not.toContain('sk-secret-123')

    // Fresh module load simulates an app restart: key comes back decrypted.
    vi.resetModules()
    mockElectron(true)
    const { getSettings: fresh } = await import('../src/main/settings')
    expect(fresh().ai.apiKey).toBe('sk-secret-123')
  })

  it('falls back to plaintext when safeStorage is unavailable', async () => {
    mockElectron(false)
    const { getSettings, setSettings } = await import('../src/main/settings')
    await setSettings({ ai: { ...getSettings().ai, apiKey: 'sk-plain-fallback' } })

    const persisted = JSON.parse(readFileSync(CONFIG, 'utf-8'))
    expect(persisted.ai.apiKey).toBe('sk-plain-fallback')
  })

  it('reads legacy plaintext keys without mangling them', async () => {
    mockElectron(true)
    writeFileSync(CONFIG, JSON.stringify({ ai: { apiKey: 'sk-legacy' } }), 'utf-8')
    const { getSettings } = await import('../src/main/settings')
    expect(getSettings().ai.apiKey).toBe('sk-legacy')
  })

  it('moves a corrupt config aside instead of silently resetting', async () => {
    mockElectron(false)
    writeFileSync(CONFIG, '{not valid json', 'utf-8')
    const { getSettings } = await import('../src/main/settings')
    expect(getSettings().editor.fontSize).toBe(15)
    expect(existsSync(`${CONFIG}.corrupt`)).toBe(true)
  })

  it('deep-merges partial settings over defaults', async () => {
    mockElectron(false)
    const { getSettings, setSettings } = await import('../src/main/settings')
    await setSettings({ editor: { fontSize: 21 } })
    const s = getSettings()
    expect(s.editor.fontSize).toBe(21)
    expect(s.editor.fontFamily).toBe('JetBrains Mono')
    expect(s.appearance.theme).toBe('dark')
  })
})
