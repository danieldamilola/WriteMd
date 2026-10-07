import { test, expect } from '@playwright/test'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { firstWindow, launch, makeFixture, openSettings } from './fixtures'

/**
 * A regression test for icon geometry.
 *
 * `icon()` resolves through the Hugeicons chrome set first and falls back to
 * the Line Awesome PATHS, so the nav renders 24-grid stroked outlines. The
 * assertions are about attributes rather than appearance, so they catch a
 * second inline SVG creeping back in, and they catch a glyph authored on the
 * wrong grid, which is the failure that is invisible in a diff.
 */

const SRC = join(process.cwd(), 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue
      walk(full, out)
    } else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

/** Keys of a `const NAME = { ... }` map, parsed statically: importing the icon
 * modules in Node trips the ESM-only Hugeicons dist, which Vite handles but
 * the spec runner cannot. */
function mapKeys(source: string, name: string): string[] {
  const start = source.indexOf(`const ${name}`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}') {
      depth--
      if (depth === 0) {
        const body = source.slice(open, i)
        return Array.from(body.matchAll(/^\s*'([^']+)'|^\s*([a-z0-9-]+)\s*:/gim))
          .map((m) => m[1] ?? m[2])
          .filter((k) => k !== 'key')
      }
    }
  }
  return []
}

test.describe('Icon set', () => {
  test('names are unique and cover what the app asks for', async () => {
    const components = readFileSync(join(SRC, 'renderer/src/components/icons.ts'), 'utf-8')
    const design = readFileSync(join(SRC, 'renderer/src/design/icons.ts'), 'utf-8')
    // The Hugeicons chrome set shadows same-named Line Awesome fallbacks by
    // design, so uniqueness holds per map; coverage uses the union.
    const paths = mapKeys(components, 'PATHS')
    const glyphs = mapKeys(design, 'glyphs')
    expect(paths.length).toBeGreaterThan(40)
    expect(new Set(paths).size).toBe(paths.length)
    expect(new Set(glyphs).size).toBe(glyphs.length)

    const known = new Set([...paths, ...glyphs])
    const unknown: string[] = []
    for (const file of walk(join(SRC, 'renderer/src'))) {
      const text = readFileSync(file, 'utf-8')
      for (const m of text.matchAll(/(?:chromeIcon|(?<!\.)icon)\(\s*'([^']+)'/g)) {
        if (!known.has(m[1])) unknown.push(`${m[1]} in ${file}`)
      }
    }
    expect(unknown).toEqual([])
  })

  test('settings sidebar renders one grid of stroked outlines at a uniform size', async () => {
    const fixture = makeFixture('icons')
    const app = await launch(fixture)
    const window = await firstWindow(app)
    // The custom elements render async after domcontentloaded; opening before
    // the app exists silently does nothing.
    await expect(window.locator('writemd-app')).toBeAttached({ timeout: 15000 })

    await openSettings(window)
    const modal = window.locator('writemd-settings-modal')
    await expect(modal).toBeVisible()
    const report = await modal.evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot
      const nav = root?.querySelector('.sidebar-nav')
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
        // The set is Hugeicons: 24 grid, stroked outlines through currentColor.
        if (svg.getAttribute('viewBox') !== '0 0 24 24') {
          bad.push(`${label}: viewBox ${svg.getAttribute('viewBox')}`)
        }
        if (svg.getAttribute('fill') !== 'none')
          bad.push(`${label}: fill ${svg.getAttribute('fill')}`)
        if (svg.getAttribute('stroke') !== 'currentColor')
          bad.push(`${label}: not stroked through currentColor`)
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
