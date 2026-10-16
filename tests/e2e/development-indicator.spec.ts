import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { firstWindow, launch, makeFixture, openSettings, resizeWindow } from './fixtures'

test.setTimeout(90_000)

test('development builds show the title-bar badge in each layout and release builds hide it', async () => {
  const fixture = makeFixture('development-indicator')
  const configPath = join(fixture.userData, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.appearance.theme = 'graphite'
  config.appearance.motion = 'reduced'
  config.files.openTabs = config.files.recentFiles
  writeFileSync(configPath, JSON.stringify(config))
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    const bar = page.locator('writemd-top-bar')
    const badge = bar.getByText('Development', { exact: true })
    const info = await page.evaluate(() => window.electronAPI!.app.getBuildInfo())
    const expectedVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
    expect(info).toMatchObject({ development: true, version: expectedVersion })
    await expect(badge).toBeVisible()
    await expect(badge).toHaveAttribute('title', `Development build, v${info.version}`)

    for (const [orientation, theme] of [
      ['vertical', 'graphite'],
      ['horizontal', 'paper']
    ]) {
      await resizeWindow(app, orientation === 'vertical' ? 1100 : 800, 700)
      await page.evaluate(
        ({ orientation, theme }) => {
          const host = document.querySelector('writemd-app') as unknown as {
            settingsStore: { setMany(values: Record<string, string>): void }
          }
          host.settingsStore.setMany({
            'appearance.panelOrientation': orientation,
            'appearance.theme': theme
          })
        },
        { orientation, theme }
      )
      await expect(badge).toBeVisible()
      await expect(badge).toHaveCount(1)
      const bounds = await badge.boundingBox()
      const caption = await bar.locator('.window-controls').boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThan(caption!.x)
      expect(bounds!.height).toBeLessThanOrEqual(24)
      await page.screenshot({
        path: `artifacts/ui-review/development-indicator-${orientation}.png`
      })
    }
    await openSettings(page)
    await expect(badge).toBeVisible()
    await page.screenshot({ path: 'artifacts/ui-review/development-indicator-settings.png' })

    // Exercise a release response through the real preload and a fresh renderer.
    await app.evaluate(({ ipcMain, app }) => {
      ipcMain.removeHandler('app:get-build-info')
      ipcMain.handle('app:get-build-info', () => ({
        development: false,
        version: app.getVersion()
      }))
    })
    await page.reload()
    await expect(bar).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => window.electronAPI!.app.getBuildInfo()))
      .toMatchObject({ development: false })
    await expect(badge).toHaveCount(0)
  } finally {
    await app.close()
    fixture.cleanup()
  }
})
