import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'

const fixture = makeFixture('table-cells')

const TABLE = ['| Feature | Parser |', '| --- | --- |', '| Tables | yes |'].join('\n')

/** A row whose cells draw as HTML rather than as their own source text. */
const MARKUP_TABLE = [
  '| Feature | Parser |',
  '| --- | --- |',
  '| **bold** | [docs](https://example.com) |'
].join('\n')

const NOTES: Record<string, string> = {
  'table.md': `${TABLE}\n`,
  'markup.md': `${MARKUP_TABLE}\n`,
  'pipes.md': `${TABLE}\n`,
  'undo-a.md': 'first document\n',
  'undo-b.md': 'second document\n'
}

test.describe('Live table cell editing', () => {
  let app: ElectronApplication | undefined

  test.beforeAll(async () => {
    // Seeded on disk and opened through the tab strip: typing a table char by
    // char is a different code path (and drops keystrokes mid-table when live
    // decorations rebuild under focus).
    const paths: string[] = []
    for (const [name, body] of Object.entries(NOTES)) {
      writeFileSync(join(fixture.vault, name), body, 'utf-8')
      paths.push(join(fixture.vault, name))
    }
    writeFileSync(
      join(fixture.userData, 'config.json'),
      JSON.stringify(
        {
          files: {
            vaultPath: fixture.vault,
            recentFiles: paths,
            openTabs: paths,
            activeTabPath: paths[0]
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

  /** Switch to a seeded note by its tab, and wait for the document to land. */
  async function openNote(window: Page, name: string): Promise<void> {
    await window
      .locator('writemd-tab', { hasText: name.replace(/\.md$/i, '') })
      .first()
      .click()
    await expect(window.locator('writemd-doc-bar input[aria-label="Document title"]')).toHaveValue(
      name.replace(/\.md$/i, ''),
      { timeout: 15_000 }
    )
  }

  test('clicking a cell edits it in place instead of dumping source', async () => {
    const window = await firstWindow(app!)
    await expect(window.locator('writemd-top-bar')).toBeVisible()
    await openNote(window, 'table.md')

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

  test('clicking away from a cell with markup does not rewrite the file', async () => {
    // The data loss this pins: a cell holding `**bold**` draws as `<strong>`, so
    // committing what the cell displays replaced the asterisks with nothing and
    // a link lost its URL. No typing was involved, only a click and a click away.
    const window = await firstWindow(app!)
    const path = join(fixture.vault, 'markup.md')
    await openNote(window, 'markup.md')

    const cells = window.locator('.cm-live-table-cell')
    await expect(cells).toHaveCount(4)
    await cells.nth(2).click()
    await expect(window.locator('.cm-live-table-editing')).toHaveCount(1)
    // Click somewhere else entirely, so the cell blurs and commits.
    await window.locator('writemd-top-bar').click()
    await expect(window.locator('.cm-live-table-editing')).toHaveCount(0)

    // Give the autosave its window, then assert the file is untouched.
    await window.waitForTimeout(1500)
    expect(readFileSync(path, 'utf-8')).toBe(NOTES['markup.md'])
  })

  test('a pipe typed into a cell is escaped rather than adding a column', async () => {
    const window = await firstWindow(app!)
    const path = join(fixture.vault, 'pipes.md')
    await openNote(window, 'pipes.md')

    const cell = window.locator('.cm-live-table-cell').nth(2)
    await cell.click()
    await window.keyboard.press('Control+a')
    await window.keyboard.type('a|b', { delay: 10 })
    await window.keyboard.press('Enter')

    await expect.poll(() => readFileSync(path, 'utf-8')).toContain('| a\\|b |')
    // Still two columns: the row has not gained a cell.
    await expect(window.locator('.cm-live-table-cell')).toHaveCount(4)
  })

  test('undo after switching files does not write the previous file over the new one', async () => {
    // The view loads a document with a whole-document replace. On the undo stack
    // that meant one Ctrl+Z reverted to the previous document's text, which reads
    // as an edit and got autosaved over this file's path.
    const window = await firstWindow(app!)
    await openNote(window, 'undo-a.md')
    await openNote(window, 'undo-b.md')
    await window.waitForTimeout(1500)
    expect(readFileSync(join(fixture.vault, 'undo-b.md'), 'utf-8')).toBe(NOTES['undo-b.md'])

    // Ctrl+Z has to reach CodeMirror, and clicking a tab leaves focus on the tab
    // strip rather than in the document.
    await window.locator('.cm-content').first().click()
    await window.keyboard.press('Control+z')
    await window.waitForTimeout(1500)
    // Neither file took the other's text.
    expect(readFileSync(join(fixture.vault, 'undo-b.md'), 'utf-8')).toBe(NOTES['undo-b.md'])
    expect(readFileSync(join(fixture.vault, 'undo-a.md'), 'utf-8')).toBe(NOTES['undo-a.md'])
  })
})
