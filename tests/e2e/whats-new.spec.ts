import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow, openSettings } from './fixtures'

test('whats new reads the changelog', async () => {
  const fixture = makeFixture('whats-new-check', ['note-00.md'])
  writeFileSync(
    join(fixture.userData, 'config.json'),
    JSON.stringify({
      files: {
        vaultPath: fixture.vault,
        openTabs: [join(fixture.vault, 'note-00.md')],
        activeTabPath: join(fixture.vault, 'note-00.md')
      },
      appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical' }
    })
  )
  const app: ElectronApplication = await launch(fixture)
  const page: Page = await firstWindow(app)
  await openSettings(page)
  await page.locator('writemd-settings-modal .nav-btn', { hasText: 'About' }).click()
  await page.locator('writemd-settings-modal button', { hasText: "What's new" }).click()

  // The host has no box of its own, so the dialog is asserted from inside it.
  const dialog = page.locator('writemd-whats-new .dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('h2')).toContainText('v0.2.0')
  const notes = dialog.locator('.notes')
  await expect(notes.locator('h3').first()).toHaveText('Added')
  await expect(notes).toContainText('OpenCode browser sign-in')
  await expect(notes).toContainText('Slash suggestions show only installed personal skills')
  // The heading is stripped, and no other version leaks in.
  await expect(notes).not.toContainText('1.3.0')
  await expect(notes.locator('h2')).toHaveCount(0)
  await expect(notes.locator('h3')).toHaveCount(3)
  await page.screenshot({ path: 'artifacts/ui-review/whats-new-changelog.png' })
  await app.close()
})
