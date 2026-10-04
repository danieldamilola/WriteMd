import { test, expect, type ElectronApplication } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'

const fixture = makeFixture('table-cells')

const TABLE = ['| Feature | Parser |', '| --- | --- |', '| Tables | yes |'].join('\n')

test.describe('Live table cell editing', () => {
  let app: ElectronApplication | undefined

  test.beforeAll(async () => {
    // Seed the note on disk and open it directly: typing a table char by
    // char is a different code path (and currently drops keystrokes
    // mid-table when live decorations rebuild under focus).
    writeFileSync(join(fixture.vault, 'table.md'), `${TABLE}\n`, 'utf-8')
    writeFileSync(
      join(fixture.userData, 'config.json'),
      JSON.stringify(
        {
          files: {
            vaultPath: fixture.vault,
            recentFiles: [join(fixture.vault, 'table.md')],
            openTabs: [join(fixture.vault, 'table.md')],
            activeTabPath: join(fixture.vault, 'table.md')
          },
          appearance: { theme: 'dark', panelOrientation: 'horizontal' }
        },
        null,
        2
      ),
      'utf-8'
    )
    app = await launch(fixture)
  })

  test.afterAll(async () => {
    await app?.close()
    fixture.cleanup()
  })

  test('clicking a cell edits it in place instead of dumping source', async () => {
    const window = await firstWindow(app!)
    await expect(window.locator('writemd-top-bar')).toBeVisible()

    // The rendered table: real cells, no pipes. (Located by index:
    // Playwright's hasText filter does not match across these shadow roots.)
    const cells = window.locator('.cm-live-table-cell')
    await expect(cells).toHaveCount(4)
    const texts = await cells.evaluateAll((els) => els.map((el) => el.textContent))
    expect(texts).toEqual(['Feature', 'Parser', 'Tables', 'yes'])
    const cell = cells.nth(2)

    // Click the cell. The old behavior destroyed the widget and showed raw
    // pipes; the cell must stay rendered and become editable instead.
    await cell.click()
    await expect(cell).toHaveClass(/cm-live-table-editing/)
    await expect(window.locator('.cm-live-table-cell')).toHaveCount(4)

    // Replace the cell text and commit with Enter.
    await window.keyboard.press('Control+a')
    await window.keyboard.type('Grids', { delay: 10 })
    await window.keyboard.press('Enter')

    // The document carries the edit and the table stays rendered.
    await expect
      .poll(() => readFileSync(join(fixture.vault, 'table.md'), 'utf-8'))
      .toContain('| Grids | yes |')
    const afterCells = window.locator('.cm-live-table-cell')
    await expect(afterCells).toHaveCount(4)
    await expect
      .poll(() => afterCells.evaluateAll((els) => els.map((el) => el.textContent)))
      .toContain('Grids')

    // The single body row has no row below: Enter commits and leaves nothing
    // flagged rather than stranding the highlight.
    await expect(window.locator('.cm-live-table-editing')).toHaveCount(0)

    // From the header, Enter moves editing down into the body: exactly one
    // cell flagged...
    await afterCells.nth(0).click()
    await expect(window.locator('.cm-live-table-editing')).toHaveCount(1)
    await window.keyboard.press('Enter')
    await expect(window.locator('.cm-live-table-editing')).toHaveCount(1)
    // ...and Escape leaves none flagged (no stuck highlight).
    await window.keyboard.press('Escape')
    await expect(window.locator('.cm-live-table-editing')).toHaveCount(0)
  })
})
