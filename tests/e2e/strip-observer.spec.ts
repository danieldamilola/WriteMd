import { test, expect } from '@playwright/test'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { firstWindow, launch, makeFixture } from './fixtures'

const FILES = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md', 'g.md', 'h.md', 'i.md', 'j.md']

/**
 * The tab strip was observed once and never again. Switching to vertical
 * orientation and back, or opening the welcome screen, renders a brand new
 * .tab-strip node; the observer stayed bound to the detached one, so window
 * resizes stopped updating the edge fades and stopped scrolling the active tab
 * into view. Invisible in a diff, only reproducible after the round trip.
 */
test.describe('Tab strip resize observation', () => {
  test('re-observes the strip after the node is replaced', async () => {
    const fixture = makeFixture('strip-observe', FILES)
    writeFileSync(
      join(fixture.userData, 'config.json'),
      JSON.stringify({
        files: {
          vaultPath: fixture.vault,
          recentFiles: FILES.map((f) => join(fixture.vault, f)),
          openTabs: FILES.map((f) => join(fixture.vault, f)),
          activeTabPath: join(fixture.vault, FILES[FILES.length - 1])
        },
        appearance: { theme: 'dark', panelOrientation: 'horizontal' }
      }),
      'utf-8'
    )
    const app = await launch(fixture)
    const window = await firstWindow(app)
    await expect(window.locator('writemd-top-bar')).toBeVisible({ timeout: 15000 })

    const strip = window.locator('.tab-strip')
    await expect(strip).toBeVisible()

    // Narrow the window so the strip overflows. That is the only state where
    // revealActiveTab and the edge fades do anything.
    await window.setViewportSize({ width: 560, height: 700 })
    await expect.poll(() => strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)

    const activeInView = (): Promise<boolean> =>
      strip.evaluate((el) => {
        const host = el.parentElement as HTMLElement
        const tab = el.querySelector('writemd-tab[active]')
        if (!tab) return false
        const t = tab.getBoundingClientRect()
        const box = host.getBoundingClientRect()
        return t.right <= box.right + 1 && t.left >= box.left - 1
      })

    // The reveal runs off a ResizeObserver callback, so it lands a frame after
    // the viewport change rather than synchronously with it.
    await expect.poll(activeInView, { timeout: 5000 }).toBe(true)

    // Tag the live node so identity survives the handle round trip. Comparing
    // element handles across a re-render is unreliable; a stamped attribute is
    // not, because nothing copies it onto a replacement.
    const stamp = await strip.evaluate((el) => {
      el.setAttribute('data-probe', 'first')
      return el.getAttribute('data-probe')
    })
    expect(stamp).toBe('first')

    // Which element the observer is currently bound to, read from the host's own
    // tracked state. This is the assertion that fails before the fix.
    const observedIsCurrent = (): Promise<boolean> =>
      window.evaluate(() => {
        const host = document.querySelector('writemd-app') as unknown as {
          observedStrip?: HTMLElement | null
          shadowRoot: ShadowRoot
        }
        const current = host.shadowRoot.querySelector('.tab-strip') as HTMLElement | null
        return current !== null && host.observedStrip === current
      })
    expect(await observedIsCurrent()).toBe(true)

    // The round trip that swaps the node: vertical, then back.
    const setOrientation = (value: string): Promise<void> =>
      window.evaluate((v) => {
        const host = document.querySelector('writemd-app') as unknown as {
          settingsStore: { set: (k: string, val: unknown) => void }
        }
        host.settingsStore.set('appearance.panelOrientation', v)
      }, value)

    await setOrientation('vertical')
    await expect(window.locator('writemd-vertical-tab-bar')).toBeVisible({ timeout: 5000 })
    await setOrientation('horizontal')
    await expect(strip).toBeVisible()
    await window.waitForTimeout(300)

    // A brand new node means the stamp is gone. If it survived, Lit reused the
    // element and this round trip proves nothing.
    expect(await strip.getAttribute('data-probe')).toBeNull()

    // The observer must follow the replacement. Before the fix this was false
    // and resize silently stopped working.
    expect(await observedIsCurrent()).toBe(true)

    // Behavioural confirmation: resizing must still scroll the active tab back
    // into view on the new node. 620px rather than something narrower, because
    // once the strip is squeezed under a tab's own width the active tab cannot
    // be fully in view no matter where it scrolls, which is not a regression.
    await window.setViewportSize({ width: 620, height: 700 })
    await expect.poll(() => strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    await expect.poll(activeInView, { timeout: 5000 }).toBe(true)

    await app.close()
  })
})
