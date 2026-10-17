import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  chooseSettingsOption,
  firstWindow,
  launch,
  makeFixture,
  openSettings,
  resizeWindow
} from './fixtures'

for (const [theme, width] of [
  ['graphite', 1200],
  ['paper', 800]
] as const) {
  test(`reorganized settings keep controls searchable and saved in ${theme}`, async () => {
    const fixture = makeFixture('settings-organization-' + theme)
    const configPath = join(fixture.userData, 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.appearance.theme = theme
    config.updates = { autoCheckForUpdates: false }
    writeFileSync(configPath, JSON.stringify(config))
    const app = await launch(fixture)
    try {
      const page = await firstWindow(app)
      await resizeWindow(app, width, 760)
      await openSettings(page)
      const modal = page.locator('writemd-settings-modal')
      await expect(modal.locator('.nav-group')).toHaveText([
        'Writing',
        'Workspace',
        'Assistant',
        'Application'
      ])
      await expect(modal.locator('.nav-btn')).toHaveText([
        'Editor',
        'Files & vault',
        'Export',
        'Appearance',
        'Keyboard shortcuts',
        'AI assistant',
        'Skills',
        'System',
        'About WriteMd'
      ])
      const search = modal.locator('.sidebar-search writemd-search-bar input')
      for (const [query, destination, label] of [
        ['mermaid', 'editor', 'Enable Mermaid'],
        ['file path', 'appearance', 'File Path'],
        ['new notes', 'files', 'Default file name'],
        ['pdf margin', 'export', 'PDF margin'],
        ['personal skills', 'skills', 'Personal skills'],
        ['gpu', 'system', 'Hardware acceleration']
      ]) {
        await search.fill(query)
        await expect(modal.locator('.content-panel')).toHaveAttribute('data-tab', destination)
        await expect(modal.locator('.setting-row.search-hit')).toContainText(label)
      }
      await search.fill('')
      await modal.getByRole('button', { name: 'Files & vault', exact: true }).click()
      await expect(modal.locator('.section-title')).toHaveText(['Vault', 'Notes'])
      await modal.getByLabel('Default file name', { exact: true }).fill('Draft.md')
      await modal.getByLabel('Default file name', { exact: true }).press('Tab')
      await page.screenshot({
        path: `artifacts/ui-review/settings-reorganized-files-${theme}.png`,
        animations: 'disabled'
      })
      await modal.getByRole('button', { name: 'Editor', exact: true }).click()
      await modal.getByRole('switch', { name: 'Enable Mermaid', exact: true }).click()
      await expect(modal.getByRole('switch', { name: 'File path', exact: true })).toHaveCount(0)
      await page.screenshot({
        path: `artifacts/ui-review/settings-reorganized-editor-${theme}.png`,
        animations: 'disabled'
      })
      await modal.getByRole('button', { name: 'Appearance', exact: true }).click()
      await modal.getByRole('switch', { name: 'File path', exact: true }).click()
      await modal.getByRole('button', { name: 'Export', exact: true }).click()
      await chooseSettingsOption(page, 'PDF page size', 'Letter')
      await page.screenshot({
        path: `artifacts/ui-review/settings-reorganized-export-${theme}.png`,
        animations: 'disabled'
      })
      await modal.getByRole('button', { name: 'System', exact: true }).click()
      await expect(modal.getByRole('switch', { name: 'Hardware acceleration' })).toBeVisible()
      await expect(modal.getByRole('switch', { name: 'Enable Mermaid' })).toHaveCount(0)
      await expect(modal.getByLabel('PDF page size')).toHaveCount(0)
      await page.screenshot({
        path: `artifacts/ui-review/settings-reorganized-system-${theme}.png`,
        animations: 'disabled'
      })
      await modal.getByRole('button', { name: 'Skills', exact: true }).click()
      await expect(
        modal.getByRole('button', { name: 'Open skills folder', exact: true })
      ).toBeVisible()
      await page.screenshot({
        path: `artifacts/ui-review/settings-reorganized-skills-${theme}.png`,
        animations: 'disabled'
      })
      await expect
        .poll(() => {
          const saved = JSON.parse(readFileSync(configPath, 'utf8'))
          return [
            saved.files.defaultNewFileName,
            saved.advanced.enableMermaid,
            saved.editor.showFilePath,
            saved.export.pdfPageSize
          ]
        })
        .toEqual(['Draft.md', false, false, 'Letter'])
      await page.reload()
      await openSettings(page)
      await modal.getByRole('button', { name: 'Files & vault', exact: true }).click()
      await expect(modal.getByLabel('Default file name')).toHaveValue('Draft.md')
      await modal.getByRole('button', { name: 'Editor', exact: true }).click()
      await expect(modal.getByRole('switch', { name: 'Enable Mermaid' })).toHaveAttribute(
        'aria-checked',
        'false'
      )
      await modal.getByRole('button', { name: 'Export', exact: true }).click()
      await expect(modal.locator('wa-select[aria-label="PDF page size"]')).toHaveJSProperty(
        'value',
        'Letter'
      )
    } finally {
      await app.close()
      fixture.cleanup()
    }
  })
}
