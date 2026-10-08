import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { makeFixture, launch, firstWindow } from './fixtures'
import type { SettingsStore } from '../../src/renderer/src/state/settings'

const fixture = makeFixture('document-chrome')

async function appearance(page: Page, values: Record<string, unknown>): Promise<void> {
  await page.evaluate((values) => {
    const host = document.querySelector('writemd-app') as unknown as {
      settingsStore: SettingsStore
    }
    host.settingsStore.setMany(values)
  }, values)
}

test.describe('Document chrome', () => {
  let app: ElectronApplication
  let page: Page
  test.beforeAll(async () => {
    app = await launch(fixture)
    page = await firstWindow(app)
  })
  test.afterAll(async () => {
    await app?.close()
  })

  test('rendered toolbar and editor pixels match with opaque and translucent surfaces', async () => {
    for (const theme of ['graphite', 'light', 'paper']) {
      for (const orientation of ['vertical', 'horizontal']) {
        for (const opacity of [100, 65]) {
          await appearance(page, {
            'appearance.theme': theme,
            'appearance.panelOrientation': orientation,
            'appearance.surfaceOpacity': opacity,
            'appearance.motion': 'reduced'
          })
          const bar = await page.locator('writemd-top-bar').boundingBox()
          const pane = await page.locator('writemd-panel[slot="primary"]').boundingBox()
          const bitmap = (await page.screenshot({ scale: 'css' })).toString('base64')
          const pixels = await app.evaluate(
            ({ nativeImage }, { bitmap, points }) => {
              const image = nativeImage.createFromBuffer(Buffer.from(bitmap, 'base64'))
              const bytes = image.toBitmap()
              const width = image.getSize().width
              return points.map(({ x, y }) => {
                const offset = (Math.floor(y) * width + Math.floor(x)) * 4
                return Array.from(bytes.subarray(offset, offset + 4))
              })
            },
            {
              bitmap,
              points: [
                { x: bar!.x + 10, y: bar!.y + 2 },
                { x: pane!.x + 10, y: pane!.y + 160 }
              ]
            }
          )
          expect(pixels[0], `${theme}/${orientation}/${opacity}`).toEqual(pixels[1])
          if (opacity === 65 && orientation === 'vertical') {
            await page.screenshot({ path: `artifacts/ui-review/document-surface-${theme}.png` })
          }
        }
      }
    }
  })

  test('title centers on the full header in both layouts at compact and wide sizes', async () => {
    for (const width of [800, 1200]) {
      await app.evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 650),
        width
      )
      for (const orientation of ['vertical', 'horizontal']) {
        await appearance(page, {
          'appearance.panelOrientation': orientation,
          'appearance.theme': 'graphite',
          'appearance.surfaceOpacity': 100
        })
        const bar = page.locator('writemd-doc-bar').first()
        const input = bar.locator('input.title-input')
        await expect(input).toBeVisible()
        const reference = orientation === 'vertical' ? page.locator('writemd-top-bar') : bar
        const bounds = await reference.boundingBox()
        const title = await input.boundingBox()
        expect(
          Math.abs(title!.x + title!.width / 2 - (bounds!.x + bounds!.width / 2))
        ).toBeLessThan(1)
        const reading = await bar.locator('[aria-label="Toggle Reading / Live Mode"]').boundingBox()
        const more = await bar.locator('[aria-label="More Options"]').boundingBox()
        expect(title!.x + title!.width).toBeLessThanOrEqual(reading!.x)
        expect(more!.x + more!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width)
        await input.hover()
        await page.screenshot({
          path: `artifacts/ui-review/document-centered-${orientation}-${width}.png`
        })
      }
    }
  })

  test('document menu stays inside the viewport with readable labels and keyboard navigation', async () => {
    for (const orientation of ['vertical', 'horizontal']) {
      for (const height of [650, 420]) {
        await app.evaluate(({ BrowserWindow }, height) => {
          const window = BrowserWindow.getAllWindows()[0]
          window.setMinimumSize(800, 400)
          window.setSize(800, height)
        }, height)
        await appearance(page, { 'appearance.panelOrientation': orientation })
        const bar = page.locator('writemd-doc-bar').first()
        const trigger = bar.locator('[aria-label="More Options"]')
        await trigger.click()
        const menu = bar.locator('.note-menu')
        await expect(menu).toBeVisible()
        const bounds = await menu.boundingBox()
        const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
        expect(bounds!.x).toBeGreaterThanOrEqual(8)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 8)
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height - 8)
        const clipped = await menu
          .locator('.m-item')
          .evaluateAll((items) =>
            items
              .filter((item) => item.scrollWidth > item.clientWidth + 1)
              .map((item) => item.textContent)
          )
        expect(clipped).toEqual([])
        await page.keyboard.press('End')
        await expect(menu.locator('[data-id="delete"]')).toBeFocused()
        await page.keyboard.press('Home')
        await expect(menu.locator('[data-id="backlinks"]')).toBeFocused()
        await page.screenshot({
          path: `artifacts/ui-review/document-menu-${orientation}-${height}.png`
        })
        await page.keyboard.press('Escape')
        await expect(menu).toHaveCount(0)
        await expect(trigger).toBeFocused()
      }
    }
    await page.locator('writemd-doc-bar [aria-label="More Options"]').first().click()
    await page.locator('writemd-doc-bar [data-id="source"]').first().click()
    await expect(page.locator('writemd-info-pill').first()).toHaveJSProperty('mode', 'source')
  })
})
