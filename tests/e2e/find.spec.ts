import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'

test.describe('Find/Replace panel', () => {
  let app: ElectronApplication | undefined

  test.beforeAll(async () => {
    app = await electron.launch({ args: ['.'] })
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('custom panel opens, default CM panel never appears', async () => {
    const window = await app?.firstWindow()
    if (!window) throw new Error('No app window opened')
    await expect(window.locator('writemd-top-bar')).toBeVisible()

    // New file from welcome screen if present
    const welcome = window.locator('writemd-welcome-screen')
    if (await welcome.isVisible()) {
      await window.keyboard.press('Control+n')
    }
    const editor = window.locator('writemd-editor')
    await expect(editor).toBeVisible()

    // Type content into CodeMirror
    await window.locator('.cm-content').first().click()
    await window.keyboard.type('hello world hello', { delay: 10 })

    // Open find
    await window.keyboard.press('Control+f')
    const panel = window.locator('writemd-find-panel')
    await expect(panel).toBeVisible()

    // Type a query
    await panel.locator('.find-input').fill('hello')
    await expect(panel.locator('.match-count')).toContainText('of 2')

    // Built-in CodeMirror search panel must not exist
    await expect(window.locator('.cm-panel.cm-search')).toHaveCount(0)

    await panel.screenshot({ path: 'test-results/find-panel.png' })

    // Replace mode
    await window.keyboard.press('Control+h')
    await expect(panel.locator('.replace-input')).toBeVisible()
    await panel.screenshot({ path: 'test-results/replace-panel.png' })

    // Escape closes
    await window.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
  })
})
