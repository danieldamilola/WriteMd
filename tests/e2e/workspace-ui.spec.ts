import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow, openSettings } from './fixtures'
import type { FileState } from '../../src/renderer/src/state/file-state'
import type { SettingsStore } from '../../src/renderer/src/state/settings'
import type { TabDragController } from '../../src/renderer/src/controllers/tab-drag'
import type { AiMessage } from '../../src/renderer/src/components/AiPanel'

type AppHost = HTMLElement & {
  fileState: FileState
  settingsStore: SettingsStore
  tabDrag: TabDragController
}
const files = Array.from({ length: 14 }, (_, i) => `note-${String(i).padStart(2, '0')}.md`)

async function order(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (document.querySelector('writemd-app') as unknown as AppHost).fileState
      .getState()
      .tabs.map((t) => t.id!)
  )
}
async function prefs(page: Page, values: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (values) =>
      (document.querySelector('writemd-app') as unknown as AppHost).settingsStore.setMany(values),
    values
  )
}

test.describe('workspace UI', () => {
  let app: ElectronApplication, page: Page
  let fixture: ReturnType<typeof makeFixture>
  test.beforeEach(async () => {
    fixture = makeFixture('workspace-ui', files)
    writeFileSync(
      join(fixture.userData, 'config.json'),
      JSON.stringify({
        files: {
          vaultPath: fixture.vault,
          openTabs: files.map((f) => join(fixture.vault, f)),
          activeTabPath: join(fixture.vault, files[0])
        },
        appearance: {
          designVersion: 1,
          theme: 'graphite',
          panelOrientation: 'horizontal',
          motion: 'full'
        },
        editor: { autoSave: false }
      })
    )
    app = await launch(fixture)
    page = await firstWindow(app)
    await expect(page.locator('writemd-tab')).toHaveCount(files.length)
  })
  test.afterEach(async () => {
    await app?.close()
  })

  for (const orientation of ['horizontal', 'vertical']) {
    test(`closing a dirty group requires confirmation in ${orientation} tabs`, async () => {
      await prefs(page, {
        'appearance.panelOrientation': orientation,
        'appearance.motion': 'reduced'
      })
      await page.evaluate(() => {
        const state = (document.querySelector('writemd-app') as unknown as AppHost).fileState
        state.createTabGroup('Unsaved group', undefined, [0, 1])
        state.setContent('Unsaved group edits')
      })
      const before = await order(page)
      const header = page.locator(orientation === 'vertical' ? '.group-header' : '.h-group-pill')
      await header.click({ button: 'right' })
      await page.locator('.m-item', { hasText: 'Close all tabs in group' }).click()
      const confirmation = page.locator('writemd-confirm')
      await expect(confirmation.locator('p')).toContainText('unsaved changes')
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
      expect(await order(page)).toEqual(before)
      expect(
        await page.evaluate(
          () =>
            (document.querySelector('writemd-app') as unknown as AppHost).fileState.getState()
              .content
        )
      ).toBe('Unsaved group edits')

      await header.click({ button: 'right' })
      await page.locator('.m-item', { hasText: 'Close all tabs in group' }).click()
      await confirmation.getByRole('button', { name: 'OK', exact: true }).click()
      await expect.poll(() => order(page)).toEqual(before.slice(2))
    })
  }

  test('dragging reorders by identity and Escape cancels without selecting or moving a neighbor', async () => {
    const before = await order(page)
    const source = await page.locator('.h-tab-item').nth(0).boundingBox()
    const target = await page.locator('.h-tab-item').nth(2).boundingBox()
    expect(source).not.toBeNull()
    expect(target).not.toBeNull()
    await page.mouse.move(source!.x + 30, source!.y + source!.height / 2)
    await page.mouse.down()
    await page.mouse.move(target!.x + target!.width - 10, target!.y + target!.height / 2, {
      steps: 12
    })
    await expect(page.locator('.writemd-drag-preview')).toBeVisible()
    await page.screenshot({ path: 'artifacts/ui-review/fixed-drag.png' })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    expect(await order(page)).toEqual(before)
    const active = await page.locator('writemd-tab[active]').getAttribute('label')
    expect(active).toBe(files[0])
    await expect(page.locator('.writemd-drag-preview')).toHaveCount(0)
    const restoredSource = await page.locator('.h-tab-item').first().boundingBox()
    const restoredTarget = await page.locator('.h-tab-item').nth(2).boundingBox()
    await page.mouse.move(restoredSource!.x + 30, restoredSource!.y + restoredSource!.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      restoredTarget!.x + restoredTarget!.width - 10,
      restoredTarget!.y + restoredTarget!.height / 2,
      { steps: 12 }
    )
    await expect(page.locator('.writemd-drag-preview')).toBeVisible()
    await page.mouse.up()
    await expect
      .poll(() => order(page))
      .toEqual([before[1], before[2], before[0], ...before.slice(3)])
  })

  test('unpinning while dragging moves the pinned identity and keeps the active document', async () => {
    await page.evaluate(() =>
      (document.querySelector('writemd-app') as unknown as AppHost).fileState.pinTab(0)
    )
    const before = await order(page)
    const source = await page.locator('.h-tab-item[data-pinned="true"]').boundingBox()
    const target = await page.locator('.h-tab-item[data-pinned="false"]').nth(1).boundingBox()
    await page.mouse.move(source!.x + 22, source!.y + source!.height / 2)
    await page.mouse.down()
    await page.mouse.move(target!.x + 8, target!.y + target!.height / 2, { steps: 12 })
    await expect(page.locator('.writemd-drag-preview')).toBeVisible()
    await page.mouse.up()
    await expect.poll(() => order(page)).toEqual([before[1], before[0], ...before.slice(2)])
    await expect(page.locator('.h-tab-item[data-pinned="true"]')).toHaveCount(0)
    await expect(page.locator('writemd-tab[active]')).toHaveAttribute('label', files[0])
  })

  test('a stationary pointer keeps scrolling and dropping outside cancels', async () => {
    const before = await order(page)
    const source = await page.locator('.h-tab-item').first().boundingBox()
    const strip = await page.locator('.tab-strip').boundingBox()
    await page.mouse.move(source!.x + 25, source!.y + source!.height / 2)
    await page.mouse.down()
    await page.mouse.move(strip!.x + strip!.width - 3, source!.y + source!.height / 2, {
      steps: 12
    })
    await expect(page.locator('.writemd-drag-preview')).toBeVisible()
    const start = await page.locator('.tab-strip').evaluate((el) => el.scrollLeft)
    await expect
      .poll(() => page.locator('.tab-strip').evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(start + 30)
    await page.mouse.move(strip!.x + strip!.width / 2, strip!.y + strip!.height + 80, { steps: 4 })
    await page.mouse.up()
    expect(await order(page)).toEqual(before)
  })

  test('vertical dragging shares cancellation and keyboard ordering behavior', async () => {
    await prefs(page, { 'appearance.panelOrientation': 'vertical' })
    const before = await order(page)
    const source = await page.locator('.tab-row[data-tab-id]').first().boundingBox()
    const target = await page.locator('.tab-row[data-tab-id]').nth(2).boundingBox()
    await page.mouse.move(source!.x + 50, source!.y + source!.height / 2)
    await page.mouse.down()
    await page.mouse.move(target!.x + 50, target!.y + target!.height - 3, { steps: 12 })
    await expect(page.locator('.writemd-drag-preview')).toBeVisible()
    await page.evaluate(() =>
      document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }))
    )
    await page.mouse.up()
    expect(await order(page)).toEqual(before)
    await page.locator('writemd-tab[active] .tab-btn').focus()
    await page.keyboard.press('Alt+ArrowDown')
    await expect.poll(() => order(page)).toEqual([before[1], before[0], ...before.slice(2)])
  })

  test('opens an OS-backed dropped file through the typed Electron bridge', async () => {
    await page.evaluate(() => {
      const input = document.createElement('input')
      input.type = 'file'
      input.id = 'native-drop'
      input.hidden = true
      document.body.append(input)
    })
    const session = await page.context().newCDPSession(page)
    const { root } = await session.send('DOM.getDocument')
    const { nodeId } = await session.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '#native-drop'
    })
    await session.send('DOM.setFileInputFiles', { nodeId, files: [join(fixture.vault, files[8])] })
    await page.evaluate(() => {
      const file = document.querySelector<HTMLInputElement>('#native-drop')!.files![0]
      const transfer = new DataTransfer()
      transfer.items.add(file)
      window.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
      )
    })
    await expect(page.locator('writemd-tab[active]')).toHaveAttribute('label', files[8])
  })

  test('workspace divider persists preference and narrow windows switch surfaces without overflow', async () => {
    await page.locator('writemd-icon-button[title="Split view"]').click()
    const divider = page.locator('writemd-workspace wa-split-panel [role="separator"]')
    await expect(divider).toBeVisible()
    const box = await divider.boundingBox()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + 90, box!.y + box!.height / 2, { steps: 8 })
    await page.mouse.up()
    const preferred = await page.evaluate(() =>
      (document.querySelector('writemd-app') as unknown as AppHost).settingsStore.get(
        'appearance.paneWidth',
        0
      )
    )
    expect(preferred).toBeGreaterThan(600)
    await prefs(page, { 'appearance.panelOrientation': 'vertical' })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 700))
    await expect(page.locator('.compact-switch')).toBeVisible()
    const geometry = await page
      .locator('writemd-workspace')
      .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }))
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1)
    await page.locator('.compact-switch button', { hasText: 'Document' }).click()
    await expect(page.locator('.cm-content').first()).toBeVisible()
    await page.screenshot({ path: 'artifacts/ui-review/fixed-compact.png' })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 850))
    await expect(page.locator('.compact-switch')).toHaveCount(0)
    expect(
      await page.evaluate(() =>
        (document.querySelector('writemd-app') as unknown as AppHost).settingsStore.get(
          'appearance.paneWidth',
          0
        )
      )
    ).toBe(preferred)
    await divider.focus()
    await page.keyboard.press('ArrowLeft')
    await expect
      .poll(() =>
        page.evaluate(() =>
          (document.querySelector('writemd-app') as unknown as AppHost).settingsStore.get(
            'appearance.paneWidth',
            0
          )
        )
      )
      .toBeLessThan(preferred)
    await page.screenshot({ path: 'artifacts/ui-review/fixed-workspace.png' })
  })

  test('background picker copies the image locally and all effects render through the worker', async () => {
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 600
      canvas.height = 300
      const context = canvas.getContext('2d')!
      const gradient = context.createLinearGradient(0, 0, 600, 300)
      gradient.addColorStop(0, '#14223d')
      gradient.addColorStop(0.5, '#944937')
      gradient.addColorStop(1, '#244b46')
      context.fillStyle = gradient
      context.fillRect(0, 0, 600, 300)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    const imagePath = join(fixture.vault, 'background.png')
    writeFileSync(imagePath, Buffer.from(image, 'base64'))
    await app.evaluate(({ dialog }, imagePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [imagePath] })
    }, imagePath)
    await openSettings(page)
    await page.locator('writemd-settings-modal .nav-btn', { hasText: 'Appearance' }).click()
    const controls = page.locator('writemd-background-controls')
    await controls.locator('wa-button', { hasText: 'Choose image' }).click()
    await expect(controls.locator('wa-button', { hasText: 'Change' })).toBeVisible()
    const id = await page.evaluate(() =>
      (document.querySelector('writemd-app') as unknown as AppHost).settingsStore.get(
        'appearance.backgroundId',
        ''
      )
    )
    expect(id).toMatch(/^[a-f0-9-]+\.png$/)
    expect(existsSync(join(fixture.userData, 'backgrounds', id))).toBe(true)
    expect(
      await page.evaluate(() =>
        (document.querySelector('writemd-app') as unknown as AppHost).settingsStore.get(
          'appearance.surfaceOpacity',
          0
        )
      )
    ).toBe(100)
    for (const effect of ['Dither', 'ASCII', 'Halftone', 'Scanlines', 'Haze', 'None']) {
      await controls.getByRole('button', { name: effect, exact: true }).click()
      await expect(controls.locator('writemd-background img')).toBeVisible()
      await expect(controls.locator('[role="status"]')).toHaveCount(0)
      await expect(controls.locator('[role="alert"]')).toHaveCount(0)
    }
    const previewImage = controls.locator('writemd-background img')
    await expect(previewImage).toHaveCSS('opacity', '0.31')
    await controls.getByRole('button', { name: 'Preview content', exact: true }).click()
    await expect(previewImage).toHaveCSS('opacity', '0.19')
    await controls.getByRole('button', { name: 'Empty only', exact: true }).click()
    await expect(previewImage).toHaveCSS('opacity', '0')
    await controls.getByRole('button', { name: 'Preview empty view', exact: true }).click()
    await expect(previewImage).toHaveCSS('opacity', '0.31')
    await controls.getByRole('button', { name: 'Always', exact: true }).click()
    await page.screenshot({ path: 'artifacts/ui-review/fixed-background-settings.png' })
    await page.keyboard.press('Escape')
    await expect(page.locator('writemd-settings-modal')).toHaveCount(0)
    const paneImage = page.locator('writemd-panel[slot="primary"] writemd-background img')
    await expect(paneImage).toHaveCSS('opacity', '0.19')
    await prefs(page, { 'appearance.surfaceOpacity': 0 })
    await expect(paneImage).toHaveCSS('opacity', '0.19')
    await prefs(page, { 'appearance.surfaceOpacity': 100, 'appearance.backgroundShowOn': 'empty' })
    await expect(paneImage).toHaveCSS('opacity', '0')
    await prefs(page, { 'appearance.backgroundShowOn': 'all', 'appearance.backgroundTarget': 'ai' })
    await expect(paneImage).toHaveCSS('opacity', '0')
    await prefs(page, { 'appearance.backgroundTarget': 'workspace' })
    await expect(paneImage).toHaveCSS('opacity', '0.19')
    await page.screenshot({ path: 'artifacts/ui-review/fixed-background-workspace.png' })
    await prefs(page, { 'ai.provider': 'Ollama', 'appearance.backgroundShowOn': 'empty' })
    await page.evaluate(() =>
      (document.querySelector('writemd-app') as unknown as AppHost).fileState.setSplitSurface('ai')
    )
    await expect(page.locator('writemd-ai-panel')).toBeVisible()
    const auxiliaryImage = page
      .locator('writemd-panel[slot="auxiliary"]')
      .locator('writemd-background')
      .first()
      .locator('img')
    await expect(auxiliaryImage).toHaveCSS('opacity', '0.31')
    await page.locator('writemd-editor').evaluate((element) => {
      const editor = element as unknown as { aiMessages: AiMessage[] }
      editor.aiMessages = [{ role: 'user', content: 'Background scope fixture' }]
    })
    await expect(auxiliaryImage).toHaveCSS('opacity', '0')
    await prefs(page, { 'appearance.backgroundShowOn': 'all' })
    await expect(auxiliaryImage).toHaveCSS('opacity', '0.19')
    await prefs(page, { 'appearance.backgroundTarget': 'ai' })
    await expect(auxiliaryImage).toHaveCSS('opacity', '0')
    const aiImage = page.locator('writemd-ai-panel writemd-background img')
    await expect(aiImage).toBeVisible()
    await expect(aiImage).toHaveCSS('opacity', '0.19')
    await prefs(page, { 'appearance.backgroundShowOn': 'empty' })
    await expect(aiImage).toHaveCSS('opacity', '0')
    await page.locator('writemd-editor').evaluate((element) => {
      ;(element as unknown as { aiMessages: AiMessage[] }).aiMessages = []
    })
    await expect(aiImage).toHaveCSS('opacity', '0.31')
    await page.screenshot({ path: 'artifacts/ui-review/pr23-fixed-ai-background.png' })
    await prefs(page, {
      'appearance.backgroundTarget': 'workspace',
      'appearance.backgroundShowOn': 'all'
    })
    await page.evaluate(() =>
      (document.querySelector('writemd-app') as unknown as AppHost).settingsStore.whenSaved()
    )
    await app.close()
    app = await launch(fixture)
    page = await firstWindow(app)
    await expect(page.locator('writemd-background img').first()).toBeVisible()
    await openSettings(page)
    await page.locator('writemd-settings-modal .nav-btn', { hasText: 'Appearance' }).click()
    const restoredControls = page.locator('writemd-background-controls')
    const support = await page.evaluate(() => window.electronAPI!.appearance.materialSupport())
    if (support.supported) {
      const material = restoredControls.locator('wa-select[aria-label="Window material"]')
      await material.click()
      await material.locator('wa-option[value="mica"]').click()
      await expect(page.locator('html')).toHaveAttribute('data-window-material', 'mica')
      await material.click()
      await material.locator('wa-option[value="none"]').click()
    }
    await restoredControls.locator('wa-button', { hasText: 'Remove' }).click()
    await expect
      .poll(() =>
        page.evaluate(() =>
          (document.querySelector('writemd-app') as unknown as AppHost).settingsStore.get(
            'appearance.backgroundId',
            ''
          )
        )
      )
      .toBe('')
    await expect.poll(() => existsSync(join(fixture.userData, 'backgrounds', id))).toBe(false)
    expect(existsSync(imagePath)).toBe(true)
  })

  test('native dialogs keep background focus inert and context menus support the keyboard', async () => {
    await openSettings(page)
    const modal = page.locator('writemd-settings-modal')
    // Embedded shell, not a wa-dialog popup: the modal fills the window.
    await expect(modal).toBeVisible()
    const result = await page.evaluate(() => {
      const root = document.querySelector('writemd-app')!.shadowRoot!
      root
        .querySelector('writemd-editor')!
        .shadowRoot!.querySelector<HTMLElement>('.cm-content')!
        .focus()
      let active = document.activeElement
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
      return {
        isEditor: active?.classList.contains('cm-content'),
        inSettings: root.querySelector('writemd-settings-modal')?.shadowRoot?.activeElement !== null
      }
    })
    expect(result.isEditor).toBe(false)
    expect(result.inSettings).toBe(true)
    await modal.locator('.nav-btn', { hasText: 'Advanced' }).click()
    await modal.locator('button.danger-btn', { hasText: 'Reset All' }).click()
    const confirmation = page.locator('writemd-confirm wa-dialog dialog')
    await expect(confirmation).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(confirmation).toHaveCount(0)
    await expect(modal).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
    await page.locator('.h-tab-item').first().click({ button: 'right' })
    const menu = page.locator('writemd-context-menu')
    await expect(menu.locator('[role="menu"]')).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  })
})
