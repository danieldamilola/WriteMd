import { app, safeStorage } from 'electron'
import { readFileSync, rmSync, writeFileSync, renameSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'

/**
 * The user's API key, encrypted at rest.
 *
 * Deliberately not in config.json. That file is plain JSON on disk: the user
 * reads it, copies it between machines, and occasionally pastes it into a bug
 * report. A secret that lives there outlives the session and survives anything
 * done about it later, so it goes through `safeStorage` into its own file
 * instead.
 *
 * The renderer never sees the key. It gets a boolean saying whether one is
 * stored and a way to replace or clear it, which is enough to run a model list
 * fetch without ever having the secret cross the process bridge.
 */

const KEY_FILE = (): string => join(app.getPath('userData'), 'ai-key')

export type KeyStoreState = 'empty' | 'stored' | 'unavailable'

let cached: string | null = null
let cachedState: KeyStoreState | null = null

/**
 * True when this machine can actually encrypt.
 *
 * Linux without a Secret Service returns false here. That is a real
 * configuration, not an error, and it is the case where writing the key in
 * clear would be a downgrade the user never asked for.
 */
export function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function read(): { state: KeyStoreState; key: string } {
  if (cachedState !== null) return { state: cachedState, key: cached ?? '' }

  let raw: Buffer
  try {
    raw = readFileSync(KEY_FILE())
  } catch {
    return { state: 'empty', key: '' }
  }

  if (!canEncrypt()) {
    // The file exists but this install cannot open it. Reporting 'empty' would
    // overwrite a key the user can still recover by moving machines; reporting
    // 'stored' would be a lie, since nothing can read it. 'unavailable' lets the
    // UI say so and offer to replace it.
    cachedState = 'unavailable'
    cached = null
    return { state: 'unavailable', key: '' }
  }

  try {
    cached = safeStorage.decryptString(raw)
    cachedState = 'stored'
    return { state: 'stored', key: cached }
  } catch {
    // Written by a different user account, or a keychain rotation happened.
    cachedState = 'unavailable'
    cached = null
    return { state: 'unavailable', key: '' }
  }
}

/** The key, or empty string. Main process only - never crosses to the renderer. */
export function getApiKey(): string {
  return read().key
}

export function keyState(): KeyStoreState {
  return read().state
}

/**
 * Store a key, or clear it when given an empty string.
 *
 * On encryption failure the key is kept in memory for this session and NOT
 * written in clear. Reporting success would be worse than the failure: the
 * settings would show a stored key, the app would work, and the user would
 * believe it was protected when it was sitting in their userData directory.
 */
export function setApiKey(key: string): { stored: boolean; reason?: string } {
  if (!key.trim()) {
    cached = ''
    cachedState = 'empty'
    try {
      rmSync(KEY_FILE(), { force: true })
    } catch {
      return { stored: false, reason: 'Could not remove the stored key file.' }
    }
    return { stored: true }
  }

  if (!canEncrypt()) {
    cached = key
    cachedState = 'stored'
    return {
      stored: false,
      reason:
        'No system keychain is available on this machine, so the key cannot be saved securely. It will work for this session only.'
    }
  }

  try {
    const encrypted = safeStorage.encryptString(key)
    const path = KEY_FILE()
    const temp = `${path}.${randomUUID()}.tmp`
    writeFileSync(temp, encrypted, { mode: 0o600 })
    renameSync(temp, path)
  } catch (err) {
    cached = key
    cachedState = 'stored'
    return {
      stored: false,
      reason: `Could not save the key securely: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  cached = key
  cachedState = 'stored'
  return { stored: true }
}

/** Test seam, and what a "forget everything" action would call. */
export function resetKeyCache(): void {
  cached = null
  cachedState = null
}
