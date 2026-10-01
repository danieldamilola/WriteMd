import { test, expect } from '@playwright/test'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { firstWindow, launch, makeFixture } from './fixtures'

/**
 * A regression test for icon geometry.
 *
 * Before src/renderer/src/components/icons.ts the same glyph could be drawn on a
 * 24 grid with round caps in one file and on a 12 grid with butt caps in
 * another, which is why the settings sidebar looked heavier than the rest of
 * the app. The assertions are about attributes rather than appearance, so they
 * catch a second inline SVG creeping back in, and they catch a glyph authored
 * on the wrong grid, which is the failure that is invisible in a diff.
 */
test.describe('Icon set', () => {
  test('names are unique and cover what the app asks for', async () => {
    const { ICON_NAMES } = await import(join(process.cwd(), 'src/renderer/src/components/icons.ts'))
    expect(ICON_NAMES.length).toBeGreaterThan(40)
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length)
  })

  test('settings sidebar renders one grid, filled, at a uniform size', async () => {
    const fixture = makeFixture('icons')
    writeFileSync(
      join(fixture.userData, 'config.json'),
      JSON.stringify({
        files: {
          vaultPath: fixture.vault,
          recentFiles: [join(fixture.vault, 'README.md')],
          openTabs: [join(fixture.vault, 'README.md')],
          activeTabPath: join(fixture.vault, 'README.md')
        },
        appearance: { theme: 'dark', panelOrientation: 'horizontal' }
      }),
      'utf-8'
    )
    const app = await launch(fixture)
    const window = await firstWindow(app)
    // The custom elements render async after domcontentloaded; clicking before
    // the top bar exists silently does nothing.
    await expect(window.locator('writemd-top-bar')).toBeVisible({ timeout: 15000 })

    await window.evaluate(() => {
      const host = document.querySelector('writemd-app') as HTMLElement | null
      const top = host?.shadowRoot?.querySelector('writemd-top-bar')
      const btn = top?.shadowRoot?.querySelector(
        'writemd-icon-button[title="Settings"]'
      ) as HTMLElement | null
      btn?.click()
    })
    await expect
      .poll(
        async () =>
          window.evaluate(() => {
            const host = document.querySelector('writemd-app') as
              (HTMLElement & { shadowRoot: ShadowRoot | null }) | null
            return !!host?.shadowRoot?.querySelector('writemd-settings-modal')
          }),
        { timeout: 15000 }
      )
      .toBe(true)

    const report = await window.evaluate(() => {
      const app = document.querySelector('writemd-app') as HTMLElement & {
        shadowRoot: ShadowRoot | null
      }
      const modal = app.shadowRoot?.querySelector('writemd-settings-modal') as
        (HTMLElement & { shadowRoot: ShadowRoot | null }) | null
      const nav = modal?.shadowRoot?.querySelector('.sidebar-nav')
      if (!nav) return { error: 'settings modal did not open' }
      const bad: string[] = []
      let count = 0
      for (const b of Array.from(nav.querySelectorAll('.nav-btn'))) {
        if ((b as HTMLElement).hidden) continue
        count++
        const label = b.textContent?.trim() ?? '?'
        const svg = b.querySelector('svg')
        if (!svg) {
          bad.push(`${label}: no icon`)
          continue
        }
        // The set is Line Awesome, authored solid on a 32 grid.
        if (svg.getAttribute('viewBox') !== '0 0 32 32') {
          bad.push(`${label}: viewBox ${svg.getAttribute('viewBox')}`)
        }
        if (svg.getAttribute('fill') !== 'currentColor') bad.push(`${label}: not filled`)
        // A stroke-based glyph here would render hairline-thin next to the
        // filled ones, which is the inconsistency this test exists to stop.
        if (svg.getAttribute('stroke') !== null) bad.push(`${label}: stroked, should be solid`)
        if (!svg.children.length) bad.push(`${label}: no path data`)
        const r = svg.getBoundingClientRect()
        if (Math.abs(r.width - 16) > 0.5) bad.push(`${label}: width ${r.width}`)
      }
      return { count, bad }
    })

    expect(report.count).toBeGreaterThanOrEqual(8)
    expect(report).toEqual({ count: report.count, bad: [] })
    await window.screenshot({ path: 'test-results/icons-settings-nav.png' })
    await app.close()
  })
})
