import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'

/**
 * The secondary split pane used to swallow edits: its content reached
 * neither the primary tab nor the disk (autosave and save are tab-scoped).
 * Same-file edits now mirror into the tab; other files get their own
 * autosave and are flushed by manual save.
 */
test.describe('Split pane sync', () => {
  let app: ElectronApplication | undefined
  let window: Page
  const fixture = makeFixture('split-sync', ['note.md', 'other.md'])
  const notePath = join(fixture.vault, 'note.md')
  const otherPath = join(fixture.vault, 'other.md')

  const readNote = (): string => {
    try {
      return readFileSync(notePath, 'utf-8')
    } catch {
      return ''
    }
  }

  const readOther = (): string => {
    try {
      return readFileSync(otherPath, 'utf-8')
    } catch {
      return ''
    }
  }

  const LINES = 'line one\nline two\nline three\n'

  test.beforeEach(async () => {
    writeFileSync(notePath, 'hello split\n', 'utf-8')
    writeFileSync(otherPath, LINES, 'utf-8')
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
  })

  test.afterEach(async () => {
    await app?.close()
    app = undefined
  })

  async function openInSecondary(name: string): Promise<void> {
    await window.locator('writemd-icon-button[title="Split view"]').click()
    await window.locator('writemd-surface-launcher .row', { hasText: 'Files' }).click()
    const explorer = window.locator('writemd-vault-explorer')
    await expect(explorer).toBeVisible()
    await explorer.locator('.node-row', { hasText: name }).click()
    await expect(window.locator('.cm-content')).toHaveCount(2)
  }

  /** Flip auto-save through the UI so the write has to be explicit. */
  async function setAutoSave(on: boolean): Promise<void> {
    await window.locator('writemd-icon-button[title="Settings"]').click()
    const modal = window.locator('writemd-settings-modal')
    await expect(modal).toBeVisible()
    await modal.locator('.nav-btn', { hasText: 'Files' }).click()
    const toggle = modal.locator('.setting-row', { hasText: 'Auto-save' }).locator('button')
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', String(on))
    // The new shell closes from the sidebar footer, not the classic X.
    await modal.locator('.back-btn').click()
    await expect(modal).toHaveCount(0)
  }

  test('same file in both panes stays in sync with the disk', async () => {
    await openInSecondary('note.md')
    const contents = window.locator('.cm-content')
    await contents.nth(1).click()
    await window.keyboard.type('SECONDARY', { delay: 20 })
    // Primary pane mirrors the edit...
    await expect
      .poll(() => contents.nth(0).evaluate((el) => (el.textContent ?? '').slice(0, 60)))
      .toContain('SECONDARY')
    // ...and it reaches the file through autosave.
    await expect.poll(() => readNote(), { timeout: 15000 }).toContain('SECONDARY')
  })

  test('a different file in the secondary pane saves to disk', async () => {
    await openInSecondary('other.md')
    const contents = window.locator('.cm-content')
    await contents.nth(1).click()
    await window.keyboard.type('SECONDARY', { delay: 20 })
    await expect.poll(() => readOther(), { timeout: 15000 }).toContain('SECONDARY')
  })

  test('a click in the secondary pane puts Enter and the next word where the caret is', async () => {
    await openInSecondary('other.md')
    const secondary = window.locator('.cm-content').nth(1)
    // End of the last line. The split pane used to insert the newline at the
    // top of the document and then type the next characters one position back,
    // because the view never wrote the caret into the DOM after the click.
    const line = secondary.locator('.cm-line', { hasText: 'line three' })
    const box = await line.boundingBox()
    await window.mouse.click(box!.x + box!.width - 3, box!.y + box!.height / 2)
    await window.keyboard.press('Enter')
    await window.keyboard.type('ENDMARK', { delay: 30 })
    await expect.poll(() => readOther(), { timeout: 15000 }).toBe(LINES + 'ENDMARK\n')
  })

  test('closing a dirty secondary pane writes it with auto-save off', async () => {
    await setAutoSave(false)
    await openInSecondary('other.md')
    const contents = window.locator('.cm-content')
    await contents.nth(1).click()
    await window.keyboard.type('PENDING', { delay: 20 })
    // Auto-save is off, so the edit must not reach the file by itself even
    // after the debounce would have fired.
    await window.waitForTimeout(1200)
    expect(readOther()).not.toContain('PENDING')

    await window.locator('writemd-icon-button[title="Split view"]').click()
    await expect(window.locator('.cm-content')).toHaveCount(1)
    await expect.poll(() => readOther(), { timeout: 15000 }).toContain('PENDING')
  })
})
