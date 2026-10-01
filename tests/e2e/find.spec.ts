import { test, expect, type ElectronApplication } from '@playwright/test'
import { makeFixture, launch, firstWindow } from './fixtures'

const fixture = makeFixture('find')

test.describe('Find/Replace panel', () => {
  let app: ElectronApplication | undefined

  test.beforeAll(async () => {
    app = await launch(fixture)
  })

  test.afterAll(async () => {
    await app?.close()
    fixture.cleanup()
  })

  test('custom panel opens, default CM panel never appears', async () => {
    const window = await firstWindow(app!)
    await expect(window.locator('writemd-top-bar')).toBeVisible()

    // Unconditional now. The old version only pressed Ctrl+N when the welcome
    // screen happened to be up, which depended on whatever tabs the previous
    // run had left persisted in the real profile.
    await window.keyboard.press('Control+n')
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

  test('the new file never lands in the real vault', async () => {
    // Regression guard for the isolation itself. autoSave defaults on at 500ms,
    // so this spec used to write Untitled.md into ~/Documents/WriteMd Vault on
    // every green run.
    const window = await firstWindow(app!)
    const vaultPath = await window.evaluate(async () => {
      const api = (
        window as unknown as { electronAPI?: { vault?: { getPath?: () => Promise<string> } } }
      ).electronAPI
      return api?.vault?.getPath?.() ?? ''
    })
    expect(vaultPath).not.toBe('')
    expect(vaultPath).toContain('writemd-e2e-find-')
  })
})
