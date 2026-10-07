import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { firstWindow, launch, makeFixture, openSettings } from './fixtures'
import type { SettingsStore } from '../../src/renderer/src/state/settings'
import type { FileState } from '../../src/renderer/src/state/file-state'

type Host = { settingsStore: SettingsStore; fileState: FileState }
const names = [
  'README.md',
  'Project notes.md',
  'Ideas and references for a much longer document title.md',
  'Draft.md'
]
test.describe('Welcome screen design', () => {
  let app: ElectronApplication
  let page: Page
  let fixture: ReturnType<typeof makeFixture>
  test.beforeEach(async () => {
    const empty = test.info().title.includes('empty vault')
    fixture = makeFixture('welcome-design', empty ? [] : names)
    writeFileSync(
      join(fixture.userData, 'config.json'),
      JSON.stringify({
        files: {
          vaultPath: fixture.vault,
          recentFiles: empty ? [] : names.map((name) => join(fixture.vault, name)),
          openTabs: [],
          activeTabPath: null
        },
        appearance: { designVersion: 1, theme: 'graphite', motion: 'reduced' },
        editor: { autoSave: false }
      })
    )
    app = await launch(fixture)
    page = await firstWindow(app)
    await expect(page.locator('writemd-welcome-screen')).toBeVisible()
    await expect(page.locator('writemd-welcome-screen .recent')).toHaveAttribute(
      'aria-busy',
      'false'
    )
  })
  test.afterEach(async () => {
    await app?.close()
  })

  async function prefs(values: Record<string, unknown>): Promise<void> {
    await page.evaluate(
      (values) =>
        (document.querySelector('writemd-app') as unknown as Host).settingsStore.setMany(values),
      values
    )
  }

  test('defaults to vertical mode and shares editor chrome without the old frame', async () => {
    await expect(page.locator('writemd-shell')).toHaveAttribute('vertical', '')
    await expect(page.locator('writemd-sidebar [aria-current="page"]')).toHaveText('Home')
    await expect(
      page.locator('writemd-sidebar .footer button', { hasText: 'AI Assistant' })
    ).toBeDisabled()
    const welcome = page.locator('writemd-welcome-screen')
    await expect(welcome.locator('.recent-item')).toHaveCount(4)
    await expect(welcome.locator('writemd-panel')).toHaveJSProperty('empty', true)
    await expect(welcome.locator('.top-bar, .split-view, .watermark')).toHaveCount(0)
    await expect(page.locator('writemd-top-bar .window-controls writemd-icon-button')).toHaveCount(
      3
    )
    await expect(
      page.locator('writemd-top-bar writemd-icon-button[title="Split view"]')
    ).toHaveCount(0)
    await page.screenshot({ path: 'artifacts/ui-review/welcome-vertical-graphite.png' })
  })

  test('fits both tab layouts and compact windows across all themes', async () => {
    for (const orientation of ['vertical', 'horizontal']) {
      for (const width of [1200, 800]) {
        await app.evaluate(
          ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 650),
          width
        )
        for (const theme of ['graphite', 'dark', 'light', 'paper', 'nord', 'midnight', 'dracula']) {
          await prefs({ 'appearance.panelOrientation': orientation, 'appearance.theme': theme })
          await expect(page.locator('writemd-welcome-screen h1')).toBeVisible()
          const bounds = await page.locator('writemd-welcome-screen').evaluate((element) => {
            const panel = element.shadowRoot!.querySelector('writemd-panel')!
            const content = panel.shadowRoot!.querySelector('.content')!
            const main = element.shadowRoot!.querySelector('.home')!
            const p = content.getBoundingClientRect()
            const m = main.getBoundingClientRect()
            return {
              center: Math.abs(m.x + m.width / 2 - p.x - content.clientWidth / 2),
              overflow: main.scrollWidth - main.clientWidth,
              radius: getComputedStyle(panel).borderRadius,
              font: getComputedStyle(main).fontFamily,
              color: getComputedStyle(panel).backgroundColor
            }
          })
          expect(bounds.center).toBeLessThan(1)
          expect(bounds.overflow).toBeLessThanOrEqual(1)
          expect(bounds.radius).toBe('0px')
          expect(bounds.font).toContain('Inter')
          const headerColor = await page
            .locator('writemd-top-bar')
            .evaluate((el) => getComputedStyle(el).backgroundColor)
          expect(bounds.color).toBe(headerColor)
          if (theme === 'light' && width === 800 && orientation === 'vertical')
            await page.screenshot({ path: 'artifacts/ui-review/welcome-vertical-light-800.png' })
          if (theme === 'paper' && width === 800 && orientation === 'horizontal')
            await page.screenshot({ path: 'artifacts/ui-review/welcome-horizontal-paper-800.png' })
        }
      }
    }
    await prefs({ 'appearance.panelOrientation': 'vertical', 'appearance.theme': 'graphite' })
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setMinimumSize(800, 400)
      window.setSize(800, 420)
    })
    await page.locator('writemd-welcome-screen .utility').scrollIntoViewIfNeeded()
    await expect(page.locator('writemd-welcome-screen .utility')).toBeVisible()
    await page.screenshot({ path: 'artifacts/ui-review/welcome-short-window.png' })
  })

  test('opens recent notes by keyboard, preserves the sidebar, and returns home after closing', async () => {
    const sidebar = page.locator('writemd-sidebar')
    await sidebar.evaluate((el) => el.setAttribute('data-probe', 'home-sidebar'))
    const recent = page.locator('writemd-welcome-screen .recent-item').nth(1)
    await recent.focus()
    await page.keyboard.press('Space')
    await expect(page.locator('writemd-editor')).toBeVisible()
    await expect(page.locator('writemd-doc-bar input.title-input')).toHaveValue('Project notes')
    await expect(sidebar).toHaveAttribute('data-probe', 'home-sidebar')
    await expect(sidebar.locator('.footer button', { hasText: 'AI Assistant' })).toBeEnabled()
    await page.evaluate(async () => {
      const files = (document.querySelector('writemd-app') as unknown as Host).fileState
      await files.closeTab(files.getState().activeTab)
    })
    await expect(page.locator('writemd-welcome-screen')).toBeVisible()
    await expect(sidebar).toHaveAttribute('data-probe', 'home-sidebar')
    await page.locator('writemd-welcome-screen .primary').click()
    await expect(page.locator('writemd-editor')).toBeVisible()
    await expect(page.locator('writemd-vertical-tab-bar')).toBeVisible()
  })

  test('file picker cancellation and failed reads keep home; file/vault actions use the bridge', async () => {
    const open = page.locator('writemd-welcome-screen .actions button', { hasText: 'Open file' })
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
    })
    await open.click()
    await expect(page.locator('writemd-welcome-screen')).toBeVisible()
    await app.evaluate(
      ({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      },
      join(fixture.vault, 'missing.md')
    )
    const failedRead = page.waitForEvent('dialog')
    const click = open.click()
    const notice = await failedRead
    expect(notice.message()).toContain('Failed to open file')
    await notice.dismiss()
    await click
    await expect(page.locator('writemd-welcome-screen')).toBeVisible()
    await expect(page.locator('writemd-editor')).toHaveCount(0)
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      ipcMain.removeHandler('shell:open-path')
      ipcMain.handle('shell:open-path', (_, path: string) => {
        BrowserWindow.getAllWindows()[0].setTitle(path)
      })
    })
    await page.locator('writemd-welcome-screen .utility').click()
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()))
      .toBe(fixture.vault)
    await app.evaluate(
      ({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      },
      join(fixture.vault, names[3])
    )
    await open.click()
    await expect(page.locator('writemd-doc-bar input.title-input')).toHaveValue('Draft')
  })

  test('home settings and search remain usable while changing tab layout', async () => {
    await page.locator('writemd-sidebar writemd-search-bar button').click()
    await expect(page.locator('writemd-command-palette')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.locator('writemd-sidebar .footer button', { hasText: 'Settings' }).click()
    await expect(page.locator('writemd-settings-modal')).toBeVisible()
    await expect(page.locator('writemd-top-bar .window-controls writemd-icon-button')).toHaveCount(
      3
    )
    const search = page.locator('writemd-settings-modal .sidebar-search writemd-search-bar input')
    await search.fill('font')
    await expect(search).toHaveValue('font')
    await page.locator('writemd-settings-modal .back-btn').click()
    await prefs({ 'appearance.panelOrientation': 'horizontal' })
    await expect(page.locator('writemd-sidebar')).toHaveCount(0)
    await page.locator('writemd-welcome-screen .utility', { hasText: 'Settings' }).click()
    await expect(page.locator('writemd-settings-modal')).toBeVisible()
    await page.locator('writemd-settings-modal .back-btn').click()
    await expect(page.locator('writemd-welcome-screen')).toBeVisible()
  })

  test('empty vault shows a readable start state with working keyboard creation', async () => {
    await expect(page.locator('writemd-welcome-screen .recent-item')).toHaveCount(0)
    await expect(page.locator('writemd-welcome-screen .empty-state')).toContainText(
      'No recent notes yet'
    )
    await page.screenshot({ path: 'artifacts/ui-review/welcome-empty-vault.png' })
    await page.keyboard.press('Control+n')
    await expect(page.locator('writemd-editor')).toBeVisible()
    const state = await page.evaluate(() =>
      (document.querySelector('writemd-app') as unknown as Host).fileState.getState()
    )
    expect(state.tabs).toHaveLength(1)
    expect(state.path).toContain(fixture.vault)
  })

  test('home uses the image background empty-view strength and scope', async () => {
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 600
      canvas.height = 300
      const context = canvas.getContext('2d')!
      const gradient = context.createLinearGradient(0, 0, 600, 300)
      gradient.addColorStop(0, '#14223d')
      gradient.addColorStop(1, '#944937')
      context.fillStyle = gradient
      context.fillRect(0, 0, 600, 300)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    const imagePath = join(fixture.vault, 'background.png')
    writeFileSync(imagePath, Buffer.from(image, 'base64'))
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, imagePath)
    await openSettings(page)
    await page.locator('writemd-settings-modal .nav-btn', { hasText: 'Appearance' }).click()
    await page.locator('writemd-background-controls wa-button', { hasText: 'Choose image' }).click()
    await prefs({
      'appearance.backgroundTarget': 'workspace',
      'appearance.backgroundShowOn': 'empty',
      'appearance.backgroundEmptyOpacity': 31
    })
    await page.locator('writemd-settings-modal .back-btn').click()
    const background = page.locator('writemd-welcome-screen writemd-background img')
    await expect(background).toHaveCSS('opacity', '0.31')
    await page.screenshot({ path: 'artifacts/ui-review/welcome-image-background.png' })
    await prefs({ 'appearance.backgroundTarget': 'ai' })
    await expect(background).toHaveCSS('opacity', '0')
  })
})
