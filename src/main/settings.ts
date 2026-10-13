import { app } from 'electron'
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
  next = dropRemovedFeatures(next)
  settingsCache = next
  return next
}

/**
 * Repair settings that a previous build wrote and this one can no longer honour.
 *
 * The AI assistant is back, so its `ai` block stays. The `backgroundTarget`
 * repair stays too, and is now the important half: a config written by the
 * removed build may still carry `backgroundTarget: 'ai'`, which leaves
 * `Background.ts` comparing the setting against `'workspace'` and permanently
 * hiding the artwork with nothing on screen to explain why. That config is
 * still out there in users' userData directories, so removing the feature did
 * not make the possibility go away.
 */
function dropRemovedFeatures(settings: WriteMdSettings): WriteMdSettings {
  const next = {
    ...settings,
    appearance: { ...settings.appearance },
    ai: {
      ...settings.ai,
      autoAcceptEdits: settings.ai.autoAcceptEdits === true,
      maxOutputTokens:
        Number.isInteger(settings.ai.maxOutputTokens) &&
        settings.ai.maxOutputTokens >= 0 &&
        settings.ai.maxOutputTokens <= 131072
          ? settings.ai.maxOutputTokens
          : 0
    }
  }
  if (next.appearance.backgroundTarget !== 'workspace') {
    next.appearance.backgroundTarget = 'workspace'
  }
  return next
}

export function setSettings(partial: WriteMdSettingsPatch): Promise<void> {
  const { clean, problems } = validatePatch(partial)
  for (const p of problems) console.warn('Rejected settings patch:', p)

  const current = getSettings()
  const merged = deepMerge(
    current as unknown as Record<string, unknown>,
    clean as unknown as Record<string, unknown>
  ) as unknown as WriteMdSettings

  settingsCache = merged
  // Serialize writes. The renderer fires this on every settings change and twice
  // per tab switch, and each call is an independent ipcMain.handle. Two
  // concurrent truncating writes to the same path can interleave, and the
  // corruption handler in getSettings() then wipes everything.
  writeQueue = writeQueue.catch(() => undefined).then(() => writeSettingsFile(merged))
  // Errors propagate: the renderer is told a save succeeded when it did not.
  return writeQueue
}

let writeQueue: Promise<void> = Promise.resolve()

async function writeSettingsFile(merged: WriteMdSettings): Promise<void> {
  try {
    const dir = dirname(SETTINGS_FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    // Temp file plus atomic rename, same as the document write path. A direct
    // writeFile truncates the live config, so a crash mid-write leaves invalid
    // JSON that the recovery path then moves aside.
    const tempPath = `${SETTINGS_FILE}.${randomUUID()}.tmp`
    try {
      await writeFile(tempPath, JSON.stringify(merged, null, 2), {
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
