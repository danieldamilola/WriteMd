import { app, safeStorage } from 'electron'
import { join, dirname } from 'path'
import { readFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import { writeFile, rename, unlink } from 'fs/promises'
import { randomUUID } from 'crypto'
import { migrateDesign } from '../shared/design-migration'
import {
  DEFAULT_SETTINGS,
  validatePatch,
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
 * True when the last load found an `enc:v1:` key that would not decrypt. A
 * locked keyring, a restart mid-read, or a config copied between machines all
 * produce this, and the next settings write would otherwise be the moment the
 * key is lost, so the renderer asks the user to re-enter it.
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
        migrateDesign(JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8')) as Record<string, unknown>)
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
  next.ai.apiKeySet = next.ai.apiKey.length > 0
  settingsCache = next
  return next
}

/**
 * Settings for the renderer, with the API key stripped.
 *
 * The plaintext key never crosses the bridge. The renderer only needs to know
 * whether one is stored, which `ai.apiKeySet` reports, and it hands an empty key
 * back to `net:chat` / `net:fetchModels`, where the main process substitutes the
 * stored value. A renderer that asked for the settings used to receive a
 * decrypted secret on every call.
 */
export function getSettingsForRenderer(): WriteMdSettings {
  const settings = getSettings()
  return {
    ...settings,
    ai: {
      ...settings.ai,
      apiKey: '',
      // Distinguishes "no key stored" from "a key is stored but this install
      // cannot read it", which is the difference between an empty field and a
      // field the user must retype.
      apiKeySet: settings.ai.apiKeySet && !apiKeyUndecryptable,
      apiKeyUndecryptable
    }
  }
}

/** The stored API key, decrypted. Main-process callers only. */
export function getStoredApiKey(): string {
  return getSettings().ai.apiKey
}

export function setSettings(partial: WriteMdSettingsPatch): Promise<void> {
  const { clean, problems } = validatePatch(partial)
  for (const p of problems) console.warn('Rejected settings patch:', p)

  const current = getSettings()
  const merged = deepMerge(
    current as unknown as Record<string, unknown>,
    clean as unknown as Record<string, unknown>
  ) as unknown as WriteMdSettings

  // The key field is write-only, so an empty value means "unchanged", not
  // "delete". The renderer never receives the stored key, so its copy of
  // ai.apiKey is always '' and every unrelated settings save sends that. Taken
  // literally it encrypted to '' and destroyed a key the user had just entered.
  const incomingKey = (clean as { ai?: { apiKey?: unknown } }).ai?.apiKey
  const sentNothing = typeof incomingKey !== 'string' || incomingKey.length === 0
  if (sentNothing && current.ai.apiKey.length > 0) merged.ai.apiKey = current.ai.apiKey

  // Derived, never client-supplied, and read from the *merged* value. Deriving
  // it from `current` meant a freshly entered key reported false until the next
  // launch, and the AI panel said "not configured" the whole time.
  merged.ai.apiKeySet = merged.ai.apiKey.length > 0
  merged.ai.apiKeyUndecryptable = apiKeyUndecryptable
  settingsCache = merged
  // Serialize writes. The renderer fires this on every settings change and twice
  // per tab switch, and each call is an independent ipcMain.handle. Two
  // concurrent truncating writes to the same path can interleave, and the
  // corruption handler in getSettings() then wipes the API key along with
  // everything else.
  writeQueue = writeQueue.catch(() => undefined).then(() => writeSettingsFile(merged))
  // Errors propagate: the renderer is told a save succeeded when it did not.
  return writeQueue
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
    // `apiKeySet` is derived state and has no business in the config file.
    const { apiKeySet: _derived, ...persistedAi } = merged.ai
    void _derived
    const toPersist = {
      ...merged,
      ai: {
        ...persistedAi,
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
    // Rethrown so setSettings rejects and the renderer learns the save failed.
    console.error('Failed to write settings:', e)
    throw e
  }
}
