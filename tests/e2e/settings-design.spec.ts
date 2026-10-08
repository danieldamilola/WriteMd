import { test, expect, type ElectronApplication } from '@playwright/test'
import { makeFixture, launch, firstWindow, openSettings } from './fixtures'
import type { SettingsStore } from '../../src/renderer/src/state/settings'

const fixture = makeFixture('settings-design')

/**
 * Settings open as an embedded fullscreen shell, not a centered popup: the
 * dialog fills the window, carries the theme/accent pickers on its appearance
 * tab, and closes through Escape or the sidebar Back button.
 */
test.describe('Settings and flat workspace layout', () => {
  let app: ElectronApplication | undefined

  test.beforeAll(async () => {
    app = await launch(fixture)
  })

  test.afterAll(async () => {
    await app?.close()
    fixture.cleanup()
  })

  async function setOrientation(
    window: Parameters<typeof openSettings>[0],
    value: string
  ): Promise<void> {
    await window.evaluate((orientation) => {
      const host = document.querySelector('writemd-app') as unknown as {
        settingsStore: SettingsStore
      }
      host.settingsStore.set('appearance.panelOrientation', orientation)
    }, value)
  }

  test('settings fill the window and the appearance tab holds the theme controls', async () => {
    const window = await firstWindow(app!)
    await openSettings(window)
    const modal = window.locator('writemd-settings-modal')
    await expect(modal).toBeVisible()

    const dialogBox = await modal.evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot
      const dialog = root?.querySelector('.modal-dialog') as HTMLElement
      const r = dialog.getBoundingClientRect()
      return {
        width: r.width,
        height: r.height,
        x: r.x,
        y: r.y,
        radius: getComputedStyle(dialog).borderRadius
      }
    })
    const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(dialogBox.x).toBe(0)
    expect(dialogBox.y).toBe(0)
    expect(dialogBox.width).toBe(viewport.width)
    expect(dialogBox.height).toBe(viewport.height)
    expect(dialogBox.radius).toBe('0px')

    await modal.locator('.nav-btn', { hasText: 'Appearance' }).click()
    await expect(modal.locator('.theme-card')).toHaveCount(7)
    await expect(modal.locator('.color-circle-wrapper')).toHaveCount(8)
    await expect(modal.locator('button[aria-label="New settings design"]')).toHaveCount(0)
    await window.screenshot({ path: 'artifacts/ui-review/flat-settings-general.png' })

    await window.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
  })

  test('settings content scrolls independently with vertical tabs', async () => {
    const window = await firstWindow(app!)
    await setOrientation(window, 'vertical')
    await expect(window.locator('writemd-vertical-tab-bar')).toBeVisible()
    await openSettings(window)
    const modal = window.locator('writemd-settings-modal')
    await modal.locator('.nav-btn', { hasText: 'Appearance' }).click()
    const geometry = await modal.evaluate((element) => {
      const root = element.shadowRoot!
      const content = root.querySelector<HTMLElement>('.content-panel')!
      content.scrollTop = 100
      return {
        scroll: content.scrollTop,
        overflow: content.scrollHeight > content.clientHeight
      }
    })
    expect(geometry.overflow).toBe(true)
    expect(geometry.scroll).toBe(100)
    await window.screenshot({ path: 'artifacts/ui-review/flat-settings-vertical.png' })
    await window.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
  })

  test('settings search stays in the spaced sidebar in both layouts and themes', async () => {
    const window = await firstWindow(app!)
    await openSettings(window)
    const modal = window.locator('writemd-settings-modal')
    const search = modal.locator('.sidebar-search writemd-search-bar input')
    await expect(search).toBeFocused()
    await expect(window.locator('writemd-top-bar writemd-search-bar')).toHaveCount(0)
    await expect(modal.locator('.nav-group')).toHaveText(['Writing', 'Workspace', 'Application'])
    await expect(modal.locator('.nav-btn')).toHaveText([
      'New notes',
      'Editor',
      'Files & vault',
      'Appearance',
      'Keyboard shortcuts',
      'AI Assistant',
      'Advanced',
      'About WriteMd'
    ])
    try {
      for (const theme of ['graphite', 'light']) {
        for (const orientation of ['vertical', 'horizontal']) {
          await window.evaluate(
            ({ theme, orientation }) => {
              const host = document.querySelector('writemd-app') as unknown as {
                settingsStore: SettingsStore
              }
              host.settingsStore.setMany({
                'appearance.theme': theme,
                'appearance.panelOrientation': orientation
              })
            },
            { theme, orientation }
          )
          const geometry = await modal.evaluate((element) => {
            const root = element.shadowRoot!
            const sidebar = root.querySelector<HTMLElement>('.sidebar')!
            const search = root.querySelector('writemd-search-bar')!.getBoundingClientRect()
            const bounds = sidebar.getBoundingClientRect()
            const groups = Array.from(root.querySelectorAll('.nav-section')).map((group) =>
              group.getBoundingClientRect()
            )
            return {
              searchInset: search.x - bounds.x,
              searchTop: search.y - bounds.y,
              searchRight: bounds.right - search.right,
              groupGaps: groups.slice(1).map((group, i) => group.top - groups[i].bottom),
              rowHeights: Array.from(root.querySelectorAll('.nav-btn')).map(
                (button) => button.getBoundingClientRect().height
              ),
              navFits: Array.from(root.querySelectorAll<HTMLElement>('.nav-btn')).every(
                (button) => button.scrollWidth === button.clientWidth
              )
            }
          })
          expect(geometry.searchInset).toBe(8)
          expect(geometry.searchRight).toBe(8)
          expect(geometry.searchTop).toBe(12)
          expect(geometry.groupGaps.every((gap) => gap >= 24)).toBe(true)
          expect(geometry.rowHeights.every((height) => height >= 34)).toBe(true)
          expect(geometry.navFits).toBe(true)
          await search.click()
          await expect(search).toBeFocused()
          await search.fill('word wrap')
          await expect(modal.locator('.content-panel')).toHaveAttribute('data-tab', 'editor')
          await search.fill('')
          await modal.locator('.nav-btn', { hasText: 'New notes' }).click()
          await window.screenshot({
            path: `artifacts/ui-review/settings-sidebar-${theme}-${orientation}.png`
          })
        }
      }
      await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 650))
      await expect(modal.locator('.nav-btn', { hasText: 'About WriteMd' })).toBeInViewport()
      await expect(modal.locator('.back-btn')).toBeInViewport()
      await window.screenshot({ path: 'artifacts/ui-review/settings-sidebar-compact.png' })
      await modal.locator('.back-btn').click()
      await expect(modal).toHaveCount(0)
      await openSettings(window)
      await expect(search).toBeFocused()
    } finally {
      await app!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1200, 800)
      )
      await window.keyboard.press('Escape')
    }
  })

  test('document panes meet the window edges without a rounded inset frame', async () => {
    const window = await firstWindow(app!)
    await setOrientation(window, 'vertical')
    const editor = window.locator('writemd-editor')
    const primary = editor.locator('writemd-panel[slot="primary"]')
    const bounds = await primary.evaluate((element) => {
      const panel = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        x: panel.x,
        right: panel.right,
        bottom: panel.bottom,
        radius: style.borderRadius,
        width: innerWidth,
        height: innerHeight
      }
    })
    expect(bounds.radius).toBe('0px')
    expect(bounds.x).toBe(208)
    expect(bounds.right).toBe(bounds.width)
    expect(bounds.bottom).toBe(bounds.height)
    await window.screenshot({ path: 'artifacts/ui-review/flat-workspace-vertical.png' })
    await setOrientation(window, 'horizontal')
    await expect(window.locator('writemd-vertical-tab-bar')).toHaveCount(0)
    await expect.poll(async () => (await primary.boundingBox())?.x).toBe(0)
    await window.screenshot({ path: 'artifacts/ui-review/flat-workspace-horizontal.png' })
  })
})
