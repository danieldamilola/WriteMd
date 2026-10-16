import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { firstWindow, launch, makeFixture, openSettings, resizeWindow } from './fixtures'
import type { FileState } from '../../src/renderer/src/state/file-state'
import type { SettingsStore } from '../../src/renderer/src/state/settings'

type Host = { fileState: FileState; settingsStore: SettingsStore }
test.setTimeout(120_000)

async function insideViewport(page: Page, selector: string): Promise<void> {
  const bounds = await page.locator(selector).boundingBox()
  const viewport =
    page.viewportSize() ??
    (await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })))
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
}

test('collapsed Space icons open searchable folder cards with nested folders and creation actions', async () => {
  const fixture = makeFixture('folder-cards')
  writeFileSync(join(fixture.vault, 'Untitled.md'), '# Existing note\n')
  const configPath = join(fixture.userData, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.appearance = {
    ...config.appearance,
    theme: 'graphite',
    motion: 'reduced',
    panelOrientation: 'vertical'
  }
  config.files.openTabs = ['README.md', 'PRD.md', 'CHANGELOG.md'].map((name) =>
    join(fixture.vault, name)
  )
  writeFileSync(configPath, JSON.stringify(config))
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await resizeWindow(app, 1100, 720)
    await expect(page.locator('writemd-vertical-tab-bar writemd-tab')).toHaveCount(3)
    const ids = await page.evaluate(() => {
      const files = (document.querySelector('writemd-app') as unknown as Host).fileState
      const main = files.createTabGroup('YouTube', 'star', [0])
      const nested = files.createTabGroup('Scripts', undefined, [1])
      files.moveTabGroup(nested, main)
      files.createTabGroup('Research', undefined, [2])
      return { main, nested }
    })
    await page
      .locator('writemd-sidebar')
      .getByRole('button', { name: 'Collapse panel', exact: true })
      .click()
    const rail = page.locator('writemd-sidebar')
    const trigger = rail.locator(`.slim-group[data-group-id="${ids.main}"]`)
    await trigger.click()
    const card = page.locator('writemd-group-card')
    await expect(card.getByRole('searchbox', { name: 'Search folder' })).toBeFocused()
    await expect(rail.getByRole('button', { name: 'Expand panel', exact: true })).toBeVisible()
    await expect(card.getByRole('button', { name: 'README.md', exact: true })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Scripts', exact: true })).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await expect(card.getByRole('button', { name: 'Scripts', exact: true })).toBeFocused()
    await card.getByRole('searchbox', { name: 'Search folder' }).focus()
    await insideViewport(page, 'writemd-group-card .m-panel')
    await page.screenshot({ path: 'artifacts/ui-review/folder-card-graphite.png' })
    await card.getByRole('searchbox', { name: 'Search folder' }).fill('PRD')
    await expect(card.getByRole('button', { name: 'PRD.md', exact: true })).toBeVisible()
    await card.getByRole('button', { name: 'PRD.md', exact: true }).click()
    await expect(card).toHaveCount(0)
    await expect(rail.getByRole('button', { name: 'Expand panel', exact: true })).toBeVisible()
    expect(
      await page.evaluate(() => {
        const state = (
          document.querySelector('writemd-app') as unknown as Host
        ).fileState.getState()
        return state.tabs[state.activeTab].path
      })
    ).toContain('PRD.md')
    await trigger.click()
    await card.getByRole('button', { name: 'Scripts', exact: true }).click()
    await expect(card.getByRole('button', { name: 'PRD.md', exact: true })).toBeVisible()
    await card.getByRole('button', { name: 'New folder', exact: true }).click()
    await card.getByRole('textbox', { name: 'Folder name', exact: true }).fill('Drafts')
    await card.getByRole('textbox', { name: 'Folder name', exact: true }).press('Enter')
    await expect(card.locator('.heading')).toContainText('Drafts')
    await expect(card.locator('.empty')).toHaveText('This folder is empty.')
    const draft = await page.evaluate(() =>
      (document.querySelector('writemd-app') as unknown as Host).fileState
        .getState()
        .tabGroups?.find((group) => group.label === 'Drafts')
    )
    expect(draft?.parentId).toBe(ids.nested)
    await card.getByRole('button', { name: 'New note', exact: true }).click()
    await expect(card).toHaveCount(0)
    expect(
      await page.evaluate(() => {
        const state = (
          document.querySelector('writemd-app') as unknown as Host
        ).fileState.getState()
        return state.tabs[state.activeTab]
      })
    ).toMatchObject({ groupId: draft!.id, dirty: false })
    expect(readFileSync(join(fixture.vault, 'Untitled.md'), 'utf8')).toBe('# Existing note\n')
    await rail.locator(`.slim-group[data-group-id="${draft!.id}"]`).click()
    await expect(card.getByRole('button', { name: 'Untitled 2.md', exact: true })).toBeVisible()
    await card.getByRole('button', { name: 'New note', exact: true }).click()
    await expect(card).toHaveCount(0)
    expect(
      await page.evaluate(() => {
        const state = (
          document.querySelector('writemd-app') as unknown as Host
        ).fileState.getState()
        return state.tabs[state.activeTab].path
      })
    ).toContain('Untitled 3.md')
    await resizeWindow(app, 800, 540)
    await page.evaluate(() =>
      (document.querySelector('writemd-app') as unknown as Host).settingsStore.set(
        'appearance.theme',
        'paper'
      )
    )
    await trigger.click()
    await expect(card).toBeAttached()
    await insideViewport(page, 'writemd-group-card .m-panel')
    await page.screenshot({ path: 'artifacts/ui-review/folder-card-paper.png' })
    await page.keyboard.press('Escape')
    await expect(card).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await trigger.click()
    await trigger.click()
    await expect(card).toHaveCount(0)
  } finally {
    await app.close()
    fixture.cleanup()
  }
})

test('model options work in chat and Settings, retain each model choice, and match provider icons', async () => {
  const fixture = makeFixture('model-options')
  const configPath = join(fixture.userData, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.appearance = { ...config.appearance, theme: 'graphite', motion: 'reduced' }
  config.ai = {
    enabled: true,
    providerId: 'chatgpt',
    model: 'gpt-6.1-sol',
    cachedModels: ['gpt-6.1-sol', 'gpt-5.1']
  }
  writeFileSync(configPath, JSON.stringify(config))
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      const state = {
        connected: true,
        pending: false,
        activeId: 'account',
        accounts: [{ id: 'account', label: 'writer@example.test' }],
        error: null,
        sessionOnly: false,
        needsWelcome: false
      }
      for (const channel of ['ai:chatgpt-state', 'ai:chatgpt-models'])
        ipcMain.removeHandler(channel)
      ipcMain.handle('ai:chatgpt-state', () => state)
      ipcMain.handle('ai:chatgpt-models', () => [
        { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
        { id: 'gpt-5.1', label: 'GPT-5.1' }
      ])
      BrowserWindow.getAllWindows()[0].webContents.send('ai:chatgpt-auth', state)
    })
    await resizeWindow(app, 1250, 800)
    await page.keyboard.press('Control+Alt+Shift+A')
    const composer = page.locator('writemd-ai-dock writemd-ai-composer')
    const options = composer.locator('writemd-ai-model-options')
    await expect(options.getByRole('button', { name: 'Model options', exact: true })).toBeVisible()
    await options.getByRole('button', { name: 'Model options', exact: true }).click()
    await options.getByRole('radio', { name: 'High', exact: true }).click()
    await options.getByRole('radio', { name: 'Fast', exact: true }).click()
    await expect(options.getByRole('radio', { name: 'Fast', exact: true })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await insideViewport(page, 'writemd-ai-dock writemd-ai-model-options .m-panel')
    await page.screenshot({ path: 'artifacts/ui-review/ai-model-options-graphite.png' })
    await page.keyboard.press('Escape')
    await expect(options.getByRole('button', { name: 'Model options', exact: true })).toBeFocused()
    await expect(options.getByRole('button', { name: 'Model options', exact: true })).toContainText(
      'High · Fast'
    )
    await expect(
      composer.locator('writemd-ai-model-picker .trigger [data-provider-icon="chatgpt"]')
    ).toBeVisible()
    await composer.getByRole('button', { name: 'Choose AI model', exact: true }).click()
    await composer.getByRole('option', { name: 'GPT-5.1', exact: true }).click()
    await expect(options.getByRole('button', { name: 'Model options', exact: true })).toContainText(
      'Default'
    )
    await composer.getByRole('button', { name: 'Choose AI model', exact: true }).click()
    await composer.getByRole('option', { name: 'GPT-6.1 Sol', exact: true }).click()
    await expect(options.getByRole('button', { name: 'Model options', exact: true })).toContainText(
      'High · Fast'
    )
    await resizeWindow(app, 800, 650)
    await page.evaluate(() =>
      (document.querySelector('writemd-app') as unknown as Host).settingsStore.set(
        'appearance.theme',
        'paper'
      )
    )
    const fits = await composer.evaluate((host) => {
      const box = host.getBoundingClientRect()
      return [...host.shadowRoot!.querySelectorAll('.actions > *')].every((element) => {
        const bounds = element.getBoundingClientRect()
        return !bounds.width || (bounds.left >= box.left && bounds.right <= box.right)
      })
    })
    expect(fits).toBe(true)
    await options.getByRole('button', { name: 'Model options', exact: true }).click()
    await insideViewport(page, 'writemd-ai-dock writemd-ai-model-options .m-panel')
    await page.screenshot({ path: 'artifacts/ui-review/ai-model-options-paper.png' })
    await page.keyboard.press('Escape')
    await openSettings(page)
    const settings = page.locator('writemd-settings-modal')
    await settings.getByRole('button', { name: 'AI assistant', exact: true }).click()
    const settingsOptions = settings.locator('writemd-ai-model-options')
    await settingsOptions.getByRole('button', { name: 'Model options', exact: true }).click()
    await expect(settingsOptions.getByRole('radio', { name: 'High', exact: true })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await expect(settingsOptions.getByRole('radio', { name: 'Fast', exact: true })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await settingsOptions.getByRole('radio', { name: 'Standard', exact: true }).click()
    await page.screenshot({ path: 'artifacts/ui-review/ai-model-options-settings.png' })
    await page.keyboard.press('Escape')
    await settings.locator('wa-select[aria-label="Provider"]').click()
    await expect(
      settings.locator('wa-option[value="deepseek"] [data-provider-icon="deepseek"]')
    ).toBeVisible()
    await page.screenshot({ path: 'artifacts/ui-review/ai-provider-icons.png' })
    await page.keyboard.press('Escape')
    await expect
      .poll(
        () =>
          JSON.parse(readFileSync(configPath, 'utf8')).ai.modelPreferences[
            JSON.stringify(['chatgpt', 'gpt-6.1-sol'])
          ]
      )
      .toEqual({ reasoning: 'high', serviceTier: 'default' })
    await page.reload()
    expect(
      await page.evaluate(
        async () =>
          (await window.electronAPI!.settings.get()).ai.modelPreferences[
            JSON.stringify(['chatgpt', 'gpt-6.1-sol'])
          ]
      )
    ).toEqual({ reasoning: 'high', serviceTier: 'default' })
  } finally {
    await app.close()
    fixture.cleanup()
  }
})

test('sidebar update card names the target version and exposes upcoming fixes without starting a download', async () => {
  const fixture = makeFixture('update-card')
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await resizeWindow(app, 1000, 650)
    await page.evaluate(() =>
      (document.querySelector('writemd-app') as unknown as Host).settingsStore.setMany({
        'appearance.panelOrientation': 'vertical',
        'appearance.theme': 'graphite',
        'appearance.motion': 'reduced'
      })
    )
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      const snapshot = {
        status: 'available',
        version: '0.2.0',
        percent: 0,
        error: '',
        releaseNotes:
          '- Fixed nested folder navigation\n- Added model reasoning controls\n- Improved provider icons'
      }
      ipcMain.removeHandler('updater:get-state')
      ipcMain.handle('updater:get-state', () => snapshot)
      ipcMain.removeHandler('updater:download')
      ipcMain.handle('updater:download', () => {
        throw new Error('Download should not start during hover')
      })
      BrowserWindow.getAllWindows()[0].webContents.send('updater:update-available', snapshot)
    })
    const update = page.locator('writemd-sidebar writemd-update-button')
    await expect(update.locator('.sidebar-action')).toHaveText('Update to v0.2.0')
    expect((await update.locator('.sidebar-action').boundingBox())!.height).toBeLessThanOrEqual(34)
    await page.screenshot({ path: 'artifacts/ui-review/sidebar-update-compact-graphite.png' })
    await update.locator('.sidebar-action').hover()
    await expect(update.getByRole('dialog', { name: 'Update details' })).toBeVisible()
    await expect(update.locator('.card')).toContainText('Fixed nested folder navigation')
    await insideViewport(page, 'writemd-sidebar writemd-update-button .card')
    await page.screenshot({ path: 'artifacts/ui-review/sidebar-update-details.png' })
    await page.evaluate(() =>
      (document.querySelector('writemd-app') as unknown as Host).settingsStore.set(
        'appearance.theme',
        'paper'
      )
    )
    await page.mouse.move(600, 250)
    await expect(update.locator('.card')).toHaveCount(0)
    await expect(update.locator('.sidebar-action')).toHaveText('Update to v0.2.0')
    expect((await update.locator('.sidebar-action').boundingBox())!.height).toBeLessThanOrEqual(34)
    await page.screenshot({ path: 'artifacts/ui-review/sidebar-update-compact-paper.png' })
    await update.locator('.sidebar-action').hover()
    await update.getByRole('button', { name: 'Skip this version' }).hover()
    await page.waitForTimeout(250)
    await expect(update.getByRole('button', { name: 'Skip this version' })).toBeVisible()
    await page
      .locator('writemd-sidebar')
      .getByRole('button', { name: 'Collapse panel', exact: true })
      .click()
    await update.locator('.action').focus()
    await expect(update.locator('.card')).toContainText('Fixed nested folder navigation')
    await page.screenshot({ path: 'artifacts/ui-review/collapsed-update-details.png' })
    await page
      .locator('writemd-sidebar')
      .getByRole('button', { name: 'Expand panel', exact: true })
      .click()
    await update.locator('.sidebar-action').focus()
    await expect(update.getByRole('button', { name: 'Skip this version' })).toBeVisible()
    await update.getByRole('button', { name: 'Skip this version' }).click()
    await expect(update.locator('.sidebar-action')).toHaveCount(0)
    await expect
      .poll(
        () =>
          JSON.parse(readFileSync(join(fixture.userData, 'config.json'), 'utf8')).updates
            .skippedVersion
      )
      .toBe('0.2.0')
  } finally {
    await app.close()
    fixture.cleanup()
  }
})
