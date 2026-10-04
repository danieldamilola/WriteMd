import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'

const fixture = makeFixture('scrollbars', ['long.md'])
const notePath = join(fixture.vault, 'long.md')

/**
 * Scrollbars stay invisible until a pane scrolls, then fade back out.
 * Asserts the mechanism (the `.is-scrolling` marker), not pixel colors.
 */
test.describe('Auto-hide scrollbars', () => {
  let app: ElectronApplication | undefined
  let window: Page

  test.beforeAll(async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i} with enough words to wrap around`)
    writeFileSync(notePath, `${lines.join('\n')}\n`, 'utf-8')
    writeFileSync(
      join(fixture.userData, 'config.json'),
      JSON.stringify(
        {
          files: {
            vaultPath: fixture.vault,
            recentFiles: [notePath],
            openTabs: [notePath],
            activeTabPath: notePath
          },
          appearance: { theme: 'dark', panelOrientation: 'horizontal' }
        },
        null,
        2
      ),
      'utf-8'
    )
    app = await launch(fixture)
    window = await firstWindow(app!)
    await expect(window.locator('writemd-top-bar')).toBeVisible()
    await expect(window.locator('writemd-editor')).toBeVisible()
  })

  test.afterAll(async () => {
    await app?.close()
    fixture.cleanup()
  })

  test('scrolling the editor marks the scroller, idling unmarks it', async () => {
    await window.locator('.cm-content').first().hover()
    await window.mouse.wheel(0, 600)
    await expect
      .poll(async () => window.locator('.is-scrolling').count(), { timeout: 5000 })
      .toBeGreaterThan(0)
    await expect
      .poll(async () => window.locator('.is-scrolling').count(), { timeout: 5000 })
      .toBe(0)
  })
})
