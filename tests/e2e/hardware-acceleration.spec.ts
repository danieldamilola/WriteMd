import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { firstWindow, launch, makeFixture, openSettings, resizeWindow } from './fixtures'

test('GPU preference is searchable, persists, and disables acceleration on the next launch', async () => {
  test.setTimeout(90000)
  const fixture = makeFixture('hardware-acceleration')
  const configPath = join(fixture.userData, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.updates = { autoCheckForUpdates: false }
  config.appearance.theme = 'graphite'
  writeFileSync(configPath, JSON.stringify(config))
  let app: ElectronApplication | undefined
  try {
    app = await launch(fixture)
    let page = await firstWindow(app)
    await openSettings(page)
    let modal = page.locator('writemd-settings-modal')
    const search = modal.locator('.sidebar-search writemd-search-bar input')
    await search.fill('gpu')
    await expect(modal.locator('.content-panel')).toHaveAttribute('data-tab', 'system')
    await expect(modal.locator('.setting-row.search-hit')).toContainText('Hardware acceleration')
    await search.fill('')
    await modal.locator('.nav-btn', { hasText: 'System' }).click()
    const toggle = modal.getByRole('switch', { name: 'Hardware acceleration', exact: true })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    await expect(modal.getByRole('button', { name: 'Restart WriteMd', exact: true })).toBeVisible()
    await expect
      .poll(() => JSON.parse(readFileSync(configPath, 'utf8')).advanced.hardwareAcceleration)
      .toBe(false)
    await page.screenshot({
      path: 'artifacts/ui-review/hardware-acceleration-graphite.png',
      animations: 'disabled'
    })
    await app.close()

    app = await launch(fixture)
    page = await firstWindow(app)
    await expect
      .poll(() => app!.evaluate(({ app }) => app.isHardwareAccelerationEnabled()))
      .toBe(false)
    expect(
      await page.evaluate(() => window.electronAPI!.app.getHardwareAccelerationSetting())
    ).toBe(false)
    await openSettings(page)
    modal = page.locator('writemd-settings-modal')
    await modal.locator('.nav-btn', { hasText: 'System' }).click()
    await expect(
      modal.getByRole('switch', { name: 'Hardware acceleration', exact: true })
    ).toHaveAttribute('aria-checked', 'false')
    await expect(modal.getByRole('button', { name: 'Restart WriteMd', exact: true })).toHaveCount(0)
    await modal.getByRole('switch', { name: 'Hardware acceleration', exact: true }).click()
    await expect(modal.getByRole('button', { name: 'Restart WriteMd', exact: true })).toBeVisible()
    await page.evaluate(() => window.electronAPI!.settings.set({ appearance: { theme: 'paper' } }))
    await page.reload()
    await resizeWindow(app, 800, 720)
    await openSettings(page)
    modal = page.locator('writemd-settings-modal')
    await modal.locator('.nav-btn', { hasText: 'System' }).click()
    await expect(modal.getByRole('button', { name: 'Restart WriteMd', exact: true })).toBeVisible()
    await page.screenshot({
      path: 'artifacts/ui-review/hardware-acceleration-paper.png',
      animations: 'disabled'
    })
    // Exercise the real preload/IPC route without spawning an untracked process.
    await app.evaluate(({ app }) => {
      const originalQuit = app.quit
      const originalRelaunch = app.relaunch
      app.relaunch = () => {
        process.env.WRITEMD_TEST_RELAUNCH = 'called'
      }
      app.quit = () => {
        process.env.WRITEMD_TEST_QUIT = 'called'
        app.quit = originalQuit
        app.relaunch = originalRelaunch
      }
    })
    await modal.getByRole('button', { name: 'Restart WriteMd', exact: true }).click()
    await expect.poll(() => app!.evaluate(() => process.env.WRITEMD_TEST_RELAUNCH)).toBe('called')
    await expect.poll(() => app!.evaluate(() => process.env.WRITEMD_TEST_QUIT)).toBe('called')
    await app.close()

    app = await launch(fixture)
    page = await firstWindow(app)
    expect(
      await page.evaluate(() => window.electronAPI!.app.getHardwareAccelerationSetting())
    ).toBe(true)
    await openSettings(page)
    modal = page.locator('writemd-settings-modal')
    await modal.locator('.nav-btn', { hasText: 'System' }).click()
    await expect(
      modal.getByRole('switch', { name: 'Hardware acceleration', exact: true })
    ).toHaveAttribute('aria-checked', 'true')
    await expect(modal.getByRole('button', { name: 'Restart WriteMd', exact: true })).toHaveCount(0)
  } finally {
    await app?.close()
    fixture.cleanup()
  }
})
