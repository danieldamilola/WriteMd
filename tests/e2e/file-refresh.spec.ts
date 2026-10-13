import { test, expect } from '@playwright/test'
import { join } from 'path'
import { renameSync, writeFileSync } from 'fs'
import { makeFixture, launch, firstWindow } from './fixtures'

test('external atomic edits refresh primary and background split documents repeatedly', async () => {
  const fixture = makeFixture('external-refresh')
  const primary = join(fixture.userData, 'Primary.md')
  const secondary = join(fixture.userData, 'Secondary.md')
  writeFileSync(primary, 'Primary original')
  writeFileSync(secondary, 'Secondary original')
  writeFileSync(
    join(fixture.userData, 'config.json'),
    JSON.stringify({
      files: { vaultPath: fixture.vault, openTabs: [primary, secondary], activeTabPath: primary },
      appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical' },
      editor: { autoSave: false }
    })
  )
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    const editor = page.locator('writemd-editor')
    await expect(editor).toBeVisible()
    await editor.evaluate(async (element, path) => {
      const state = (
        element as unknown as {
          fileState: {
            openSecondaryFile(path: string, content: string): Promise<void>
          }
        }
      ).fileState
      await state.openSecondaryFile(path, 'Secondary original')
    }, secondary)
    await expect(editor.locator('#secondary-cm-wrapper .cm-content')).toBeVisible()
    for (const revision of ['First', 'Second', 'Third']) {
      for (const path of [primary, secondary]) {
        const temporary = `${path}.replacement`
        writeFileSync(temporary, `${revision} ${path === primary ? 'primary' : 'secondary'}`)
        renameSync(temporary, path)
      }
      await expect(editor.locator('#primary-cm-wrapper .cm-content')).toContainText(
        `${revision} primary`
      )
      await expect(editor.locator('#secondary-cm-wrapper .cm-content')).toContainText(
        `${revision} secondary`
      )
      const snapshot = await editor.evaluate((element) => {
        const state = (
          element as unknown as {
            fileState: {
              getState(): { path: string | null; tabs: { path: string | null; content: string }[] }
            }
          }
        ).fileState.getState()
        return { path: state.path, background: state.tabs[1].content }
      })
      expect(snapshot).toEqual({ path: primary, background: `${revision} secondary` })
    }
    await page.screenshot({ path: 'artifacts/ui-review/external-file-refresh.png' })
  } finally {
    await app.close()
  }
})
