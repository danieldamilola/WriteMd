import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const VAULT = join(process.cwd(), '.e2e-vault')
const USER_DATA = join(process.cwd(), '.e2e-userdata')

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
    mkdirSync(VAULT, { recursive: true })
    mkdirSync(USER_DATA, { recursive: true })
    for (const name of FILES) {
      writeFileSync(join(VAULT, name), `# ${name}\n\nTab overflow fixture.\n`, 'utf-8')
    }
    writeFileSync(
      join(USER_DATA, 'config.json'),
      JSON.stringify({
        files: {
          vaultPath: VAULT,
          openTabs: FILES.map((n) => join(VAULT, n)),
          activeTabPath: join(VAULT, FILES[FILES.length - 1]),
          recentFiles: FILES.map((n) => join(VAULT, n))
        },
        appearance: { theme: 'dark', panelOrientation: 'horizontal' }
      }),
      'utf-8'
    )

    app = await electron.launch({
      args: [`--user-data-dir=${USER_DATA}`, '.'],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
    })
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('strip scrolls instead of clipping, and keeps the active tab visible', async () => {
    const window = await app?.firstWindow()
    if (!window) throw new Error('No app window opened')
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
    await expect(window.locator('.tab-add')).toBeVisible()

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
