import { test, expect, type ElectronApplication } from '@playwright/test'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { firstWindow, launch, makeFixture } from './fixtures'

const FILES = [
  'PRD.md',
  'roadmap-notes.md',
  'CHANGELOG.md',
  'README.md',
  'release-checklist.md',
  'design-notes.md',
  'onboarding.md',
  'archive-2025.md'
]

/**
 * The tab strip is the only place in the app that silently truncated content, so
 * the regression test drives it through the real restore-on-launch path with a
 * throwaway userData dir rather than poking renderer internals.
 */
test.describe('Tab strip overflow', () => {
  let app: ElectronApplication | undefined

  test.beforeAll(async () => {
    const fixture = makeFixture('tab-overflow', FILES)
    // openTabs seeds the editor, because `writemd-top-bar` only exists once a
    // document is open; the welcome screen renders its own top bar.
    writeFileSync(
      join(fixture.userData, 'config.json'),
      JSON.stringify({
        files: {
          vaultPath: fixture.vault,
          openTabs: FILES.map((n) => join(fixture.vault, n)),
          activeTabPath: join(fixture.vault, FILES[FILES.length - 1]),
          recentFiles: FILES.map((n) => join(fixture.vault, n))
        },
        appearance: { designVersion: 1, theme: 'dark', panelOrientation: 'horizontal' }
      }),
      'utf-8'
    )
    app = await launch(fixture)
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('strip scrolls instead of clipping, and keeps the active tab visible', async () => {
    const window = await firstWindow(app!)
    await expect(window.locator('writemd-top-bar')).toBeVisible()

    const strip = window.locator('.tab-strip')
    await expect(strip).toBeVisible()
    await expect(strip.locator('writemd-tab')).toHaveCount(FILES.length)

    // The regression: a clipping box that hides tabs with no way to reach them.
    const metrics = await strip.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowX: getComputedStyle(el).overflowX
    }))
    expect(metrics.overflowX).toBe('auto')
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth)

    // The add button lives outside the scroll container, so it can never be clipped.
    await expect(window.locator('.tab-add[aria-label="Open file in new tab"]')).toBeVisible()

    // Newest tab is active and is scrolled into view, not stranded past the edge.
    const active = strip.locator('writemd-tab[active]')
    await expect(active).toHaveCount(1)
    await expect(active).toHaveAttribute('label', FILES[FILES.length - 1])
    await expect
      .poll(async () =>
        active.evaluate((el) => {
          const host = el.parentElement as HTMLElement
          const tab = el.getBoundingClientRect()
          const stripBox = host.getBoundingClientRect()
          return tab.right <= stripBox.right + 1 && tab.left >= stripBox.left - 1
        })
      )
      .toBe(true)

    await window.screenshot({ path: 'test-results/tab-strip-overflow.png' })

    // Wheel over the strip scrolls it.
    const before = await strip.evaluate((el) => el.scrollLeft)
    await strip.hover()
    await window.mouse.wheel(-600, 0)
    await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBeLessThan(before)

    await window.screenshot({ path: 'test-results/tab-strip-scrolled.png' })

    // Clicking a tab switches to it, which is the behaviour the strip was
    // clipping before.
    const first = strip.locator('writemd-tab').first()
    await first.locator('.tab-btn').click()
    await expect(strip.locator('writemd-tab[active]')).toHaveCount(1)
    await expect(strip.locator('writemd-tab[active]').first()).toHaveAttribute('label', FILES[0])
  })
})
