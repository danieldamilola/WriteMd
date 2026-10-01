import { test, expect, type ElectronApplication } from '@playwright/test'
import { makeFixture, launch, firstWindow } from './fixtures'

const fixture = makeFixture('editor')

test.describe('WriteMd Editor', () => {
  let app: ElectronApplication | undefined

  test.beforeAll(async () => {
    app = await launch(fixture)
  })

  test.afterAll(async () => {
    await app?.close()
    fixture.cleanup()
  })

  test('should launch and show the welcome screen or editor', async () => {
    const window = await firstWindow(app!)
    await expect(window.locator('writemd-top-bar')).toBeVisible()

    // Check title
    const title = await window.title()
    expect(title).toContain('WriteMd')
  })

  test('should open and close settings', async () => {
    const window = await firstWindow(app!)

    const settingsBtn = window.locator('writemd-icon-button[title="Settings"]')
    // No `if (await isVisible())` wrapper. The old version skipped its whole
    // body when the button was missing, so the test passed without asserting
    // anything at all.
    await expect(settingsBtn).toBeVisible()
    await settingsBtn.click()

    const modal = window.locator('writemd-settings-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('[role="dialog"]')).toBeVisible()

    // The search field is wired to the nav now, not a decorative input.
    const search = modal.locator('input[aria-label="Search settings"]')
    await expect(search).toBeVisible()
    await search.fill('shortcut')
    await expect(modal.locator('[data-tab="shortcuts"]')).toBeVisible()

    await modal.locator('button[aria-label="Close settings"]').click()
    await expect(modal).toHaveCount(0)
  })

  test('the settings modal lays out as a sidebar beside its content', async () => {
    const window = await firstWindow(app!)
    await window.locator('writemd-icon-button[title="Settings"]').click()
    const modal = window.locator('writemd-settings-modal')
    await expect(modal).toBeVisible()

    const box = await modal.evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot
      const dialog = root?.querySelector('.modal-dialog') as HTMLElement
      const sidebar = root?.querySelector('.sidebar') as HTMLElement
      const main = root?.querySelector('.main-area') as HTMLElement
      const d = dialog.getBoundingClientRect()
      const s = sidebar.getBoundingClientRect()
      const m = main.getBoundingClientRect()
      return {
        dialogWidth: d.width,
        sidebarWidth: s.width,
        mainWidth: m.width,
        // Side by side means the main area starts to the right of the sidebar
        // and at the same vertical offset. When the sidebar ends up containing
        // main (an unclosed div), these go false and the panel stacks.
        sideBySide: m.left >= s.right - 1 && Math.abs(m.top - s.top) < 2
      }
    })

    expect(box.dialogWidth).toBeGreaterThan(600)
    expect(box.sidebarWidth).toBe(230)
    expect(box.mainWidth).toBeGreaterThan(400)
    expect(box.sideBySide).toBe(true)

    await window.locator('button[aria-label="Close settings"]').click()
  })

  test('the settings modal returns focus to whatever opened it', async () => {
    const window = await firstWindow(app!)
    const settingsBtn = window.locator('writemd-icon-button[title="Settings"]')
    await settingsBtn.click()
    await expect(window.locator('writemd-settings-modal')).toBeVisible()
    await window.locator('button[aria-label="Close settings"]').click()
    await expect(window.locator('writemd-settings-modal')).toHaveCount(0)
    // Focus previously landed on document.body, stranding a keyboard user at
    // the top of the document.
    await expect
      .poll(async () => window.evaluate(() => document.activeElement?.tagName ?? ''))
      .not.toBe('BODY')
  })
})
