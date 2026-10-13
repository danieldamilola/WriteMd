import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow, resizeWindow } from './fixtures'
import type { SettingsStore } from '../../src/renderer/src/state/settings'

test.setTimeout(120000)

test('sidebar AI controls and resizing remain usable at native window sizes', async () => {
  const fixture = makeFixture('ai-sidebar-resize')
  const configPath = join(fixture.userData, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.appearance.panelOrientation = 'vertical'
  config.appearance.motion = 'reduced'
  config.ai = { enabled: true }
  writeFileSync(configPath, JSON.stringify(config))
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await resizeWindow(app, 1400, 900)
    const sidebar = page.locator('writemd-sidebar')
    await expect(sidebar.getByRole('button', { name: 'AI assistant', exact: true })).toBeVisible()
    await expect(sidebar.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
    const expandedSettings = await sidebar
      .getByRole('button', { name: 'Settings', exact: true })
      .boundingBox()
    const expandedAi = await sidebar
      .getByRole('button', { name: 'AI assistant', exact: true })
      .boundingBox()
    expect(expandedAi!.x - expandedSettings!.x).toBeGreaterThan(100)
    // The sidebar AI icon opens the floating bar; the panel is its own surface.
    await sidebar.getByRole('button', { name: 'AI assistant', exact: true }).click()
    await expect(page.locator('writemd-ai-quick')).toBeVisible()
    await page.keyboard.press('Control+Alt+Shift+A')
    const dock = page.locator('writemd-ai-dock')
    await expect(dock).toBeVisible()
    const separator = page.getByRole('separator', { name: 'Resize AI assistant' })
    await separator.focus()
    await separator.press('ArrowLeft')
    await expect(separator).toHaveAttribute('aria-valuenow', '376')
    await expect
      .poll(() => JSON.parse(readFileSync(configPath, 'utf8')).appearance.aiDockWidth)
      .toBe(376)

    const handle = await separator.boundingBox()
    if (!handle) throw new Error('Assistant separator is missing')
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x - 76, handle.y + handle.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect
      .poll(() => JSON.parse(readFileSync(configPath, 'utf8')).appearance.aiDockWidth)
      .toBe(456)
    await expect(separator).toHaveAttribute('aria-valuenow', '456')
    await expect(dock).toContainText('Ask about your note')
    await page.locator('#primary-cm-wrapper .cm-content').click()
    await page.screenshot({ path: 'artifacts/ui-review/ai-sidebar-resized.png' })

    await page.keyboard.press('Control+b')
    await expect(sidebar.locator('.slim')).toBeVisible()
    const assistant = await sidebar
      .getByRole('button', { name: 'AI assistant', exact: true })
      .boundingBox()
    const settings = await sidebar
      .getByRole('button', { name: 'Settings', exact: true })
      .boundingBox()
    expect(assistant!.y + assistant!.height).toBeLessThanOrEqual(settings!.y)
    await page.screenshot({ path: 'artifacts/ui-review/ai-sidebar-collapsed.png' })
    await page.keyboard.press('Control+b')
    await expect(sidebar.locator('.footer-actions')).toBeVisible()

    await resizeWindow(app, 800, 600)
    await expect.poll(async () => (await dock.boundingBox())?.width).toBeLessThanOrEqual(432)
    const bounds = await dock.boundingBox()
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(801)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(601)
    await page.screenshot({ path: 'artifacts/ui-review/ai-sidebar-compact.png' })
    await resizeWindow(app, 1400, 900)
    await expect(separator).toHaveAttribute('aria-valuenow', '456')
    await page.screenshot({ path: 'artifacts/ui-review/ai-sidebar-resized.png' })

    await dock
      .locator('writemd-ai-composer')
      .getByRole('button', { name: 'Settings', exact: true })
      .click()
    const settingsPage = page.locator('writemd-settings-modal')
    await expect(settingsPage.getByLabel('API Key', { exact: true })).toBeVisible()
    await settingsPage.getByRole('button', { name: 'Back to editor', exact: true }).click()
    await dock.getByRole('button', { name: 'Close assistant', exact: true }).click()
    // The saved width outlives the panel being closed.
    await page.keyboard.press('Control+Alt+Shift+A')
    await expect(separator).toHaveAttribute('aria-valuenow', '456')
  } finally {
    await app.close()
  }
})

test('horizontal mode offers the AI icon beside the right toolbar controls', async () => {
  const fixture = makeFixture('ai-horizontal-toolbar')
  const configPath = join(fixture.userData, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.appearance.panelOrientation = 'horizontal'
  config.appearance.motion = 'reduced'
  config.ai = { enabled: true }
  writeFileSync(configPath, JSON.stringify(config))
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await resizeWindow(app, 1400, 900)
    const topbar = page.locator('writemd-top-bar')
    const assistant = topbar.getByRole('button', { name: 'AI assistant', exact: true })
    await expect(assistant).toBeVisible()
    const aiBounds = await assistant.boundingBox()
    const minimize = await topbar
      .getByRole('button', { name: 'Minimize', exact: true })
      .boundingBox()
    expect(aiBounds!.x).toBeGreaterThan(1000)
    expect(aiBounds!.x + aiBounds!.width).toBeLessThanOrEqual(minimize!.x)

    // The toolbar icon opens the floating bar, not the panel.
    await assistant.click()
    await expect(page.locator('writemd-ai-quick')).toBeVisible()
    await expect(page.locator('writemd-ai-dock')).toHaveCount(0)
    await expect(assistant).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: 'artifacts/ui-review/ai-toolbar-horizontal.png' })
    await resizeWindow(app, 800, 600)
    await expect(assistant).toBeVisible()
    const bar = page.locator('writemd-ai-quick')
    const barBox = (await bar.boundingBox())!
    const compact = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(compact.width)
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(compact.height)
    await page.screenshot({ path: 'artifacts/ui-review/ai-toolbar-horizontal-compact.png' })

    // Clicking the icon again is how the bar closes.
    await assistant.click()
    await expect(page.locator('writemd-ai-quick')).toHaveCount(0)
    await expect(assistant).toHaveAttribute('aria-pressed', 'false')

    // The panel keeps its own hotkey.
    await page.keyboard.press('Control+Alt+Shift+A')
    await expect(page.locator('writemd-ai-dock')).toBeVisible()
    await page.evaluate(() => {
      const appHost = document.querySelector('writemd-app') as unknown as {
        settingsStore: SettingsStore
      }
      appHost.settingsStore.set('ai.enabled', false)
    })
    await expect(assistant).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('the sidebar can open a chat on home without creating a document', async () => {
  const fixture = makeFixture('ai-sidebar-home')
  const configPath = join(fixture.userData, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.files.openTabs = []
  config.files.activeTabPath = null
  config.appearance.panelOrientation = 'vertical'
  config.ai = { enabled: true }
  writeFileSync(configPath, JSON.stringify(config))
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await expect(page.locator('writemd-welcome-screen')).toBeVisible()
    await page
      .locator('writemd-sidebar')
      .getByRole('button', { name: 'AI assistant', exact: true })
      .click()
    // With no note open the bar still works: it asks about nothing in
    // particular, and neither surface creates a document to do it.
    await expect(page.locator('writemd-ai-quick')).toBeVisible()
    await expect(page.locator('writemd-welcome-screen')).toBeVisible()
    await page.screenshot({ path: 'artifacts/ui-review/ai-sidebar-home-bar.png' })
    await page.keyboard.press('Control+Alt+Shift+A')
    await expect(page.locator('writemd-ai-dock')).toBeVisible()
    await expect(page.locator('writemd-ai-dock')).toContainText('No document open')
    await page.screenshot({ path: 'artifacts/ui-review/ai-sidebar-home.png' })
    await page
      .locator('writemd-ai-dock')
      .getByRole('button', { name: 'Close assistant', exact: true })
      .click()
    await expect(page.locator('writemd-welcome-screen')).toBeVisible()
  } finally {
    await app.close()
  }
})
