import { app, safeStorage } from 'electron'
import { join, dirname } from 'path'
import { readFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import { writeFile, rename, unlink } from 'fs/promises'
import { randomUUID } from 'crypto'
import {
  DEFAULT_SETTINGS,
  type WriteMdSettingsPatch,
  type WriteMdSettings
} from '../shared/settings-schema'

export const SETTINGS_FILE = join(app.getPath('userData'), 'config.json')

export type { WriteMdSettings, WriteMdSettingsPatch } from '../shared/settings-schema'
export { DEFAULT_SETTINGS } from '../shared/settings-schema'

const ENCRYPTION_PREFIX = 'enc:v1:'

/**
 * Encrypt the AI API key with safeStorage (OS keychain-backed) before it hits
 * disk. Falls back to plaintext when safeStorage is unavailable (some Linux
 * setups) so settings never disappear.
 */
export function encryptApiKey(plain: string): string {
  if (!plain) return ''
  try {
    if (
      safeStorage &&
      typeof safeStorage.isEncryptionAvailable === 'function' &&
      safeStorage.isEncryptionAvailable()
    ) {
      return ENCRYPTION_PREFIX + safeStorage.encryptString(plain).toString('base64')
    }
  } catch {
    // fall through to plaintext
  }
  console.warn(
    'safeStorage is unavailable on this system - the AI API key is being stored ' +
      'in plaintext in config.json.'
  )
  return plain
}

export function decryptApiKey(value: string): string {
  if (!value.startsWith(ENCRYPTION_PREFIX)) return value
  try {
    if (!safeStorage || typeof safeStorage.decryptString !== 'function') {
      apiKeyUndecryptable = true
      return ''
    }
    const plain = safeStorage.decryptString(
      Buffer.from(value.slice(ENCRYPTION_PREFIX.length), 'base64')
    )
    if (!plain) apiKeyUndecryptable = true
    return plain
  } catch {
    // A locked keyring, a restart mid-read, or a config copied between machines
    // all land here. Returning '' is fine for the in-memory cache, but the
    // encrypted blob on disk must survive: the next setSettings would otherwise
    // encrypt '' over the top of it and the key would be gone for good.
    apiKeyUndecryptable = true
    return ''
  }
}

/**
 * True when the last load found an `enc:v1:` key that would not decrypt. The
 * renderer surfaces this so the user can re-enter the key instead of silently
 * losing it to the next settings write.
 */
let apiKeyUndecryptable = false

export function isApiKeyUndecryptable(): boolean {
  return apiKeyUndecryptable
}

let settingsCache: WriteMdSettings | null = null

export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target }
  for (const key of Object.keys(source)) {
    const sVal = source[key]
    const tVal = target[key]
    if (
      sVal &&
      typeof sVal === 'object' &&
      !Array.isArray(sVal) &&
      tVal &&
      typeof tVal === 'object'
    ) {
      result[key] = deepMerge(tVal as Record<string, unknown>, sVal as Record<string, unknown>)
    } else {
      result[key] = sVal
    }
  }
  return result
}

export function getSettings(): WriteMdSettings {
  if (settingsCache) return settingsCache
  let next: WriteMdSettings = structuredClone(DEFAULT_SETTINGS)
  try {
    if (existsSync(SETTINGS_FILE)) {
      next = deepMerge(
        structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>,
        JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'))
      ) as unknown as WriteMdSettings
    }
  } catch (e) {
    // Corrupt config.json would otherwise silently wipe all settings on next
    // save. Move it aside so the user can recover their values.
    try {
      renameSync(SETTINGS_FILE, `${SETTINGS_FILE}.corrupt`)
      console.error('config.json was unreadable, moved aside:', e)
    } catch {
      console.error('Failed to read settings:', e)
    }
    next = structuredClone(DEFAULT_SETTINGS)
  }
  // API keys are stored encrypted at rest; decrypt into the in-memory cache.
  next.ai.apiKey = decryptApiKey(next.ai.apiKey)
  settingsCache = next
  return next
}

export async function setSettings(partial: WriteMdSettingsPatch): Promise<void> {
  const current = getSettings()
  const merged = deepMerge(
    current as unknown as Record<string, unknown>,
    partial as unknown as Record<string, unknown>
  ) as unknown as WriteMdSettings
  settingsCache = merged
  // Serialize writes. The renderer fires this on every settings change and twice
  // per tab switch, and each call is an independent ipcMain.handle. Two
  // concurrent truncating writes to the same path can interleave, and the
  // corruption handler in getSettings() then wipes the API key along with
  // everything else.
  writeQueue = writeQueue
    .then(() => writeSettingsFile(merged))
    .catch((e) => {
      console.error('Failed to write settings:', e)
    })
  await writeQueue
}

/** The raw `enc:v1:` blob from disk, untouched by decryption. */
function readStoredApiKey(): string | null {
  try {
    if (!existsSync(SETTINGS_FILE)) return null
    const raw = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8')) as {
      ai?: { apiKey?: unknown }
    }
    const stored = raw.ai?.apiKey
    return typeof stored === 'string' && stored.length > 0 ? stored : null
  } catch {
    return null
  }
}

let writeQueue: Promise<void> = Promise.resolve()

async function writeSettingsFile(merged: WriteMdSettings): Promise<void> {
  try {
    const dir = dirname(SETTINGS_FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    // Store the API key encrypted; the in-memory cache keeps it decrypted.
    const toPersist = {
      ...merged,
      ai: {
        ...merged.ai,
        // Never overwrite a stored blob we merely failed to read. encryptApiKey
        // short-circuits on '', so persisting an undecryptable key would
        // replace the real one with an empty string and lose it permanently.
        apiKey:
          !merged.ai.apiKey && apiKeyUndecryptable
            ? (readStoredApiKey() ?? '')
            : encryptApiKey(merged.ai.apiKey)
      }
    }
    // Temp file plus atomic rename, same as the document write path. A direct
    // writeFile truncates the live config, so a crash mid-write leaves invalid
    // JSON that the recovery path then moves aside.
    const tempPath = `${SETTINGS_FILE}.${randomUUID()}.tmp`
    try {
      await writeFile(tempPath, JSON.stringify(toPersist, null, 2), {
        encoding: 'utf-8',
        mode: 0o600
      })
      await rename(tempPath, SETTINGS_FILE)
    } catch (e) {
      await unlink(tempPath).catch(() => {})
      throw e
    }
  } catch (e) {
    console.error('Failed to write settings:', e)
  }
}
