import { test, expect } from '@playwright/test'
import { createServer } from 'http'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { SettingsStore } from '../../src/renderer/src/state/settings'
import { PRESETS } from '../../src/main/ai/providers'
import { makeFixture, launch, firstWindow, resizeWindow, chooseSettingsOption } from './fixtures'

test('cloud providers select defaults, discover models, and survive restart', async () => {
  test.setTimeout(60000)
  const providers = PRESETS.filter((preset) =>
    ['openrouter', 'deepseek', 'groq', 'mistral', 'xai'].includes(preset.id)
  )
  let currentModel = ''
  const server = createServer((req, res) => {
    if (req.url !== '/v1/models') {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: currentModel }, { id: `${currentModel}-test` }] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not start')
  const fixture = makeFixture('ai-providers')
  let app = await launch(fixture)
  try {
    let page = await firstWindow(app)
    await resizeWindow(app, 1400, 900)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await page.keyboard.press('Control+,')
    let settings = page.locator('writemd-settings-modal')
    await settings.getByRole('button', { name: 'AI assistant', exact: true }).click()
    const select = settings.locator('wa-select[aria-label="Provider"]')
    for (const preset of providers) {
      await expect(select.locator(`wa-option[value="${preset.id}"]`)).toHaveText(preset.label)
    }
    await select.click()
    await page.screenshot({ path: 'artifacts/ui-review/ai-providers-picker.png' })
    await page.keyboard.press('Escape')
    for (const preset of providers) {
      await chooseSettingsOption(page, 'Provider', preset.id)
      await expect(settings.getByRole('textbox', { name: 'Endpoint', exact: true })).toHaveValue(
        preset.defaultBaseUrl
      )
      await expect(settings.locator('wa-select[aria-label="Model"]')).toHaveJSProperty(
        'value',
        preset.defaultModel
      )
      await expect(settings).toContainText(preset.keyHint)
      currentModel = preset.defaultModel
      const endpoint = settings.getByRole('textbox', { name: 'Endpoint', exact: true })
      await endpoint.fill(`http://127.0.0.1:${address.port}/v1`)
      await endpoint.press('Tab')
      await settings.getByRole('button', { name: 'Fetch models', exact: true }).click()
      await expect(settings).toContainText('2 available')
      await expect(settings.locator('wa-select[aria-label="Model"] wa-option')).toHaveCount(2)
      await endpoint.fill(preset.defaultBaseUrl)
      await endpoint.press('Tab')
      await expect
        .poll(() => {
          const config = JSON.parse(readFileSync(join(fixture.userData, 'config.json'), 'utf8'))
          return { id: config.ai.providerId, url: config.ai.baseUrl, model: config.ai.model }
        })
        .toEqual({ id: preset.id, url: preset.defaultBaseUrl, model: preset.defaultModel })
    }
    await page.screenshot({ path: 'artifacts/ui-review/ai-providers-dark.png' })
    await page.evaluate(() => {
      ;(
        document.querySelector('writemd-app') as unknown as { settingsStore: SettingsStore }
      ).settingsStore.set('appearance.theme', 'paper')
    })
    await page.screenshot({ path: 'artifacts/ui-review/ai-providers-paper.png' })
    await app.close()
    app = await launch(fixture)
    page = await firstWindow(app)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await page.keyboard.press('Control+,')
    settings = page.locator('writemd-settings-modal')
    await settings.getByRole('button', { name: 'AI assistant', exact: true }).click()
    await expect(settings.locator('wa-select[aria-label="Provider"]')).toHaveJSProperty(
      'value',
      'xai'
    )
    await expect(settings.getByRole('textbox', { name: 'Endpoint', exact: true })).toHaveValue(
      'https://api.x.ai/v1'
    )
    await expect(settings.locator('wa-select[aria-label="Model"]')).toHaveJSProperty(
      'value',
      'grok-4.7'
    )
  } finally {
    await app.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
