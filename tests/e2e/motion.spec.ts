import { test, expect, type Page } from '@playwright/test'
import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'

/**
 * Windows reports SPI_GETCLIENTAREAANIMATION = 0 when "Animation effects" is
 * off, Chromium turns that into prefers-reduced-motion: reduce, and every
 * animation in WriteMd switched itself off. Correct behaviour, and also the
 * reason nothing in the app moved on this machine. The setting makes the
 * decision explicit, so these tests pin what actually animates rather than the
 * fact that something once did not.
 */

async function writeConfig(vault: string, motion: string): Promise<string> {
  const path = join(vault, '..', 'userdata', 'config.json')
  writeFileSync(
    path,
    JSON.stringify(
      {
        files: {
          vaultPath: vault,
          recentFiles: [join(vault, 'README.md')],
          openTabs: [join(vault, 'README.md')],
          activeTabPath: join(vault, 'README.md')
        },
        appearance: { theme: 'dark', panelOrientation: 'horizontal', motion }
      },
      null,
      2
    ),
    'utf-8'
  )
  return path
}

async function motionAttribute(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.dataset.motion ?? '')
}

/**
 * Keyframe animations only, which is what the setting governs: hover colour
 * transitions on buttons have never been tied to the reduced-motion setting and
 * are not what "motion" means here.
 */
async function runningAnimations(page: Page): Promise<number> {
  return page.evaluate(() => {
    const deep: Element[] = []
    const walk = (root: Document | ShadowRoot): void => {
      root.querySelectorAll('*').forEach((el) => {
        deep.push(el)
        if (el.shadowRoot) walk(el.shadowRoot)
      })
    }
    walk(document)
    let running = 0
    for (const el of deep) {
      for (const anim of el.getAnimations()) {
        const name = (anim as unknown as { animationName?: string }).animationName
        if (anim.playState === 'running' && name && name !== 'none') running++
      }
    }
    return running
  })
}

