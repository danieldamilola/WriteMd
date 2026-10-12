import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'

test.setTimeout(120000)

async function open(name: string): Promise<{ app: ElectronApplication; page: Page }> {
  const fixture = makeFixture(`tabs-${name}`)
  writeFileSync(
    join(fixture.userData, 'config.json'),
    JSON.stringify(
      {
        files: {
          vaultPath: fixture.vault,
          recentFiles: [],
          openTabs: [join(fixture.vault, 'README.md')],
          activeTabPath: join(fixture.vault, 'README.md')
        },
        appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical' }
      },
      null,
      2
    ),
    'utf-8'
  )
  const app = await launch(fixture)
  const page = await firstWindow(app)
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.waitForTimeout(1400)
  return { app, page }
}

test('the pane has tabs and switches without a round trip', async () => {
  const { app, page } = await open('tabs')
  await page.locator('writemd-icon-button[title="Split view"]').click()
  await page.waitForTimeout(1200)

  const tabs = page.locator('.surface-tabs .surface-tab')
  await expect(tabs).toHaveCount(4)
  await expect(tabs.nth(0)).toHaveText('Files')
  await expect(tabs.nth(1)).toHaveText('Backlinks')
  await expect(tabs.nth(2)).toHaveText('Document')
  await expect(tabs.nth(3)).toHaveText('Preview')
  // Opens on Files, not on a picker.
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('writemd-vault-explorer')).toBeVisible()
  await page.screenshot({ path: 'artifacts/ui-review/surface-tabs-files.png' })

  // Straight to Backlinks, no back button in between.
  await tabs.nth(1).click()
  await page.waitForTimeout(800)
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('writemd-backlinks-panel')).toBeVisible()
  await page.screenshot({ path: 'artifacts/ui-review/surface-tabs-backlinks.png' })

  // And back again.
  await tabs.nth(0).click()
  await page.waitForTimeout(800)
  await expect(page.locator('writemd-vault-explorer')).toBeVisible()
  console.log('SWITCH-OK')
  await app.close()
})

test('no launcher and no back-to-surfaces control remains', async () => {
  const { app, page } = await open('no-launcher')
  await page.locator('writemd-icon-button[title="Split view"]').click()
  await page.waitForTimeout(1000)
  await expect(page.locator('writemd-surface-launcher')).toHaveCount(0)
  await expect(page.locator('[title="Back to surfaces"]')).toHaveCount(0)
  await app.close()
})

test('every surface is reachable by keyboard', async () => {
  const { app, page } = await open('shortcuts')
  await page.locator('writemd-icon-button[title="Split view"]').click()
  await page.waitForTimeout(1000)

  const selected = async (): Promise<string> =>
    (
      await page.locator('.surface-tabs .surface-tab[aria-selected="true"]').textContent()
    )?.trim() ?? ''

  await page.locator('.surface-tabs .surface-tab', { hasText: 'Backlinks' }).click()
  await page.waitForTimeout(700)
  expect(await selected()).toBe('Backlinks')

  await page.keyboard.press('Control+Shift+P')
  await page.waitForTimeout(700)
  expect(await selected()).toBe('Preview')

  await page.keyboard.press('Control+Shift+B')
  await page.waitForTimeout(700)
  expect(await selected()).toBe('Backlinks')

  await page.keyboard.press('Control+Shift+E')
  await page.waitForTimeout(700)
  expect(await selected()).toBe('Files')
  await app.close()
})

test('the document surface is one header row with one close button', async () => {
  const { app, page } = await open('one-header')
  await page.locator('writemd-icon-button[title="Split view"]').click()
  await page.waitForTimeout(900)
  await page.locator('writemd-vault-explorer .node-row', { hasText: 'PRD.md' }).click()
  await page.waitForTimeout(1200)

  // Reading toggle and document menu ride in the tab strip row.
  const strip = page.locator('.surface-tabs')
  await expect(strip.locator('[aria-label="Toggle Reading / Live Mode"]')).toHaveCount(1)
  await expect(strip.locator('[aria-label="More Options"]')).toHaveCount(1)
  // Exactly one close for the whole pane, not one per header.
  await expect(page.locator('[aria-label="Close split pane"]')).toHaveCount(1)
  // And the document bar no longer contributes a second header row.
  await expect(page.locator('writemd-doc-bar[secondary] .sub-header')).toHaveCount(0)
  await page.screenshot({ path: 'artifacts/ui-review/surface-tabs-document.png' })
  await app.close()
})

test('the document controls only appear on the Document tab', async () => {
  const { app, page } = await open('doc-controls')
  await page.locator('writemd-icon-button[title="Split view"]').click()
  await page.waitForTimeout(900)
  await page.locator('writemd-vault-explorer .node-row', { hasText: 'PRD.md' }).click()
  await page.waitForTimeout(1200)

  await page.locator('.surface-tabs .surface-tab', { hasText: 'Backlinks' }).click()
  await page.waitForTimeout(800)
  // They act on the second document, so they leave with its tab.
  await expect(page.locator('.surface-tabs [aria-label="More Options"]')).toHaveCount(0)
  await app.close()
})
