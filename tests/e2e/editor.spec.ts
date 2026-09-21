import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'

test.describe('WriteMd Editor', () => {
  let app: ElectronApplication | undefined

  test.beforeAll(async () => {
    // Launch Electron app
    app = await electron.launch({ args: ['.'] })
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('should launch and show welcome screen or editor', async () => {
    const window = await app?.firstWindow()
    if (!window) throw new Error('No app window opened')
    await expect(window.locator('writemd-top-bar')).toBeVisible()

    // Check title
    const title = await window.title()
    expect(title).toContain('WriteMd')
  })

  test('should open settings', async () => {
    const window = await app?.firstWindow()
    if (!window) throw new Error('No app window opened')

    // Click settings button in top bar
    const settingsBtn = window.locator('writemd-icon-button[title="Settings"]')
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click()

      // Wait for settings modal
      const modal = window.locator('writemd-settings')
      await expect(modal).toBeVisible()

      // Close settings
      await window.locator('body').click({ position: { x: 10, y: 10 } }) // Click outside
    }
  })
})
