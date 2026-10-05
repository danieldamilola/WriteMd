import { test, expect, type ElectronApplication } from '@playwright/test'
import { makeFixture, launch, firstWindow } from './fixtures'

const fixture = makeFixture('settings-design')

test.describe('Settings window design toggle', () => {
  let app: ElectronApplication | undefined

  test.beforeAll(async () => {
    app = await launch(fixture)
  })

  test.afterAll(async () => {
    await app?.close()
    fixture.cleanup()
  })

  test('classic mode renders a centered popup instead of the full screen', async () => {
    const window = await firstWindow(app!)
    await window.locator('writemd-icon-button[title="Settings"]').click()
    const modal = window.locator('writemd-settings-modal')
    await expect(modal).toBeVisible()

    const dialogBox = await modal.evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot
      const dialog = root?.querySelector('.modal-dialog') as HTMLElement
      const r = dialog.getBoundingClientRect()
      return { width: r.width, height: r.height, x: r.x }
    })
    // New design fills the viewport.
    expect(dialogBox.x).toBeLessThan(2)
    expect(dialogBox.width).toBeGreaterThan(1000)

    // Appearance tab holds the toggle; label carries a Beta badge.
    await modal.locator('.nav-btn', { hasText: 'Appearance' }).click()
    const toggle = modal.locator('button[aria-label="New settings design"]')
    await expect(toggle).toBeVisible()
    await expect(modal.locator('.beta-badge', { hasText: 'Beta' })).toBeVisible()
    await toggle.click()

    // Classic: host gains the class, dialog centers at popup size.
    await expect
      .poll(() => modal.evaluate((el) => (el as HTMLElement).classList.contains('classic')))
      .toBe(true)
    const classicBox = await modal.evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot
      const dialog = root?.querySelector('.modal-dialog') as HTMLElement
      const r = dialog.getBoundingClientRect()
      return { width: r.width, height: r.height, x: r.x }
    })
    expect(classicBox.width).toBeLessThanOrEqual(904) // 900 + 1px border each side
    expect(classicBox.x).toBeGreaterThan(2)

    // The popup X closes; the Back footer is a new-shell control.
    await modal.locator('.close-btn').click()
    await expect(modal).toHaveCount(0)
  })
})
