import { test, expect } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'

/**
 * The rail collapses to a slim 48px strip holding only the expand button —
 * never to zero, never inert — through the shared engine, which collapses to
 * a single frame when motion is off. These tests pin both halves of that.
 */

async function config(vault: string, motion: string): Promise<void> {
  writeFileSync(
    join(vault, '..', 'userdata', 'config.json'),
    JSON.stringify(
      {
        files: {
          vaultPath: vault,
          recentFiles: [join(vault, 'README.md')],
          openTabs: [join(vault, 'README.md')],
          activeTabPath: join(vault, 'README.md')
        },
        appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical', motion }
      },
      null,
      2
    ),
    'utf-8'
  )
}

test.describe('Vertical tab rail motion', () => {
  test('collapse releases width down to the slim strip and keeps the rail usable', async () => {
    const fixture = makeFixture('rail-collapse')
    await config(fixture.vault, 'full')
    const app = await launch(fixture)
    try {
      const page = await firstWindow(app)
      await expect(page.locator('writemd-vertical-tab-bar')).toBeVisible()
      await expect
        .poll(() =>
          page.locator('writemd-rail-frame').evaluate((el) => el.getBoundingClientRect().width)
        )
        .toBe(208)
      const result = await page.evaluate(async () => {
        const root = document.querySelector('writemd-app')!.shadowRoot!
        const button = root
          .querySelector('writemd-sidebar')!
          .shadowRoot!.querySelector<HTMLElement>('writemd-icon-button[title="Collapse panel"]')!
        const samples: { width: number; editorLeft: number }[] = []
        button.click()
        const start = performance.now()
        while (performance.now() - start < 350) {
          samples.push({
            width: root.querySelector('writemd-rail-frame')!.getBoundingClientRect().width,
            editorLeft: root.querySelector('writemd-editor')!.getBoundingClientRect().left
          })
          await new Promise((resolve) => requestAnimationFrame(resolve))
        }
        return samples
      })
      expect(
        result.filter((sample) => sample.width > 48 && sample.width < 208).length
      ).toBeGreaterThan(0)
      for (const sample of result)
        expect(Math.abs(sample.editorLeft - sample.width)).toBeLessThan(2)
      // Under suite load the sampling window can end mid-animation; the
      // endpoint settles separately.
      await expect
        .poll(() =>
          page.locator('writemd-rail-frame').evaluate((el) => el.getBoundingClientRect().width)
        )
        .toBe(48)
      await expect(page.locator('writemd-vertical-tab-bar')).toBeAttached()
      await expect(page.locator('writemd-rail-frame .rail')).not.toHaveAttribute('inert', '')
      // The slim strip holds only the expand button; the resize handle is gone.
      // Slotted tab content pierces locators, so count the shadow root's own.
      const ownButtons = await page.locator('writemd-sidebar').evaluate((el) => {
        const root = (el as HTMLElement).shadowRoot!
        return Array.from(root.querySelectorAll('writemd-icon-button')).map((b) => b.title)
      })
      expect(ownButtons).toEqual(['Expand panel'])
      await expect(page.locator('writemd-rail-frame .divider')).toHaveCount(0)
      await page.locator('writemd-sidebar button[title="Expand panel"]').click()
      await expect
        .poll(() =>
          page.locator('writemd-rail-frame').evaluate((el) => el.getBoundingClientRect().width)
        )
        .toBe(208)
      await expect(page.locator('writemd-rail-frame .divider')).toHaveCount(1)
      await page.screenshot({ path: 'artifacts/ui-review/fixed-rail.png' })
    } finally {
      await app.close()
    }
  })

  test('keyboard resize persists the preferred width and rapid toggles finish in the requested state', async () => {
    const fixture = makeFixture('rail-resize')
    await config(fixture.vault, 'full')
    const app = await launch(fixture)
    try {
      const page = await firstWindow(app)
      const rail = page.locator('writemd-rail-frame')
      await expect(rail).toBeVisible()
      await rail.locator('[role="separator"]').focus()
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => rail.evaluate((el) => el.getBoundingClientRect().width)).toBe(224)
      await page.locator('writemd-sidebar button[title="Collapse panel"]').click()
      await expect.poll(() => rail.evaluate((el) => el.getBoundingClientRect().width)).toBe(48)
      await page.locator('writemd-sidebar button[title="Expand panel"]').click()
      await expect.poll(() => rail.evaluate((el) => el.getBoundingClientRect().width)).toBe(224)
      await expect(rail.locator('.rail')).not.toHaveAttribute('inert', '')
    } finally {
      await app.close()
    }
  })

  test('reduced motion releases and restores allocation without an animation', async () => {
    const fixture = makeFixture('rail-reduced')
    await config(fixture.vault, 'reduced')
    const app = await launch(fixture)
    try {
      const page = await firstWindow(app)
      const rail = page.locator('writemd-rail-frame')
      await expect(rail).toBeVisible()
      await page.locator('writemd-sidebar button[title="Collapse panel"]').click()
      await expect.poll(() => rail.evaluate((el) => el.getBoundingClientRect().width)).toBe(48)
      expect(await rail.evaluate((el) => el.getAnimations().length)).toBe(0)
      await page.locator('writemd-sidebar button[title="Expand panel"]').click()
      await expect.poll(() => rail.evaluate((el) => el.getBoundingClientRect().width)).toBe(208)
    } finally {
      await app.close()
    }
  })
})
