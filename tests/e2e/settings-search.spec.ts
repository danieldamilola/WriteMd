import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { makeFixture, launch, firstWindow, openSettings } from './fixtures'

const fixture = makeFixture('settings-search')

/**
 * Search has to find the setting the user named, not just the section that
 * happens to share a word with it. "auto save" used to land on Editor, where
 * nothing matched; Auto-save lives in Files & Vault.
 */
test.describe('Settings search', () => {
  let app: ElectronApplication | undefined
  let window: Page

  test.beforeAll(async () => {
    app = await launch(fixture)
    window = await firstWindow(app!)
    await openSettings(window)
    await expect(window.locator('writemd-settings-modal')).toBeVisible()
  })

  test.afterAll(async () => {
    await app?.close()
    fixture.cleanup()
  })

  test('jumps to the matching row and highlights it', async () => {
    const modal = window.locator('writemd-settings-modal')
    const search = modal.locator('.sidebar-search writemd-search-bar input')

    await search.fill('auto auto save')
    await expect.poll(() => modal.locator('.content-panel').getAttribute('data-tab')).toBe('files')

    const hit = modal.locator('.setting-row.search-hit', { hasText: 'Auto-save' })
    await expect(hit).toHaveCount(1)
    await expect(modal.locator('.setting-row.search-hit-active')).toHaveCount(1)
    await expect(modal.locator('.search-status')).toHaveText('1 matching setting')
  })

  test('finds a row by its description and steps through matches', async () => {
    const modal = window.locator('writemd-settings-modal')
    const search = modal.locator('.sidebar-search writemd-search-bar input')

    await search.fill('page size')
    await expect
      .poll(() => modal.locator('.content-panel').getAttribute('data-tab'))
      .toBe('advanced')
    await expect(
      modal.locator('.setting-row.search-hit', { hasText: 'PDF page size' })
    ).toHaveCount(1)

    // "pdf" hits three rows in Advanced; ArrowDown walks them.
    await search.fill('pdf')
    await expect(modal.locator('.setting-row.search-hit')).toHaveCount(3)
    await expect(modal.locator('.setting-row.search-hit-active')).toHaveCount(1)
    await search.press('ArrowDown')
    await expect
      .poll(() => modal.locator('.setting-row.search-hit-active').innerText())
      .toContain('PDF theme')
  })

  test('reports a miss without hiding the nav', async () => {
    const modal = window.locator('writemd-settings-modal')
    const search = modal.locator('.sidebar-search writemd-search-bar input')

    await search.fill('zzz-no-such-setting')
    await expect(modal.locator('.search-status')).toHaveText('No matches')
    await expect(modal.locator('.setting-row.search-hit')).toHaveCount(0)
    await expect(modal.locator('.nav-btn').first()).toBeVisible()
  })

  test('clearing search restores grouped navigation and renamed categories remain searchable', async () => {
    const modal = window.locator('writemd-settings-modal')
    const search = modal.locator('.sidebar-search writemd-search-bar input')
    await search.fill('keyboard shortcuts')
    await expect(modal.locator('.content-panel')).toHaveAttribute('data-tab', 'shortcuts')
    await expect(modal.locator('.nav-section:visible')).toHaveCount(1)
    await expect(modal.locator('.nav-group:visible')).toHaveText('Workspace')
    await search.fill('new notes')
    await expect(modal.locator('.content-panel')).toHaveAttribute('data-tab', 'general')
    await expect(modal.locator('.nav-btn:visible')).toHaveText('New notes')
    await expect(modal.locator('.search-status')).toHaveText('1 matching section')
    await search.fill('')
    await expect(modal.locator('.nav-section:visible')).toHaveCount(3)
    await expect(modal.locator('.nav-btn:visible')).toHaveCount(8)
    await expect(modal.locator('.search-status')).toHaveCount(0)
    await modal.locator('.nav-btn', { hasText: 'About WriteMd' }).click()
    await expect(modal.locator('.content-panel')).toHaveAttribute('data-tab', 'about')
    await expect(modal.locator('.nav-btn[aria-current="page"]')).toHaveText('About WriteMd')
  })
})
