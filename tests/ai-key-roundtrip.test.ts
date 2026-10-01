import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// SETTINGS_FILE is a module const computed from app.getPath('userData') at
// import time, so the mock has to answer with the throwaway dir before the
// module under test is first imported.
const ctx = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => ctx.userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, '')
  }
}))

/**
 * The API key round trip.
 *
 * `apiKeySet` is derived in the main process because the plaintext key never
 * crosses the bridge. Two bugs made a correctly-configured app report
 * "not configured":
 *
 *   1. `apiKeySet` was derived from the settings as they were *before* the
 *      patch merged, so entering a key reported false until the next restart.
 *   2. The renderer sends the whole settings object on every change and never
 *      holds the key, so unrelated saves sent `ai.apiKey: ''`. That encrypted to
 *      an empty string and destroyed the stored key outright.
 *
 * The field is documented as write-only, where empty means "unchanged". These
 * tests hold both ends of that contract.
 */
let DIR: string
let CONFIG: string

beforeEach(() => {
  DIR = mkdtempSync(join(tmpdir(), 'writemd-ai-key-'))
  CONFIG = join(DIR, 'config.json')
  ctx.userData = DIR
  vi.resetModules()
})

afterEach(() => {
  rmSync(DIR, { recursive: true, force: true })
})

async function load(): Promise<typeof import('../src/main/settings')> {
  const mod = await import('../src/main/settings')
  return mod
}

function persisted(): { ai?: { apiKey?: string; apiKeySet?: boolean } } {
  return existsSync(CONFIG)
    ? (JSON.parse(readFileSync(CONFIG, 'utf-8')) as { ai?: { apiKey?: string } })
    : {}
}

describe('AI API key', () => {
  it('reports apiKeySet true as soon as a key is entered', async () => {
    const m = await load()
    expect(m.getSettings().ai.apiKeySet).toBe(false)
    await m.setSettings({ ai: { ...m.getSettings().ai, apiKey: 'sk-first' } })
    // This is the reported bug: it read false here, so the AI panel said
    // "not configured" until the app was restarted.
    expect(m.getSettings().ai.apiKeySet).toBe(true)
  })

  it('keeps a stored key when an unrelated setting changes', async () => {
    const m = await load()
    await m.setSettings({ ai: { ...m.getSettings().ai, apiKey: 'sk-keep' } })
    expect(m.getSettings().ai.apiKeySet).toBe(true)

    // The renderer sends the whole object, and its copy of ai.apiKey is always
    // '' because the plaintext never comes back.
    await m.setSettings({
      ai: { ...m.getSettings().ai, apiKey: '' },
      appearance: { ...m.getSettings().appearance, theme: 'light' }
    })

    expect(m.getSettings().ai.apiKey).toBe('sk-keep')
    expect(m.getSettings().ai.apiKeySet).toBe(true)
    expect(m.getSettings().appearance.theme).toBe('light')
    // Still encrypted on disk, and the derived flag is not persisted.
    expect(persisted().ai?.apiKey).toMatch(/^enc:v1:/)
    expect(persisted().ai?.apiKeySet).toBeUndefined()
  })

  it('survives a reload, so apiKeySet is not only an in-memory flag', async () => {
    const m = await load()
    await m.setSettings({ ai: { ...m.getSettings().ai, apiKey: 'sk-persist' } })
    vi.resetModules()
    const fresh = await load()
    expect(fresh.getSettings().ai.apiKey).toBe('sk-persist')
    expect(fresh.getSettings().ai.apiKeySet).toBe(true)
  })

  it('a newly typed key replaces the stored one rather than being ignored', async () => {
    const m = await load()
    await m.setSettings({ ai: { ...m.getSettings().ai, apiKey: 'sk-old' } })
    await m.setSettings({ ai: { ...m.getSettings().ai, apiKey: 'sk-new' } })
    expect(m.getSettings().ai.apiKey).toBe('sk-new')
    expect(m.getSettings().ai.apiKeySet).toBe(true)
  })

  it('keeps the key set across unrelated saves after a restart', async () => {
    writeFileSync(CONFIG, JSON.stringify({ ai: { apiKey: 'sk-from-disk' } }), 'utf-8')
    vi.resetModules()
    const m = await load()
    expect(m.getSettings().ai.apiKeySet).toBe(true)
    await m.setSettings({ appearance: { ...m.getSettings().appearance, theme: 'nord' } })
    expect(m.getSettings().ai.apiKeySet).toBe(true)
    expect(m.getSettings().ai.apiKey).toBe('sk-from-disk')
  })
})
