import { test, expect, type Page } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'

/**
 * The assistant is off by default and stays hidden until it is turned on, which
 * is the first thing to get wrong: a panel that appears in a fresh profile
 * cannot make a request, so the app looks broken rather than unconfigured.
 */
test.setTimeout(120000)

async function open(name: string, aiEnabled: boolean): Promise<Page> {
  const fixture = makeFixture(`ai-${name}`)
  const config = {
    files: {
      vaultPath: fixture.vault,
      recentFiles: [],
      openTabs: [join(fixture.vault, 'README.md')],
      activeTabPath: join(fixture.vault, 'README.md')
    },
    appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical' },
    ai: {
      enabled: aiEnabled,
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKeySet: false,
      historyTurns: 8,
      cachedModels: []
    }
  }
  writeFileSync(join(fixture.userData, 'config.json'), JSON.stringify(config, null, 2), 'utf-8')
  const app = await launch(fixture)
  const page = await firstWindow(app)
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.waitForTimeout(1600)
  return page
}

test('the dock is hidden until it is asked for', async () => {
  const page = await open('closed', true)
  await expect(page.locator('writemd-ai-dock')).toHaveCount(0)

  await page.keyboard.press('Control+Alt+A')
  await page.waitForTimeout(600)
  await expect(page.locator('writemd-ai-dock')).toHaveCount(1)

  // And it closes again, from its own close control.
  await page.locator('writemd-ai-dock').getByLabel('Close assistant').click()
  await page.waitForTimeout(400)
  await expect(page.locator('writemd-ai-dock')).toHaveCount(0)
  await page.context().close()
})

test('the dock narrows the editor rather than covering it', async () => {
  const page = await open('layout', true)
  // boundingBox, not page.evaluate: the dock lives inside the editor's shadow
  // root, and document.querySelector does not pierce one - which reads as the
  // element being zero-width when it is in fact rendering.
  const editorWidth = async (): Promise<number> =>
    (await page.locator('writemd-editor .body-area').boundingBox())?.width ?? 0

  const before = await editorWidth()
  await page.keyboard.press('Control+Alt+A')
  await page.waitForTimeout(800)
  const after = await editorWidth()
  const dock = await page.locator('writemd-ai-dock').boundingBox()

  expect(dock?.width ?? 0).toBeGreaterThan(200)
  // The editor gave up width rather than being overlapped.
  expect(after).toBeLessThan(before)
  expect(after).toBeGreaterThan(0)
  await page.screenshot({ path: 'artifacts/ui-review/ai-dock.png' })
  await page.context().close()
})

test('the assistant stays hidden while it is switched off in settings', async () => {
  const page = await open('disabled', false)
  await page.keyboard.press('Control+Alt+A')
  await page.waitForTimeout(600)
  // The command is still bound, but there is nothing to drive without a provider.
  await expect(page.locator('writemd-ai-dock')).toHaveCount(0)
  await page.context().close()
})

test('the settings tab fetches models and refuses to send a key over plain http', async () => {
  const page = await open('settings', true)
  await page.keyboard.press('Control+,')
  await page.waitForTimeout(700)
  await page
    .getByRole('button', { name: /ai assistant/i })
    .first()
    .click()
  await page.waitForTimeout(500)

  // The Fetch button is what the user asked to keep from the old panel.
  await expect(page.getByRole('button', { name: 'Fetch models' })).toBeVisible()
  // A local provider is offered, and needs no key. Scoped to the select itself:
  // getByLabel on a WebAwesome select also matches the listbox it labels.
  await expect(page.locator('wa-select[aria-label="Provider"]')).toHaveCount(1)
  await expect(page.locator('wa-select[aria-label="Model"]')).toHaveCount(1)
  await expect(page.getByLabel('API Key')).toBeVisible()
  await page.screenshot({ path: 'artifacts/ui-review/ai-settings.png' })
  await page.context().close()
})
