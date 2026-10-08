import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'path'
import { writeFileSync, existsSync } from 'fs'
import { makeFixture, launch, firstWindow } from './fixtures'
import type { FileState } from '../../src/renderer/src/state/file-state'
import type { SettingsStore } from '../../src/renderer/src/state/settings'
import type { EditorView } from '@codemirror/view'
import type { UpdaterState } from '../../src/shared/electron-api'

type Host = { fileState: FileState; settingsStore: SettingsStore }
type TestWindow = {
  calls?: { download: number; install: number }
  exported?: { content: string; path: string }
}

test.describe('Pane menus and sidebar updates', () => {
  let app: ElectronApplication
  let page: Page
  let fixture: ReturnType<typeof makeFixture>
  const secondaryContent = '# Pane B\n\npane-only-target\n'
  test.beforeEach(async () => {
    fixture = makeFixture('pane-menus-updates')
    writeFileSync(join(fixture.vault, 'PRD.md'), secondaryContent)
    app = await launch(fixture)
    page = await firstWindow(app)
    await page.evaluate(() => {
      const host = document.querySelector('writemd-app') as unknown as Host
      host.settingsStore.setMany({
        'appearance.panelOrientation': 'vertical',
        'appearance.theme': 'graphite',
        'appearance.motion': 'reduced'
      })
    })
  })
  test.afterEach(async () => {
    await app?.close()
  })

  async function openSecondary(): Promise<void> {
    await page.evaluate(
      async (path) => {
        const result = await window.electronAPI!.file.read(path)
        await (
          document.querySelector('writemd-app') as unknown as Host
        ).fileState.openSecondaryFile(path, result.content)
      },
      join(fixture.vault, 'PRD.md')
    )
    await expect(page.locator('writemd-doc-bar[secondary]')).toBeVisible()
  }
  async function secondaryAction(id: string): Promise<void> {
    const bar = page.locator('writemd-doc-bar[secondary]')
    await bar.locator('[aria-label="More Options"]').click()
    await bar.locator(`.note-menu [data-id="${id}"]`).click()
  }

  for (const shared of [false, true]) {
    test(`deleting a dirty ${shared ? 'shared' : 'secondary'} document keeps it deleted`, async () => {
      const path = join(fixture.vault, shared ? 'README.md' : 'PRD.md')
      await page.evaluate(async (path) => {
        const host = document.querySelector('writemd-app') as unknown as Host
        host.settingsStore.set('editor.autoSave', false)
        const result = await window.electronAPI!.file.read(path)
        await host.fileState.openSecondaryFile(path, result.content)
        host.fileState.setSecondaryContent('Unsaved edits to delete')
      }, path)
      await secondaryAction('delete')
      const confirmation = page.locator('writemd-confirm')
      await expect(confirmation.locator('p')).toContainText('to trash?')
      await confirmation.getByRole('button', { name: 'OK', exact: true }).click()
      await expect(page.locator('writemd-doc-bar[secondary]')).toHaveCount(0)
      await expect(confirmation.locator('button')).toHaveCount(0)
      expect(existsSync(path)).toBe(false)
      const state = await page.evaluate(() =>
        (document.querySelector('writemd-app') as unknown as Host).fileState.getState()
      )
      expect(state.tabs.some((tab) => tab.path === path)).toBe(false)
      expect(state.secondaryDoc).toBeNull()
    })
  }
  async function update(status: UpdaterState['status'], percent = 0): Promise<void> {
    await app.evaluate(
      ({ BrowserWindow, ipcMain }, { status, percent }) => {
        const snapshot = { status, percent, version: '1.9.9', error: '' }
        ipcMain.removeHandler('updater:get-state')
        ipcMain.handle('updater:get-state', () => snapshot)
        const channel = {
          idle: 'update-not-available',
          checking: 'update-not-available',
          available: 'update-available',
          downloading: 'download-progress',
          downloaded: 'update-downloaded',
          error: 'error'
        }[status]
        BrowserWindow.getAllWindows()[0].webContents.send(`updater:${channel}`, snapshot)
      },
      { status, percent }
    )
  }

  test('secondary menu changes its own mode, exports its own contents, and closes its own pane', async () => {
    await openSecondary()
    const primaryMode = await page.evaluate(
      () => (document.querySelector('writemd-app') as unknown as Host).fileState.getState().viewMode
    )
    await secondaryAction('source')
    await expect(
      page.locator('writemd-panel[slot="auxiliary"] writemd-info-pill')
    ).toHaveJSProperty('mode', 'source')
    expect(
      await page.evaluate(
        () =>
          (document.querySelector('writemd-app') as unknown as Host).fileState.getState().viewMode
      )
    ).toBe(primaryMode)
    await app.evaluate(({ BrowserWindow, ipcMain }) => {
      ipcMain.removeHandler('export:pdf')
      ipcMain.handle('export:pdf', (_, content: string, path: string) => {
        ;(BrowserWindow.getAllWindows()[0] as unknown as TestWindow).exported = { content, path }
        return { ok: true }
      })
    })
    await secondaryAction('pdf')
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }) =>
            (BrowserWindow.getAllWindows()[0] as unknown as TestWindow).exported
        )
      )
      .toEqual({ content: secondaryContent, path: join(fixture.vault, 'PRD.md') })
    await page.locator('writemd-doc-bar[secondary] [aria-label="More Options"]').click()
    await page.screenshot({ path: 'artifacts/ui-review/secondary-document-menu.png' })
    await page.keyboard.press('Escape')
    await page.locator('writemd-doc-bar[secondary] [aria-label="Close split pane"]').click()
    await expect(page.locator('writemd-doc-bar[secondary]')).toHaveCount(0)
    await expect(page.locator('writemd-doc-bar input[aria-label="Document title"]')).toHaveValue(
      'README'
    )
  })

  test('secondary Rename and Find target the pane while primary stays unchanged', async () => {
    await openSecondary()
    await secondaryAction('rename')
    const input = page.locator('writemd-doc-bar[secondary] input.title-input')
    await expect(input).toBeFocused()
    await input.fill('Renamed pane')
    await input.press('Enter')
    await expect(input).toHaveValue('Renamed pane')
    await expect(page.locator('writemd-doc-bar[secondary] .sub-header-left')).toContainText(
      'Renamed pane.md'
    )
    await secondaryAction('find')
    const find = page.locator('writemd-find-panel')
    await find.locator('.find-input').fill('pane-only-target')
    await expect(find.locator('.match-count')).toContainText('of 1')
    await page.keyboard.press('Escape')
    await expect(page.locator('writemd-doc-bar input[aria-label="Document title"]')).toHaveValue(
      'README'
    )
  })

  test('document and text menus dismiss one another, stay inside the viewport, and format the correct pane', async () => {
    await openSecondary()
    await page.locator('writemd-doc-bar:not([secondary]) [aria-label="More Options"]').click()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    await page.locator('writemd-panel[slot="auxiliary"] .body-area').evaluate(
      (el, viewport) =>
        el.dispatchEvent(
          new MouseEvent('contextmenu', {
            clientX: viewport.width - 16,
            clientY: viewport.height - 24,
            bubbles: true,
            composed: true,
            cancelable: true
          })
        ),
      viewport
    )
    await expect(page.locator('writemd-doc-bar .note-menu')).toHaveCount(0)
    const text = page.locator('writemd-text-menu')
    const menu = text.locator('.m-panel')
    await expect(menu).toBeVisible()
    await expect
      .poll(async () => {
        const bounds = await menu.boundingBox()
        return Math.abs(bounds!.x + bounds!.width - (viewport.width - 16))
      })
      .toBeLessThan(2)
    const bounds = await menu.boundingBox()
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 8)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height - 8)
    await expect(text.locator('.m-chevron svg')).toHaveCount(4)
    expect(await menu.textContent()).not.toMatch(/[ÃÂ]/)
    await expect(text.locator('.has-sub[data-id="add-link"]')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(text.locator('.has-sub[data-id="format"]')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(text.locator('.submenu [data-id="bold"]')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await text.locator('.has-sub[data-id="format"]').hover()
    const submenu = text.locator('.has-sub[data-id="format"] .submenu')
    await expect(submenu).toBeVisible()
    const subBounds = await submenu.boundingBox()
    expect(subBounds!.x).toBeGreaterThanOrEqual(8)
    expect(subBounds!.y + subBounds!.height).toBeLessThanOrEqual(viewport.height - 8)
    await page.screenshot({ path: 'artifacts/ui-review/text-menu-viewport.png' })
    await page.locator('writemd-editor').evaluate((el) => {
      const view = (el as unknown as { secondaryEditorView: EditorView }).secondaryEditorView
      const start = view.state.doc.toString().indexOf('pane-only-target')
      view.dispatch({ selection: { anchor: start, head: start + 'pane-only-target'.length } })
    })
    await submenu.locator('[data-id="bold"]').click()
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (document.querySelector('writemd-app') as unknown as Host).fileState.getState()
              .secondaryDoc?.content
        )
      )
      .toContain('**pane-only-target**')
    expect(
      await page.evaluate(
        () =>
          (document.querySelector('writemd-app') as unknown as Host).fileState.getState().content
      )
    ).not.toContain('pane-only-target')
    await page.locator('writemd-panel[slot="auxiliary"] .body-area').evaluate(
      (el, viewport) =>
        el.dispatchEvent(
          new MouseEvent('contextmenu', {
            clientX: viewport.width - 16,
            clientY: viewport.height - 24,
            bubbles: true,
            composed: true,
            cancelable: true
          })
        ),
      viewport
    )
    await expect(menu).toBeVisible()
    await page.locator('writemd-doc-bar[secondary] [aria-label="More Options"]').click()
    await expect(text).toHaveCount(0)
    await expect(page.locator('writemd-doc-bar[secondary] .note-menu')).toBeVisible()
  })

  test('pinned separator is short and thin, and disappears after unpinning', async () => {
    await page.evaluate(
      (path) => (document.querySelector('writemd-app') as unknown as Host).fileState.openFile(path),
      join(fixture.vault, 'PRD.md')
    )
    await page.evaluate(() =>
      (document.querySelector('writemd-app') as unknown as Host).fileState.pinTab(0)
    )
    const separator = page.locator('writemd-vertical-tab-bar .pinned-divider')
    await expect(separator).toBeVisible()
    const bounds = await separator.boundingBox()
    expect(bounds!.height).toBe(1)
    expect(bounds!.width).toBe(48)
    await page.screenshot({ path: 'artifacts/ui-review/pinned-tab-separator.png' })
    await page.evaluate(() =>
      (document.querySelector('writemd-app') as unknown as Host).fileState.unpinTab(0)
    )
    await expect(separator).toHaveCount(0)
  })

  test('sidebar update progresses above AI Assistant and moves back to the toolbar in horizontal mode', async () => {
    await app.evaluate(({ BrowserWindow, ipcMain }) => {
      const window = BrowserWindow.getAllWindows()[0] as unknown as TestWindow
      window.calls = { download: 0, install: 0 }
      ipcMain.removeHandler('updater:download')
      ipcMain.removeHandler('updater:install')
      ipcMain.handle('updater:download', () => {
        window.calls!.download++
        return []
      })
      ipcMain.handle('updater:install', () => {
        window.calls!.install++
      })
    })
    await update('available')
    const control = page.locator('writemd-sidebar writemd-update-button')
    const button = control.locator('.sidebar-action')
    await expect(button).toHaveText('Update available')
    await expect(page.locator('writemd-top-bar writemd-update-button')).toHaveCount(0)
    const ai = await page
      .locator('writemd-sidebar .footer button', { hasText: 'AI Assistant' })
      .boundingBox()
    const bounds = await button.boundingBox()
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(ai!.y)
    await button.click()
    await update('downloading', 46)
    await expect(button).toHaveText('Downloading 46%')
    await expect(button).toBeDisabled()
    await update('downloaded')
    await expect(button).toHaveText('Restart to update')
    await page.screenshot({ path: 'artifacts/ui-review/sidebar-update-ready.png' })
    await button.click()
    expect(
      await app.evaluate(
        ({ BrowserWindow }) => (BrowserWindow.getAllWindows()[0] as unknown as TestWindow).calls
      )
    ).toEqual({ download: 1, install: 1 })
    await page.evaluate(() =>
      (document.querySelector('writemd-app') as unknown as Host).settingsStore.set(
        'appearance.panelOrientation',
        'horizontal'
      )
    )
    await expect(page.locator('writemd-top-bar writemd-update-button .check-badge')).toBeVisible()
    await page.evaluate(() =>
      (document.querySelector('writemd-app') as unknown as Host).settingsStore.set(
        'appearance.panelOrientation',
        'vertical'
      )
    )
    await expect(button).toHaveText('Restart to update')
    await update('idle')
    await expect(button).toHaveCount(0)
  })
})
