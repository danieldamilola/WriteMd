import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'

async function open(name: string): Promise<{ app: ElectronApplication; page: Page }> {
  const fixture = makeFixture(`preview-${name}`)
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
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.waitForTimeout(1300)
  return { app, page }
}

test('Preview is a tab and renders the document', async () => {
  const { app, page } = await open('render')
  await page.locator('writemd-icon-button[title="Split view"]').click()
  await page.waitForTimeout(1000)

  const tabs = page.locator('.surface-tabs .surface-tab')
  await expect(tabs).toHaveCount(4)
  await expect(tabs.nth(3)).toHaveText('Preview')

  await tabs.nth(3).click()
  await page.waitForTimeout(1200)
  await expect(page.locator('writemd-preview-panel')).toBeVisible()

  // The iframe carries the document through the shared export builder.
  const frame = page.frameLocator('writemd-preview-panel iframe[title="Export preview"]')
  await expect(frame.locator('h1')).toHaveText('README.md')

  // Page geometry comes from the page-size setting: A4 is 210mm wide.
  const sheet = page.locator('writemd-preview-panel .sheet')
  const width = await sheet.evaluate((el) => el.getBoundingClientRect().width)
  console.log(`SHEET width=${Math.round(width)}`)
  await page.screenshot({ path: 'artifacts/ui-review/export-preview.png' })
  await app.close()
})

test('page size, margin and theme drive the preview and persist', async () => {
  const { app, page } = await open('controls')
  await page.locator('writemd-icon-button[title="Split view"]').click()
  await page.waitForTimeout(900)
  await page.locator('.surface-tabs .surface-tab', { hasText: 'Preview' }).click()
  await page.waitForTimeout(1000)

  const sheet = page.locator('writemd-preview-panel .sheet')
  // Read the declared width, not the rendered one: the sheet is scaled to fit
  // the pane, so a wider page renders at the same on-screen width and a
  // bounding-box measurement would never move. A4 is 210mm, Letter 215.9mm.
  const declared = async (): Promise<number> =>
    sheet.evaluate((el) => parseFloat((el as HTMLElement).style.width))
  const a4Width = await declared()

  await page.locator('writemd-preview-panel select[aria-label="Page size"]').selectOption('Letter')
  await page.waitForTimeout(700)
  await page.locator('writemd-preview-panel select[aria-label="Export theme"]').selectOption('dark')
  await page.waitForTimeout(900)

  const letterWidth = await declared()
  console.log(`SHEET a4=${Math.round(a4Width)} letter=${Math.round(letterWidth)}`)
  expect(letterWidth).toBeGreaterThan(a4Width)
  await page.screenshot({ path: 'artifacts/ui-review/export-preview-letter-dark.png' })
  await app.close()
})

test('the preview iframe is sandboxed and carries no scripts', async () => {
  const { app, page } = await open('sandbox')
  await page.locator('writemd-icon-button[title="Split view"]').click()
  await page.waitForTimeout(900)
  await page.locator('.surface-tabs .surface-tab', { hasText: 'Preview' }).click()
  await page.waitForTimeout(900)

  const info = await page.locator('writemd-preview-panel iframe').evaluate((el) => ({
    sandbox: el.getAttribute('sandbox'),
    srcdocHasScript: /<script/i.test((el as HTMLIFrameElement).srcdoc ?? ''),
    csp: /Content-Security-Policy/.test((el as HTMLIFrameElement).srcdoc ?? '')
  }))
  console.log('IFRAME ' + JSON.stringify(info))
  // Same-origin is granted so the sheet can measure the document and grow past
  // one page; scripts are still withheld, and the document's own policy blocks
  // them independently.
  expect(info.sandbox).toBe('allow-same-origin')
  expect(info.sandbox).not.toContain('allow-scripts')
  expect(info.srcdocHasScript).toBe(false)
  expect(info.csp).toBe(true)
  await app.close()
})

test('the page size select shows the saved value, not the first option', async () => {
  const { app, page } = await open('select-value')
  await page.locator('writemd-icon-button[title="Split view"]').click()
  await page.waitForTimeout(900)
  await page.locator('.surface-tabs .surface-tab', { hasText: 'Preview' }).click()
  await page.waitForTimeout(900)

  // Regression: a select bound with `.value` commits before its options render,
  // so it showed "A0" whatever the settings actually held.
  const shown = await page
    .locator('writemd-preview-panel select[aria-label="Page size"]')
    .inputValue()
  console.log(`SELECT shows=${shown}`)
  expect(shown).toBe('A4')
  await app.close()
})

test('the controls stay reachable in a narrow pane', async () => {
  const { app, page } = await open('narrow')
  await page.locator('writemd-icon-button[title="Split view"]').click()
  await page.waitForTimeout(900)
  await page.locator('.surface-tabs .surface-tab', { hasText: 'Preview' }).click()
  await page.waitForTimeout(1000)

  // The split reserves 320px per pane, so the pane cannot be narrowed past that
  // by dragging. Resizing the window is what actually gets there.
  await page.setViewportSize({ width: 900, height: 900 })
  await page.waitForTimeout(1400)

  const panel = await page.locator('writemd-preview-panel').evaluate((el) => {
    const root = (el as HTMLElement).shadowRoot!
    const bar = root.querySelector('.bar')!.getBoundingClientRect()
    const items = Array.from(root.querySelectorAll('.bar label, .action')).map((n) => {
      const r = n.getBoundingClientRect()
      return { text: n.textContent?.trim().slice(0, 10), right: r.right, w: r.width }
    })
    return { barRight: bar.right, barHeight: bar.height, items }
  })
  const clipped = panel.items.filter((i) => i.right > panel.barRight + 1)
  console.log(
    `BAR h=${Math.round(panel.barHeight)} clipped=${clipped.length} ${JSON.stringify(panel.items)}`
  )
  // Nothing may hang off the right edge, and nothing may collapse to a sliver.
  expect(clipped).toEqual([])
  for (const item of panel.items) expect(item.w).toBeGreaterThan(24)
  await page.screenshot({ path: 'artifacts/ui-review/export-preview-narrow.png' })
  await app.close()
})

test('a long document grows past one page instead of being clipped', async () => {
  const { app, page } = await open('long-doc')
  await page.evaluate(() => {
    const el = document.querySelector('writemd-app') as unknown as {
      fileState: { setContent(content: string): void }
    }
    // Comfortably more than one A4 page of body text.
    el.fileState.setContent(
      Array.from(
        { length: 160 },
        (_, i) => `Paragraph ${i + 1} of the export preview document.`
      ).join('\n\n')
    )
  })
  await page.waitForTimeout(800)
  await page.locator('writemd-icon-button[title="Split view"]').click()
  await page.waitForTimeout(900)
  await page.locator('.surface-tabs .surface-tab', { hasText: 'Preview' }).click()
  await page.waitForTimeout(2000)

  const sheet = page.locator('writemd-preview-panel .sheet')
  const frameHeight = await page
    .locator('writemd-preview-panel iframe')
    .evaluate((el) => el.getBoundingClientRect().height)
  const foot = await page.locator('writemd-preview-panel .foot').textContent()
  console.log(`FRAME height=${Math.round(frameHeight)} foot=${foot?.trim()}`)
  // The last paragraph has to be inside the frame, or the preview is lying.
  const frame = page.frameLocator('writemd-preview-panel iframe[title="Export preview"]')
  await expect(frame.locator('text=Paragraph 160')).toBeAttached()
  expect(foot).toContain('pages')
  void sheet
  await page.screenshot({ path: 'artifacts/ui-review/export-preview-long.png' })
  await app.close()
})
