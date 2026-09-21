import { app, safeStorage } from 'electron'
import { join, dirname } from 'path'
import { readFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import { writeFile } from 'fs/promises'
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
    'safeStorage is unavailable on this system — the AI API key is being stored ' +
      'in plaintext in config.json.'
  )
  return plain
}

export function decryptApiKey(value: string): string {
  if (!value.startsWith(ENCRYPTION_PREFIX)) return value
  try {
    if (!safeStorage || typeof safeStorage.decryptString !== 'function') return ''
    return safeStorage.decryptString(Buffer.from(value.slice(ENCRYPTION_PREFIX.length), 'base64'))
  } catch {
    return ''
  }
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
  try {
    const dir = dirname(SETTINGS_FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    // Store the API key encrypted; the in-memory cache keeps it decrypted.
    const toPersist = {
      ...merged,
      ai: { ...merged.ai, apiKey: encryptApiKey(merged.ai.apiKey) }
    }
    await writeFile(SETTINGS_FILE, JSON.stringify(toPersist, null, 2), 'utf-8')
  } catch (e) {
    console.error('Failed to write settings:', e)
  }
}