test.describe('Motion preference', () => {
  test('reduced holds everything still', async () => {
    const fixture = makeFixture('motion-reduced')
    await writeConfig(fixture.vault, 'reduced')
    const app = await launch(fixture)
    const page = await firstWindow(app)
    await expect(page.locator('writemd-top-bar')).toBeVisible()
    await page.waitForTimeout(1200)
    expect(await motionAttribute(page)).toBe('reduced')
    await page.locator('writemd-icon-button[title="Split view"]').click()
    await page.waitForTimeout(50)
    expect(await runningAnimations(page)).toBe(0)
    await app.close()
  })

  test('full animates the split pane even when the OS asked for none', async () => {
    const fixture = makeFixture('motion-full')
    await writeConfig(fixture.vault, 'full')
    const app = await launch(fixture)
    const page = await firstWindow(app)
    await expect(page.locator('writemd-top-bar')).toBeVisible()
    await page.waitForTimeout(1200)
    expect(await motionAttribute(page)).toBe('full')
    await page.locator('writemd-icon-button[title="Split view"]').click()
    // Polled rather than sampled once after a fixed sleep. What is under test is
    // that opening the split animates at all; a 50ms wait races the animation's
    // own duration, and on a loaded runner the round trip can land after the
    // pane has finished easing in.
    await expect.poll(() => runningAnimations(page), { timeout: 5000 }).toBeGreaterThan(0)
    await app.close()
  })

  test('system mirrors whatever the OS asks for', async () => {
    const fixture = makeFixture('motion-system')
    await writeConfig(fixture.vault, 'system')
    const app = await launch(fixture)
    const page = await firstWindow(app)
    await expect(page.locator('writemd-top-bar')).toBeVisible()
    await page.waitForTimeout(1200)
    const osWantsLess = await page.evaluate(
      () => matchMedia('(prefers-reduced-motion: reduce)').matches
    )
    expect(await motionAttribute(page)).toBe(osWantsLess ? 'reduced' : 'full')
    await app.close()
  })

  test('opening the split settles the left pane instead of bouncing it', async () => {
    const fixture = makeFixture('motion-split-settle')
    await writeConfig(fixture.vault, 'full')
    const app = await launch(fixture)
    const page = await firstWindow(app)
    await expect(page.locator('writemd-top-bar')).toBeVisible()
    await page.waitForTimeout(1200)

    // Sample the pane width frame by frame from inside the page, so no
    // round-trip latency can hide a jump between two samples.
    const samples = await page.evaluate(async () => {
      const app = document.querySelector('writemd-app')
      const topBar = app?.shadowRoot?.querySelector('writemd-top-bar')
      const button = topBar?.shadowRoot?.querySelector<HTMLElement>(
        'writemd-icon-button[title="Split view"]'
      )
      const editor = app?.shadowRoot?.querySelector('writemd-editor')
      const root = editor?.shadowRoot
      if (!root || !button) return null
      const left = root.querySelectorAll<HTMLElement>('writemd-panel.pane')[0]
      const container = left.parentElement as HTMLElement
      const before = left.getBoundingClientRect().width
      const containerWidth = container.getBoundingClientRect().width
      button.click()
      const widths: number[] = []
      // What is driving the width, as opposed to how wide it is. A script
      // animation on flexBasis is what made this bounce.
      const drivers = new Set<string>()
      const started = performance.now()
      while (performance.now() - started < 320) {
        widths.push(left.getBoundingClientRect().width)
        for (const anim of left.getAnimations()) {
          const frames = (anim.effect as KeyframeEffect | null)?.getKeyframes() ?? []
          for (const frame of frames) {
            for (const key of Object.keys(frame)) {
              if (key !== 'offset' && key !== 'computedOffset' && key !== 'easing') {
                drivers.add(`${(anim.constructor as { name?: string }).name ?? 'Animation'}:${key}`)
              }
            }
          }
        }
        await new Promise((r) => requestAnimationFrame(r))
      }
      return {
        before,
        widths,
        containerWidth,
        drivers: [...drivers],
        settled: left.getBoundingClientRect().width
      }
    })

    expect(samples).not.toBeNull()
    const { before, widths, containerWidth, drivers } = samples!

    // It started full width and ended at its share.
    expect(before - samples!.settled).toBeGreaterThan(20)
    // It only ever came down. The bounce was the pane snapping to its share,
    // jumping back out to the full width, then easing in again.
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThanOrEqual(widths[i - 1] + 1)
    }
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(samples!.settled - 2)
    expect(Math.max(...widths)).toBeLessThanOrEqual(containerWidth + 1)
    // The width moves only through the CSS transition. A script animation on
    // flexBasis at the same time is what produced the bounce: the pane snapped
    // to its share, jumped back out to the full width, then eased in again.
    for (const driver of drivers.filter((d) => d.includes('flex'))) {
      expect(driver).toMatch(/^CSSTransition:/)
    }
    expect(drivers.filter((d) => d.startsWith('Animation:'))).toEqual([])
    await app.close()
  })

  test('closing the split fades the pane out before the space is claimed', async () => {
    const fixture = makeFixture('motion-split-exit')
    await writeConfig(fixture.vault, 'full')
    const app = await launch(fixture)
    const page = await firstWindow(app)
    await expect(page.locator('writemd-top-bar')).toBeVisible()
    await page.waitForTimeout(1200)
    await page.locator('writemd-icon-button[title="Split view"]').click()
    await page.locator('writemd-surface-launcher .row', { hasText: 'Files' }).click()
    await page.locator('writemd-vault-explorer').locator('.node-row', { hasText: 'PRD.md' }).click()
    await expect(page.locator('.cm-content')).toHaveCount(2, { timeout: 5000 })
    await page.waitForTimeout(400)

    const trace = await page.evaluate(async () => {
      const app_ = document.querySelector('writemd-app')?.shadowRoot
      const topBar = app_?.querySelector('writemd-top-bar')?.shadowRoot
      const button = topBar?.querySelector<HTMLElement>('writemd-icon-button[title="Split view"]')
      const editor = app_?.querySelector('writemd-editor')?.shadowRoot
      if (!button || !editor) return null
      const pane = (): HTMLElement | null =>
        editor.querySelector('writemd-panel.pane-in') as HTMLElement | null
      const left = (): HTMLElement => editor.querySelectorAll<HTMLElement>('writemd-panel.pane')[0]
      const samples: Array<{ opacity: number | null; leftWidth: number }> = []
      button.click()
      const started = performance.now()
      while (performance.now() - started < 500) {
        const live = pane()
        samples.push({
          opacity: live ? Number(getComputedStyle(live).opacity) : null,
          leftWidth: left().getBoundingClientRect().width
        })
        await new Promise((r) => requestAnimationFrame(r))
      }
      return { samples, container: left().parentElement?.getBoundingClientRect().width ?? 0 }
    })

    expect(trace).not.toBeNull()
    const { samples, container } = trace!
    const opacities = samples.map((s) => s.opacity)
    // It was on screen at full opacity, then faded, then it was gone.
    expect(opacities[0]).toBe(1)
    expect(opacities).toContain(null)
    const partial = opacities.filter((o): o is number => o !== null && o > 0 && o < 1)
    expect(partial.length).toBeGreaterThan(1)
    // While it faded, the left pane had not yet claimed the space.
    const firstGone = opacities.findIndex((o) => o === null)
    expect(firstGone).toBeGreaterThan(0)
    for (const sample of samples.slice(0, firstGone)) {
      expect(sample.leftWidth).toBeLessThan(container - 10)
    }
    // And it ended up full width.
    expect(samples[samples.length - 1].leftWidth).toBeGreaterThan(container - 10)
    await app.close()
  })

  test('changing it in the modal re-decides without a restart, and persists', async () => {
    const fixture = makeFixture('motion-change')
    const configPath = await writeConfig(fixture.vault, 'reduced')
    const app = await launch(fixture)
    const page = await firstWindow(app)
    await expect(page.locator('writemd-top-bar')).toBeVisible()
    await page.waitForTimeout(1200)
    expect(await motionAttribute(page)).toBe('reduced')

    await page.locator('writemd-icon-button[title="Settings"]').click()
    const modal = page.locator('writemd-settings-modal')
    await expect(modal).toBeVisible()
    await modal.locator('.nav-btn', { hasText: 'Appearance' }).click()
    const select = modal.locator('select[aria-label="Animation"]')
    await expect(select).toHaveValue('reduced')
    await select.selectOption('full')

    expect(await motionAttribute(page)).toBe('full')
    const stored = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      appearance: { motion: string }
    }
    expect(stored.appearance.motion).toBe('full')

    // And the app really is moving now: close the modal, split, count.
    await modal.locator('.back-btn').click()
    await expect(modal).toHaveCount(0)
    await page.locator('writemd-icon-button[title="Split view"]').click()
    await page.waitForTimeout(50)
    expect(await runningAnimations(page)).toBeGreaterThan(0)
    await app.close()
  })
})
