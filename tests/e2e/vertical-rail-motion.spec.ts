import { test, expect } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'

/**
 * The rail used to be mounted and unmounted outright, so collapsing it was an
 * instant disappearance and expanding it was an instant appearance. It now
 * slides, through the shared engine, which collapses to a single frame when
 * motion is off. These tests pin both halves of that.
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
        appearance: { theme: 'dark', panelOrientation: 'vertical', motion }
      },
      null,
      2
    ),
    'utf-8'
  )
}

test.describe('Vertical tab rail motion', () => {
  test('collapsing slides the rail away instead of dropping it', async () => {
    const fixture = makeFixture('rail-collapse')
    await config(fixture.vault, 'full')
    const app = await launch(fixture)
    const page = await firstWindow(app)
    await expect(page.locator('writemd-top-bar')).toBeVisible()
    await expect(page.locator('writemd-vertical-tab-bar')).toBeAttached()
    await page.waitForTimeout(800)

    const result = await page.evaluate(async () => {
      const root = document.querySelector('writemd-app')?.shadowRoot
      const topBar = root?.querySelector('writemd-top-bar')?.shadowRoot
      const button = topBar?.querySelector<HTMLElement>(
        'writemd-icon-button[title="Collapse panel"]'
      )
      if (!button) return null
      const samples: number[] = []
      const started = performance.now()
      button.click()
      while (performance.now() - started < 400) {
        const live = root?.querySelector('writemd-vertical-tab-bar') as HTMLElement | null
        samples.push(live ? Number(getComputedStyle(live).opacity) : 0)
        await new Promise((r) => requestAnimationFrame(r))
      }
      return { samples, stillThere: !!root?.querySelector('writemd-vertical-tab-bar') }
    })

    expect(result).not.toBeNull()
    const { samples, stillThere } = result!
    // It faded on the way out rather than being gone on frame one.
    expect(samples[0]).toBe(1)
    expect(Math.min(...samples)).toBeLessThan(1)
    // Some frames in between, not one jump.
    expect(samples.filter((s) => s > 0 && s < 1).length).toBeGreaterThan(2)
    // And it is unmounted once the animation is done.
    expect(stillThere).toBe(false)
    await app.close()
  })

  test('expanding fades it back in and it stays usable', async () => {
    const fixture = makeFixture('rail-expand')
    await config(fixture.vault, 'full')
    const app = await launch(fixture)
    const page = await firstWindow(app)
    await expect(page.locator('writemd-top-bar')).toBeVisible()
    await expect(page.locator('writemd-vertical-tab-bar')).toBeAttached()
    await page.waitForTimeout(800)

    const collapse = page
      .locator('writemd-top-bar')
      .locator('writemd-icon-button[title="Collapse panel"]')
    await collapse.click()
    await expect(page.locator('writemd-vertical-tab-bar')).toHaveCount(0, { timeout: 5000 })

    const expand = page
      .locator('writemd-top-bar')
      .locator('writemd-icon-button[title="Expand panel"]')
    await expand.click()
    await expect(page.locator('writemd-vertical-tab-bar')).toBeAttached({ timeout: 5000 })
    await expect(page.locator('writemd-vertical-tab-bar')).toBeVisible()
    // Settled at full opacity, so the reveal did not leave it translucent.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const rail = document
              .querySelector('writemd-app')
              ?.shadowRoot?.querySelector('writemd-vertical-tab-bar')
            return rail ? Number(getComputedStyle(rail).opacity) : -1
          }),
        { timeout: 5000 }
      )
      .toBe(1)
    await app.close()
  })

  test('with motion off it still collapses, just without the slide', async () => {
    const fixture = makeFixture('rail-reduced')
    await config(fixture.vault, 'reduced')
    const app = await launch(fixture)
    const page = await firstWindow(app)
    await expect(page.locator('writemd-top-bar')).toBeVisible()
    await expect(page.locator('writemd-vertical-tab-bar')).toBeAttached()
    await page.waitForTimeout(800)

    await page
      .locator('writemd-top-bar')
      .locator('writemd-icon-button[title="Collapse panel"]')
      .click()
    await expect(page.locator('writemd-vertical-tab-bar')).toHaveCount(0, { timeout: 5000 })
    await page
      .locator('writemd-top-bar')
      .locator('writemd-icon-button[title="Expand panel"]')
      .click()
    await expect(page.locator('writemd-vertical-tab-bar')).toBeVisible({ timeout: 5000 })
    await app.close()
  })
})
