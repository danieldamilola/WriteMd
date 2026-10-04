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
    await page.waitForTimeout(50)
    // pane-in and surface-in, among others.
    expect(await runningAnimations(page)).toBeGreaterThan(0)
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