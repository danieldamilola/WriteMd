import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createServer } from 'http'
import {
  chooseSettingsOption,
  firstWindow,
  launch,
  makeFixture,
  openSettings,
  resizeWindow
} from './fixtures'

test.setTimeout(120_000)

async function checkControls(page: Page): Promise<void> {
  const overflow = await page.locator('writemd-settings-modal').evaluate((host) => {
    const root = host.shadowRoot!
    const sections = [...root.querySelectorAll<HTMLElement>('.ai-settings .section')]
    return sections.flatMap((section) => {
      const bounds = section.getBoundingClientRect()
      return [...section.querySelectorAll<HTMLElement>('button, input, wa-select')]
        .filter((control) => {
          const rect = control.getBoundingClientRect()
          return rect.width && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
        })
        .map((control) => control.getAttribute('aria-label') ?? control.textContent?.trim())
    })
  })
  expect(overflow).toEqual([])
}

test('AI settings group connection and conversation controls and fit both window sizes', async () => {
  const server = createServer((request, response) => {
    if (request.url?.endsWith('/models')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'test-model' }] }))
    } else response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Provider did not start')
  const fixture = makeFixture('ai-settings-layout')
  const configPath = join(fixture.userData, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.appearance.theme = 'graphite'
  config.appearance.motion = 'reduced'
  config.ai = {
    enabled: true,
    providerId: 'openai',
    baseUrl: `http://127.0.0.1:${address.port}/v1`
  }
  writeFileSync(configPath, JSON.stringify(config))
  const folder = join(fixture.vault, 'Skills')
  mkdirSync(folder)
  writeFileSync(
    join(folder, 'youtube.md'),
    '# Work with video transcripts\n' + 'Guidance.\n'.repeat(2100)
  )
  writeFileSync(
    join(folder, 'writing-for-agents.md'),
    '# Write clear instructions\nKeep instructions concise.'
  )
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await resizeWindow(app, 1400, 1100)
    await openSettings(page)
    const modal = page.locator('writemd-settings-modal')
    await modal.getByRole('button', { name: 'AI assistant', exact: true }).click()
    await expect(modal.locator('.section-title')).toHaveText([
      'Assistant',
      'Connection',
      'Conversation',
      'Privacy'
    ])
    const connection = modal
      .locator('.section')
      .filter({ has: page.locator('wa-select[aria-label="Provider"]') })
    await expect(connection.getByLabel('API Key', { exact: true })).toBeVisible()
    await expect(connection.locator('wa-select[aria-label="Model"]')).toBeVisible()
    const conversation = modal
      .locator('.section')
      .filter({ has: page.getByLabel('Chat history', { exact: true }) })
    await expect(
      conversation.getByRole('switch', { name: 'Automatically accept AI edits' })
    ).toBeVisible()
    await expect(conversation.locator('wa-select[aria-label="Output limit"]')).toBeVisible()
    await expect(modal).not.toContainText('16 KB')
    await modal.getByLabel('API Key', { exact: true }).fill('fixture-key-not-a-real-credential')
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(modal.getByRole('button', { name: 'Clear', exact: true })).toBeVisible()
    await modal.getByRole('button', { name: 'Fetch models' }).click()
    await expect(
      modal.locator('wa-select[aria-label="Model"] wa-option[value="test-model"]')
    ).toHaveCount(1)
    await checkControls(page)
    await modal.locator('wa-select[aria-label="Provider"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'artifacts/ui-review/ai-settings-organized-graphite.png' })

    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      const state = {
        connected: true,
        pending: false,
        activeId: 'fixture-account',
        accounts: [{ id: 'fixture-account', label: 'writer@example.test · Account 1' }],
        error: null,
        sessionOnly: false,
        needsWelcome: false
      }
      ipcMain.removeHandler('ai:chatgpt-state')
      ipcMain.handle('ai:chatgpt-state', () => state)
      ipcMain.removeHandler('ai:chatgpt-models')
      ipcMain.handle('ai:chatgpt-models', () => [{ id: 'fixture-model', label: 'Test model' }])
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send('ai:chatgpt-auth', state)
    })
    await chooseSettingsOption(page, 'Provider', 'chatgpt')
    await expect(modal.locator('wa-select[aria-label="ChatGPT account"]')).toBeVisible()
    await expect(modal.getByLabel('Endpoint', { exact: true })).toHaveCount(0)
    await expect(modal.getByRole('button', { name: 'Continue with ChatGPT' })).toHaveCount(0)
    await expect(modal.getByRole('button', { name: 'Add account', exact: true })).toBeVisible()
    const accountBounds = await modal
      .locator('wa-select[aria-label="ChatGPT account"]')
      .boundingBox()
    expect(accountBounds!.height).toBeLessThan(50)
    await modal.getByRole('button', { name: 'Fetch models' }).click()
    await expect(modal.locator('wa-option[value="fixture-model"]')).toHaveCount(1)
    await checkControls(page)
    await page.evaluate(() => {
      const host = document.querySelector('writemd-app') as unknown as {
        settingsStore: { set(key: string, value: unknown): void }
      }
      host.settingsStore.set('appearance.theme', 'paper')
    })
    await modal.locator('wa-select[aria-label="Provider"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'artifacts/ui-review/ai-settings-organized-paper.png' })
    await modal.getByRole('button', { name: 'Skills', exact: true }).click()
    await expect(modal.getByRole('list', { name: 'Available skills' })).toContainText('/youtube')
    await modal.getByRole('list', { name: 'Available skills' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'artifacts/ui-review/ai-settings-organized-skills.png' })

    await modal.getByRole('button', { name: 'AI assistant', exact: true }).click()
    await resizeWindow(app, 800, 700)
    await modal.locator('wa-select[aria-label="ChatGPT account"]').scrollIntoViewIfNeeded()
    await checkControls(page)
    await page.screenshot({ path: 'artifacts/ui-review/ai-settings-organized-compact.png' })
    await modal.getByLabel('Chat history', { exact: true }).fill('12')
    await modal.getByLabel('Chat history', { exact: true }).press('Tab')
    await expect.poll(() => JSON.parse(readFileSync(configPath, 'utf8')).ai.historyTurns).toBe(12)
  } finally {
    await app.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    fixture.cleanup()
  }
})
