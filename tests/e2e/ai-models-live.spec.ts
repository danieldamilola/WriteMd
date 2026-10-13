import { test, expect, type ElectronApplication } from '@playwright/test'
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { WriteMdSettings } from '../../src/shared/settings-schema'
import { makeFixture, launch, firstWindow, resizeWindow } from './fixtures'

test.skip(process.env.WRITEMD_LIVE_AI_TEST !== '1', 'Requires an explicit live model check')

test('DeepSeek Fetch matches the live model catalogue for the saved key', async () => {
  test.setTimeout(90000)
  const profile = join(process.env.APPDATA ?? '', 'writemd')
  const config = JSON.parse(readFileSync(join(profile, 'config.json'), 'utf8')) as WriteMdSettings
  test.skip(config.ai.providerId !== 'deepseek', 'Requires DeepSeek selected in Settings')
  expect(config.ai.baseUrl.replace(/\/+$/, '')).toBe('https://api.deepseek.com')
  const fixture = makeFixture('ai-models-live')
  const keyFile = join(fixture.userData, 'ai-key')
  const encryptionState = join(fixture.userData, 'Local State')
  let app: ElectronApplication | undefined
  try {
    if (existsSync(join(profile, 'Local State')))
      copyFileSync(join(profile, 'Local State'), encryptionState)
    copyFileSync(join(profile, 'ai-key'), keyFile)
    const fixtureConfig = JSON.parse(readFileSync(join(fixture.userData, 'config.json'), 'utf8'))
    fixtureConfig.ai = { ...config.ai, cachedModels: [] }
    writeFileSync(join(fixture.userData, 'config.json'), JSON.stringify(fixtureConfig))
    app = await launch(fixture)
    const page = await firstWindow(app)
    await resizeWindow(app, 1400, 900)
    // Observe the response in main without returning request headers or keys.
    await app.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        modelCheck?: { url: string; status: number; ids: string[] }
      }
      const originalFetch = globalThis.fetch
      globalThis.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
        const response = await originalFetch(...args)
        const url = String(args[0])
        if (url === 'https://api.deepseek.com/models') {
          const payload = (await response.clone().json()) as { data?: Array<{ id: string }> }
          state.modelCheck = {
            url,
            status: response.status,
            ids: [...new Set((payload.data ?? []).map((model) => model.id))].sort()
          }
        }
        return response
      }
    })
    await expect(page.locator('writemd-editor')).toBeVisible()
    await page.keyboard.press('Control+,')
    const settings = page.locator('writemd-settings-modal')
    await settings.getByRole('button', { name: 'AI assistant', exact: true }).click()
    await settings.getByRole('button', { name: 'Fetch models', exact: true }).click()
    await expect
      .poll(
        () =>
          app!.evaluate(
            () =>
              (globalThis as typeof globalThis & { modelCheck?: { status: number } }).modelCheck
                ?.status
          ),
        { timeout: 30000 }
      )
      .toBe(200)
    const rawIds = await app.evaluate(
      () => (globalThis as typeof globalThis & { modelCheck: { ids: string[] } }).modelCheck.ids
    )
    expect(rawIds.length).toBeGreaterThan(0)
    await expect(settings).toContainText(`${rawIds.length} available`, { timeout: 30000 })
    const select = settings.locator('wa-select[aria-label="Model"]')
    const displayedIds = await select
      .locator('wa-option')
      .evaluateAll((options) => options.map((option) => option.getAttribute('value')).sort())
    expect(displayedIds).toEqual(rawIds)
    await expect
      .poll(() => {
        const saved = JSON.parse(readFileSync(join(fixture.userData, 'config.json'), 'utf8'))
        return saved.ai.cachedModels
      })
      .toEqual(rawIds)
    await select.click()
    await page.screenshot({ path: 'artifacts/ui-review/ai-models-deepseek-live.png' })
    console.log(`Live DeepSeek model IDs match Fetch and the picker: ${rawIds.join(', ')}`)
  } finally {
    try {
      await app?.close()
    } finally {
      rmSync(keyFile, { force: true })
      rmSync(encryptionState, { force: true })
    }
  }
})
