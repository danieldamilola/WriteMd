import { test, expect, type ElectronApplication } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'
import type { SettingsStore } from '../../src/renderer/src/state/settings'

/**
 * The vertical panel is search-first now: no brand heading, no
 * Documents/Files toggle, no edge border. The search bar opens the command
 * palette, the panel icon collapses the rail, and the split gutter paints a
 * three-dot resize handle.
 */

const fixture = makeFixture('sidebar-panel')
const configPath = join(fixture.userData, 'config.json')
const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
  appearance: Record<string, unknown>
}
config.appearance = {
  designVersion: 1,
  theme: 'graphite',
  panelOrientation: 'vertical',
  motion: 'full'
}
writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')

test.describe('Sidebar panel', () => {
  let app: ElectronApplication | undefined

  test.beforeAll(async () => {
    app = await launch(fixture)
  })

  test.afterAll(async () => {
    await app?.close()
    fixture.cleanup()
  })

  test('toolbar and caption controls blend into the editor without borders', async () => {
    const window = await firstWindow(app!)
    await expect(window.locator('writemd-top-bar')).toBeVisible()
    const setAppearance = async (
      theme: string,
      orientation: string,
      opacity: number
    ): Promise<void> => {
      await window.evaluate(
        ({ theme, orientation, opacity }) => {
          const host = document.querySelector('writemd-app') as unknown as HTMLElement & {
            settingsStore: SettingsStore
          }
          host.settingsStore.setMany({
            'appearance.theme': theme,
            'appearance.panelOrientation': orientation,
            'appearance.surfaceOpacity': opacity
          })
        },
        { theme, orientation, opacity }
      )
    }
    try {
      for (const theme of ['graphite', 'light', 'paper']) {
        for (const orientation of ['vertical', 'horizontal']) {
          for (const opacity of [100, 65]) {
            await setAppearance(theme, orientation, opacity)
            await expect(window.locator('writemd-panel').first()).toBeVisible()
            const chrome = await window.evaluate(() => {
              const root = document.querySelector('writemd-app')!.shadowRoot!
              const bar = root.querySelector('writemd-top-bar')!
              const box = bar.shadowRoot!.querySelector('.window-controls')!
              const boxStyle = getComputedStyle(box)
              const editor = root.querySelector('writemd-editor')!.shadowRoot!
              const barStyle = getComputedStyle(bar)
              return {
                barBg: barStyle.backgroundColor,
                editorBg: getComputedStyle(editor.querySelector('writemd-panel')!).backgroundColor,
                barBottom: barStyle.borderBottomWidth,
                boxLeft: boxStyle.borderLeftWidth,
                boxBottom: boxStyle.borderBottomWidth,
                boxBg: boxStyle.backgroundColor,
                removedButtons: ['Menu', 'Settings', 'Toggle panel'].filter((title) =>
                  bar.shadowRoot!.querySelector(`writemd-icon-button[title="${title}"]`)
                )
              }
            })
            expect(chrome.barBg).toBe(chrome.editorBg)
            expect(chrome.barBg).not.toBe('rgba(0, 0, 0, 0)')
            expect(chrome.barBottom).toBe('0px')
            expect(chrome.boxLeft).toBe('0px')
            expect(chrome.boxBottom).toBe('0px')
            expect(chrome.boxBg).toBe('rgba(0, 0, 0, 0)')
            expect(chrome.removedButtons).toEqual([])
            if (opacity === 100 && theme !== 'paper') {
              await window.screenshot({
                path: `artifacts/ui-review/toolbar-${theme}-${orientation}.png`
              })
            }
          }
        }
      }
    } finally {
      await setAppearance('graphite', 'vertical', 100)
    }
  })

  test('pinned tabs live under Space with file icons and no count', async () => {
    const window = await firstWindow(app!)
    const rail = window.locator('writemd-vertical-tab-bar')
    await expect(rail.locator('writemd-tab')).toHaveCount(1)
    await window.evaluate(() => {
      const host = document.querySelector('writemd-app') as unknown as {
        fileState: { pinTab: (index: number) => void }
      }
      host.fileState.pinTab(0)
    })
    await expect(rail.locator('.section-label')).toHaveText('Space')
    const row = rail.locator('.pinned-section writemd-tab').first()
    await expect(row).toBeAttached()
    const glyph = await row.evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot!
      return {
        pin: root.querySelector('.pin-icon'),
        file: root.querySelector('svg[data-icon="file-text"]')
      }
    })
    expect(glyph.pin).toBeNull()
    expect(glyph.file).not.toBeNull()
  })

  test('search opens the palette, directly and through Ctrl+K', async () => {
    const window = await firstWindow(app!)
    const sidebar = window.locator('writemd-sidebar')
    await expect(sidebar).toBeVisible()
    const search = sidebar.locator('writemd-search-bar')
    await expect(search).toBeVisible()
    await expect(search.locator('kbd')).toHaveText('Ctrl+K')

    await search.click()
    const palette = window.locator('writemd-command-palette')
    await expect(palette).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)

    await window.keyboard.press('Control+K')
    await expect(window.locator('writemd-command-palette')).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(window.locator('writemd-command-palette')).toHaveCount(0)
  })

  test('panel has no brand, no view tabs, and no edge border', async () => {
    const window = await firstWindow(app!)
    const sidebar = window.locator('writemd-sidebar')
    await expect(sidebar).toBeVisible()
    // The open-documents rail is slotted light DOM, so piercing locators see
    // its tablist. Scope to the sidebar's own shadow root instead.
    const ownMarkup = await sidebar.evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot!
      return {
        tablists: root.querySelectorAll('[role="tablist"]').length,
        headings: root.querySelectorAll('.heading').length,
        text: root.textContent ?? ''
      }
    })
    expect(ownMarkup.tablists).toBe(0)
    expect(ownMarkup.headings).toBe(0)
    expect(ownMarkup.text).not.toContain('WriteMd')
    expect(ownMarkup.text).not.toContain('Documents')
    const border = await sidebar.evaluate((el) => getComputedStyle(el).borderRightWidth)
    expect(border).toBe('0px')
  })

  test('panel icon collapses the rail and the slim strip reopens it', async () => {
    const window = await firstWindow(app!)
    const rail = window.locator('writemd-rail-frame')
    await expect(rail).toBeVisible()
    await window.locator('writemd-sidebar button[title="Collapse panel"]').click()
    await expect.poll(() => rail.evaluate((el) => el.getBoundingClientRect().width)).toBe(48)
    await window.locator('writemd-sidebar button[title="Expand panel"]').click()
    await expect.poll(() => rail.evaluate((el) => el.getBoundingClientRect().width)).toBe(208)
  })

  test('split gutter shows three resize dots without a divider line', async () => {
    const window = await firstWindow(app!)
    await window.locator('writemd-icon-button[title="Split view"]').click()
    const divider = await window.evaluate(() => {
      const appRoot = document.querySelector('writemd-app')!.shadowRoot!
      const editor = appRoot.querySelector('writemd-editor')!.shadowRoot!
      const workspace = editor.querySelector('writemd-workspace')!.shadowRoot!
      const panel = workspace.querySelector('wa-split-panel') as HTMLElement & {
        shadowRoot: ShadowRoot
      }
      const line = panel.shadowRoot.querySelector('[part="divider"]') as HTMLElement
      const style = getComputedStyle(line)
      return {
        image: style.backgroundImage,
        width: line.getBoundingClientRect().width,
        dots: workspace.querySelectorAll('.resize-handle i').length,
        background: style.backgroundColor
      }
    })
    expect(divider.dots).toBe(3)
    expect(divider.width).toBeGreaterThan(0)
    expect(divider.image).toBe('none')
    expect(divider.background).not.toBe('rgba(0, 0, 0, 0)')
  })
})
