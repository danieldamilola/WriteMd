import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'
import type { SettingsStore } from '../../src/renderer/src/state/settings'

type Host = { settingsStore: SettingsStore }

/**
 * How far a line number sits off the centre of the line it labels.
 *
 * Centres, not top edges: CodeMirror sizes each gutter element to the whole
 * line block, so a heading's box is far taller than its digits. The number is
 * centred in that box to match the text, which means the tops differ by
 * exactly the difference in height and comparing them would report a correct
 * document as broken.
 *
 * CodeMirror also seeds the gutter with a hidden zero-height spacer, so the
 * first `.cm-gutterElement` in the DOM is not line 1. Pairing by raw index
 * shifts every number by one line.
 */
async function maxNumberDrift(page: Page): Promise<number> {
  return page.evaluate(() => {
    // The editor is a Lit component, so CodeMirror lives in a shadow root and
    // document.querySelector cannot see it.
    const roots: (Document | ShadowRoot)[] = [document]
    const walk = (node: Document | ShadowRoot): void => {
      for (const el of node.querySelectorAll('*')) {
        if (el.shadowRoot) {
          roots.push(el.shadowRoot)
          walk(el.shadowRoot)
        }
      }
    }
    walk(document)
    const root = roots.find((r) => r.querySelector('.cm-gutters'))
    if (!root) return Number.NaN
    const numbers = [...root.querySelectorAll('.cm-gutterElement')].filter(
      (n) => (n as HTMLElement).style.visibility !== 'hidden'
    )
    const lines = [...root.querySelectorAll('.cm-line')]
    const middle = (rect: DOMRect): number => rect.top + rect.height / 2
    const drift = numbers
      .map((n, i) => {
        const line = lines[i]
        if (!line) return null
        return middle(n.getBoundingClientRect()) - middle(line.getBoundingClientRect())
      })
      .filter((v): v is number => v !== null)
    return drift.length ? Math.max(...drift.map(Math.abs)) : Number.NaN
  })
}

async function setMetrics(page: Page, values: Record<string, unknown>): Promise<void> {
  await page.evaluate((values) => {
    ;(document.querySelector('writemd-app') as unknown as Host).settingsStore.setMany(values)
  }, values)
  // CodeMirror measures after the browser has laid the new metrics out.
  await page.waitForTimeout(300)
}

test.describe('Line number alignment', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeEach(async () => {
    const fixture = makeFixture('gutter-alignment')
    writeFileSync(
      join(fixture.vault, 'README.md'),
      `# Changelog\n\n${Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of the document.`).join('\n')}\n`
    )
    app = await launch(fixture)
    page = await firstWindow(app)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await setMetrics(page, {
      'appearance.motion': 'reduced',
      'editor.autoSave': false,
      'editor.showLineNumbers': true
    })
    await expect(page.locator('.cm-gutters')).toBeVisible()
  })

  test.afterEach(async () => {
    await app?.close()
  })

  test('aligns every number with the line it labels', async () => {
    await setMetrics(page, { 'editor.fontSize': 15, 'editor.lineHeight': 1.7 })
    expect(await maxNumberDrift(page)).toBeLessThanOrEqual(1)
  })

  // A heading's line box is far taller than its digits. Left top-aligned the
  // number sat at the top of that box and read as belonging to the line above.
  test('centres numbers on heading lines too', async () => {
    await page.evaluate(() => {
      const host = document.querySelector('writemd-app') as unknown as {
        fileState: { setContent: (text: string) => void }
      }
      host.fileState.setContent(
        '# Title\n\nBody text.\n\n## Section\n\n- item\n\n### Sub\n\nmore\n'
      )
    })
    await page.waitForTimeout(400)
    expect(await maxNumberDrift(page)).toBeLessThanOrEqual(2)
    await page.screenshot({ path: 'artifacts/ui-review/gutter-headings.png' })
  })

  // Font size and line height are CSS custom properties on :root. Changing one
  // resizes the text without touching the CodeMirror view, and the gutter's
  // offset from the first line is cached, so without a re-measure the numbers
  // stay on the old pitch and walk away from their lines.
  for (const [size, lineHeight] of [
    [12, 1.2],
    [16, 1.7],
    [20, 2.0]
  ]) {
    test(`re-aligns after a live change to ${size}px / ${lineHeight}`, async () => {
      await setMetrics(page, { 'editor.fontSize': size, 'editor.lineHeight': lineHeight })
      expect(await maxNumberDrift(page)).toBeLessThanOrEqual(1)
      await page.screenshot({
        path: `artifacts/ui-review/gutter-alignment-${size}.png`
      })
    })
  }

  test('stays aligned when both metrics change together', async () => {
    for (const size of [12, 16, 20, 15]) {
      await setMetrics(page, { 'editor.fontSize': size, 'editor.lineHeight': 1.7 })
      expect(await maxNumberDrift(page), `drift after switching to ${size}px`).toBeLessThanOrEqual(
        1
      )
    }
  })
})
