import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'
import type { SettingsStore } from '../../src/renderer/src/state/settings'
import type { FileState } from '../../src/renderer/src/state/file-state'

type Host = { settingsStore: SettingsStore; fileState: FileState }
const content = 'word '.repeat(23_675) + '\n\nLast line of the document.'

async function prefs(page: Page, values: Record<string, unknown>): Promise<void> {
  await page.evaluate((values) => {
    ;(document.querySelector('writemd-app') as unknown as Host).settingsStore.setMany(values)
  }, values)
}

/**
 * The footer is a real row in the flow, not a box floating over the text.
 *
 * Each assertion below maps to a way the corner box failed: it sat on top of
 * the last line, it had no width of its own so narrow panes squeezed it, and
 * it carried a border, surface and radius that the editor surface does not.
 *
 * The footer also draws no rule. The content is masked so it fades into the
 * bar, so a visible border here would reintroduce the divider this replaced.
 *
 * It does paint the shared material surface and blur, so it follows the
 * translucent appearance and window material the user picked rather than
 * inventing its own opacity.
 */
async function verifyFooter(footer: Locator): Promise<void> {
  await expect(footer).toHaveCSS('position', 'relative')
  await expect(footer).toHaveCSS('border-top-width', '0px')
  await expect(footer.locator('.pill')).toHaveCSS('box-shadow', 'none')
  await expect(footer.locator('.pill')).toHaveCSS('border-top-width', '0px')
  await expect(footer.locator('.pill')).toHaveCSS('border-radius', '0px')
  // The bar is a material layer like the pane and top bar, not a flat one.
  await expect(footer).toHaveCSS('backdrop-filter', /blur\(/)
  // The pill inside stays transparent; the bar carries the surface.
  await expect(footer.locator('.pill')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

  const bounds = await footer.evaluate((element) => {
    const body = element.parentElement!
    const editor = body.querySelector('.cm-wrapper')!
    const row = element.getBoundingClientRect()
    const area = body.getBoundingClientRect()
    const editorArea = editor.getBoundingClientRect()
    const pill = element.shadowRoot!.querySelector<HTMLElement>('.pill')!
    return {
      // The footer starts below the editor instead of overlapping it.
      editorBottom: editorArea.bottom,
      top: row.top,
      bottom: row.bottom,
      bodyBottom: area.bottom,
      right: row.right,
      bodyRight: area.right,
      width: row.width,
      bodyWidth: area.width,
      height: row.height,
      overflow: pill.scrollWidth - pill.clientWidth
    }
  })
  expect(bounds.editorBottom).toBeLessThanOrEqual(bounds.top + 1)
  expect(bounds.height).toBeGreaterThanOrEqual(30)
  expect(Math.abs(bounds.bottom - bounds.bodyBottom)).toBeLessThan(1)
  expect(Math.abs(bounds.width - bounds.bodyWidth)).toBeLessThan(1)
  expect(Math.abs(bounds.right - bounds.bodyRight)).toBeLessThan(1)
  expect(bounds.overflow).toBeLessThanOrEqual(1)
}

/** The last line must sit above the footer, not underneath it. */
async function scrollToEnd(page: Page): Promise<void> {
  await page.locator('writemd-panel[slot="primary"] .cm-scroller').evaluate((scroller) => {
    scroller.scrollTop = scroller.scrollHeight
  })
  await expect(page.locator('.cm-line', { hasText: 'Last line of the document.' })).toBeVisible()
}

/**
 * The content fades into the footer instead of being cut by a rule.
 *
 * The mask has to sit on the scroller, not on `.cm-content`. The content box is
 * as tall as the entire document, so a percentage there resolves against
 * thousands of pixels and parks the fade at the very end of the file instead
 * of above the footer. Asserting only that a gradient exists would pass for
 * both, so this also pins the fade to the bottom of the visible scroller.
 */
async function verifyFade(page: Page): Promise<void> {
  // Mid-scroll is where the bug shows. Scrolled to the end, a fade anchored to
  // the document and one anchored to the viewport look identical.
  await page.locator('writemd-panel[slot="primary"] .cm-scroller').evaluate((el) => {
    el.scrollTop = Math.floor(el.scrollHeight / 2)
  })
  const fade = await page
    .locator('writemd-panel[slot="primary"] .cm-scroller')
    .evaluate((element) => {
      const style = getComputedStyle(element)
      const mask = style.maskImage || style.webkitMaskImage
      const lines = [...element.querySelectorAll('.cm-line')]
      const last = lines[lines.length - 1]!.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      return {
        mask,
        // Content runs on past the viewport, so a viewport-anchored fade is
        // the only thing that can be drawn above the footer here.
        lastLineBelow: Math.round(last.bottom - box.bottom),
        height: Math.round(box.height)
      }
    })
  expect(fade.mask).toContain('linear-gradient')
  expect(fade.mask).toContain('calc(100% - 56px)')
  // If the mask were sized to `.cm-content` the fade would sit at the document's
  // end instead, which is the bug this test exists to catch.
  expect(fade.lastLineBelow).toBeGreaterThan(fade.height)
}

/** The final line of a document must stay clear of the fade band. */
async function verifyEndOfDocumentIsReadable(page: Page): Promise<void> {
  await scrollToEnd(page)
  const clearance = await page
    .locator('writemd-panel[slot="primary"] .cm-line', { hasText: 'Last line of the document.' })
    .evaluate((element) => {
      const line = element.getBoundingClientRect()
      const scroller = element.closest('.cm-scroller')!.getBoundingClientRect()
      return Math.round(scroller.bottom - line.bottom)
    })
  // 120px of bottom padding keeps the last line above the 56px fade, so the
  // end of a document is fully readable once scrolled to the end.
  expect(clearance).toBeGreaterThanOrEqual(56)
}

test.describe('Document footer', () => {
  let app: ElectronApplication
  let page: Page
  let fixture: ReturnType<typeof makeFixture>

  test.beforeEach(async () => {
    fixture = makeFixture('document-footer')
    writeFileSync(join(fixture.vault, 'README.md'), content)
    app = await launch(fixture)
    page = await firstWindow(app)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await prefs(page, { 'appearance.motion': 'reduced', 'editor.autoSave': false })
  })

  test.afterEach(async () => {
    await app?.close()
  })

  test('reserves space beneath a long document in both layouts and every theme', async () => {
    const footer = page.locator('writemd-panel[slot="primary"] writemd-info-pill')
    await expect(footer.locator('.counts')).toContainText('23,680 words')
    for (const theme of ['graphite', 'light', 'dark', 'midnight', 'nord', 'dracula', 'paper']) {
      for (const orientation of ['vertical', 'horizontal']) {
        await prefs(page, {
          'appearance.theme': theme,
          'appearance.panelOrientation': orientation
        })
        await scrollToEnd(page)
        await verifyFooter(footer)
        await verifyFade(page)
        await verifyEndOfDocumentIsReadable(page)
        await page.screenshot({
          path: `artifacts/ui-review/document-footer-${theme}-${orientation}.png`
        })
      }
    }
    await footer.getByRole('button', { name: 'Change editor mode' }).focus()
    await page.keyboard.press('Enter')
    await expect(footer.locator('writemd-mode-menu')).toBeVisible()
    await footer.locator('writemd-mode-menu .item', { hasText: 'Source mode' }).click()
    await expect(footer).toHaveJSProperty('mode', 'source')
    await verifyFooter(footer)
  })

  test('fades the content in reading mode too', async () => {
    const footer = page.locator('writemd-panel[slot="primary"] writemd-info-pill')
    await footer.getByRole('button', { name: 'Change editor mode' }).click()
    await footer.locator('writemd-mode-menu .item', { hasText: 'Reading' }).click()
    await expect(footer).toHaveJSProperty('mode', 'reading')
    // Reading renders through the same scroller, so the fade has to hold.
    await scrollToEnd(page)
    await verifyFade(page)
    // verifyFade leaves the viewport mid-document, which is the only place the
    // fade is actually visible. Scrolled to the end, the last line clears it.
    await page.screenshot({ path: 'artifacts/ui-review/document-footer-fade-reading.png' })
    await verifyEndOfDocumentIsReadable(page)
    await verifyFooter(footer)
  })

  test('opens the mode menu inside the pane rather than flush to the window edge', async () => {
    const footer = page.locator('writemd-panel[slot="primary"] writemd-info-pill')
    await footer.getByRole('button', { name: 'Change editor mode' }).click()
    const menu = footer.locator('writemd-mode-menu')
    await expect(menu).toBeVisible()

    // It opens upward out of the footer and stays inside the window.
    const geometry = await menu.evaluate((element) => {
      const row = element.getBoundingClientRect()
      // The menu lives in the footer's shadow root, so its parentElement is the
      // shadow root rather than the host.
      const root = element.getRootNode() as ShadowRoot
      const host = (root.host ?? element.parentElement!).getBoundingClientRect()
      return { bottom: row.bottom, top: row.top, right: row.right, hostRight: host.right }
    })
    expect(geometry.top).toBeLessThan(geometry.bottom)
    expect(geometry.right).toBeLessThanOrEqual(geometry.hostRight)

    await page.keyboard.press('Escape')
  })

  test('keeps separate footers and mode controls in narrow document panes', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 800))
    await prefs(page, {
      'appearance.panelOrientation': 'horizontal',
      'appearance.paneWidth': 320
    })
    await page.evaluate(
      async ({ path, content }) => {
        const host = document.querySelector('writemd-app') as unknown as Host
        await host.fileState.openSecondaryFile(path, content)
      },
      { path: join(fixture.vault, 'PRD.md'), content: 'Second pane document.' }
    )
    const primary = page.locator('writemd-panel[slot="primary"] writemd-info-pill')
    const secondary = page.locator('writemd-panel[slot="auxiliary"] writemd-info-pill')
    await expect(primary.locator('.counts')).toContainText('23,680 words')
    await expect(secondary.locator('.counts')).toContainText('3 words')
    await verifyFooter(primary)
    await verifyFooter(secondary)
    await secondary.getByRole('button', { name: 'Change editor mode' }).click()
    await secondary.locator('writemd-mode-menu .item', { hasText: 'Source mode' }).click()
    await expect(secondary).toHaveJSProperty('mode', 'source')
    await expect(primary).toHaveJSProperty('mode', 'live')
    await page.screenshot({ path: 'artifacts/ui-review/document-footer-split.png' })
  })

  test('shows each pane its own path on the left of the footer', async () => {
    const primary = page.locator('writemd-panel[slot="primary"] writemd-info-pill')
    // Both the path and the title left the document header. The title is now
    // the first thing in the editor itself.
    await expect(primary.locator('.path')).toContainText('README.md')
    await expect(primary.locator('.path')).toHaveAttribute('title', /README\.md$/)
    await expect(page.locator('writemd-doc-bar input.title-input')).toHaveCount(0)
    await expect(page.locator('.cm-inline-title')).toHaveValue('README')

    await page.evaluate(
      async ({ path, content }) => {
        const host = document.querySelector('writemd-app') as unknown as Host
        await host.fileState.openSecondaryFile(path, content)
      },
      { path: join(fixture.vault, 'PRD.md'), content: 'Second pane document.' }
    )
    const secondary = page.locator('writemd-panel[slot="auxiliary"] writemd-info-pill')
    await expect(secondary.locator('.path')).toContainText('PRD.md')
    await expect(primary.locator('.path')).toContainText('README.md')
  })

  test('hides the path when the setting is off, in both panes', async () => {
    const primary = page.locator('writemd-panel[slot="primary"] writemd-info-pill')
    await expect(primary.locator('.path')).toContainText('README.md')

    // Settings live behind a keyboard shortcut; the title bar has no button.
    await page.keyboard.press('Control+,')
    const modal = page.locator('writemd-settings-modal')
    await expect(modal).toBeVisible()
    await modal.locator('.nav-btn', { hasText: 'Editor' }).click()
    await modal.getByRole('switch', { name: 'File path' }).click()
    await expect(modal.getByRole('switch', { name: 'File path' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    await page.keyboard.press('Escape')

    // No leftover box on the left, so the bar does not keep an empty gap.
    await expect(primary.locator('.path')).toHaveCount(0)
    await expect(primary.locator('.counts')).toBeVisible()
    // The counts must stay on the trailing edge. With space-between and the
    // path gone, the right-hand group became the only flex child and slid to
    // the left of the pane.
    const inset = await primary.evaluate((footer) => {
      const pane = footer.closest('writemd-panel')!.getBoundingClientRect()
      const counts = footer.shadowRoot!.querySelector('.counts')!.getBoundingClientRect()
      return Math.round(pane.right - counts.right)
    })
    expect(inset).toBeLessThanOrEqual(16)

    await page.evaluate(
      async ({ path, content }) => {
        const host = document.querySelector('writemd-app') as unknown as Host
        await host.fileState.openSecondaryFile(path, content)
      },
      { path: join(fixture.vault, 'PRD.md'), content: 'Second pane document.' }
    )
    await expect(
      page.locator('writemd-panel[slot="auxiliary"] writemd-info-pill .path')
    ).toHaveCount(0)

    // Restoring it brings the path back without a reload.
    await page.keyboard.press('Control+,')
    await expect(modal).toBeVisible()
    await modal.locator('.nav-btn', { hasText: 'Editor' }).click()
    await modal.getByRole('switch', { name: 'File path' }).click()
    await page.keyboard.press('Escape')
    await expect(primary.locator('.path')).toContainText('README.md')
  })

  test('follows the translucent appearance instead of a fixed opacity', async () => {
    const footer = page.locator('writemd-panel[slot="primary"] writemd-info-pill')
    const panel = page.locator('writemd-panel[slot="primary"]')

    // Chromium resolves an opaque surface to `color(srgb ...)`, so the alpha has
    // to come from painting the value rather than from parsing it.
    const alpha = (locator: Locator): Promise<number> =>
      locator.evaluate((element) => {
        const context = document.createElement('canvas').getContext('2d')!
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = getComputedStyle(element).backgroundColor
        context.fillRect(0, 0, 1, 1)
        return context.getImageData(0, 0, 1, 1).data[3] / 255
      })

    // Fully opaque surface: no translucency to follow.
    await prefs(page, { 'appearance.surfaceOpacity': 100 })
    expect(await alpha(footer)).toBeCloseTo(1, 2)
    expect(await footer.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe('blur(0px)')

    // Reduced opacity: the bar and the pane share one material, and the blur
    // that goes with it switches on rather than the bar inventing its own.
    await prefs(page, { 'appearance.surfaceOpacity': 55 })
    const footerAlpha = await alpha(footer)
    expect(footerAlpha).toBeLessThan(0.95)
    expect(await footer.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe('blur(8px)')
    // Same token as the pane, so they stay one surface.
    expect(footerAlpha).toBeCloseTo(await alpha(panel), 2)
    await page.screenshot({ path: 'artifacts/ui-review/document-footer-translucent.png' })

    await prefs(page, { 'appearance.surfaceOpacity': 100 })
  })
})
