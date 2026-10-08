import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'

const NOTE = 'note.md'
const BASE = 'line one\nline two\n'

/**
 * Accept/Reject in the External Changes diff must reach the file.
 *
 * Auto-save is off for these runs on purpose: with it on, a resolve looks like
 * it works even when nothing was scheduled, because the debounce writes the
 * file anyway. Only an explicit write on resolve can satisfy these assertions.
 *
 * Accept dispatches no document change at all (CodeMirror's acceptChunk only
 * updates the original-doc reference), so a docChanged-only listener never
 * fires. Reject does change the doc. Both cases are covered.
 */
test.describe('Conflict accept/reject', () => {
  let app: ElectronApplication | undefined
  let window: Page
  const fixture = makeFixture('conflict-accept')
  const notePath = join(fixture.vault, NOTE)

  const readNote = (): string => {
    try {
      return readFileSync(notePath, 'utf-8')
    } catch {
      return ''
    }
  }

  test.beforeEach(async () => {
    writeFileSync(notePath, BASE, 'utf-8')
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
          editor: { autoSave: false },
          appearance: { designVersion: 1, theme: 'dark', panelOrientation: 'horizontal' }
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

  test.afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /** Dirty the editor, then change the file behind its back. */
  async function raiseConflict(marker: string): Promise<void> {
    await window.locator('.cm-content').first().click()
    await window.keyboard.press('Control+End')
    await window.keyboard.type(` ${marker}`, { delay: 10 })
    writeFileSync(notePath, 'line one DISK\nline two\n', 'utf-8')
    await expect(window.locator('writemd-conflict-dialog')).toBeVisible({ timeout: 10000 })
  }

  async function openDiff(): Promise<void> {
    const dialog = window.locator('writemd-conflict-dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('button', { hasText: 'Review in Split View' }).click()
    await expect(window.locator('button[name="accept"]').first()).toBeVisible({ timeout: 10000 })
  }

  /** Accept every hunk so no region stays unresolved. */
  async function acceptAll(): Promise<void> {
    for (let i = 0; i < 10; i++) {
      const buttons = window.locator('button[name="accept"]')
      if ((await buttons.count()) === 0) return
      await buttons.first().click()
    }
    throw new Error('accept buttons never cleared')
  }

  /** Reject every hunk so no editor-side region survives. */
  async function rejectAll(): Promise<void> {
    for (let i = 0; i < 10; i++) {
      const buttons = window.locator('button[name="reject"]')
      if ((await buttons.count()) === 0) return
      await buttons.first().click()
    }
    throw new Error('reject buttons never cleared')
  }

  test('Accept writes the editor content to the file', async () => {
    await raiseConflict('EDITED')
    await openDiff()
    await acceptAll()
    await expect(window.locator('button[name="accept"]')).toHaveCount(0, { timeout: 10000 })
    // No autosave is running, so the file can only change because resolving
    // wrote it.
    await expect.poll(() => readNote(), { timeout: 15000 }).toContain('EDITED')
    await expect.poll(() => readNote(), { timeout: 15000 }).not.toContain('DISK')
  })

  test('Reject takes the disk content into the file', async () => {
    await raiseConflict('EDITED')
    await openDiff()
    await rejectAll()
    await expect.poll(() => readNote(), { timeout: 15000 }).toContain('DISK')
    await expect.poll(() => readNote(), { timeout: 15000 }).not.toContain('EDITED')
  })
})
