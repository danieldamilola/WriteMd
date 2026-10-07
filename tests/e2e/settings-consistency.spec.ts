import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { makeFixture, launch, firstWindow, openSettings, chooseSettingsOption } from './fixtures'
import type { SettingsStore } from '../../src/renderer/src/state/settings'

const fixture = makeFixture('settings-consistency')
const categories = [
  'New notes',
  'Editor',
  'Files & vault',
  'Appearance',
  'Keyboard shortcuts',
  'AI Assistant',
  'Advanced',
  'About WriteMd'
]
const fonts = ['Inter', 'Manrope', 'DM Sans', 'Space Grotesk', 'JetBrains Mono', 'Geist Mono']

async function contrast(
  page: Page,
  selector: string,
  foreground: string,
  background: string,
  pseudo?: string
): Promise<number> {
  return page
    .locator(selector)
    .first()
    .evaluate(
      (element, { foreground, background, pseudo }) => {
        const context = document.createElement('canvas').getContext('2d')!
        const luminance = (color: string): number => {
          context.clearRect(0, 0, 1, 1)
          context.fillStyle = color
          context.fillRect(0, 0, 1, 1)
          const pixel = context.getImageData(0, 0, 1, 1).data
          const linear = [pixel[0], pixel[1], pixel[2]].map((value) => {
            const channel = value / 255
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
          })
          return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
        }
        const fg = luminance(getComputedStyle(element, pseudo).getPropertyValue(foreground))
        const surface =
          background === 'parent'
            ? getComputedStyle(element.closest('.section')!).backgroundColor
            : getComputedStyle(element).getPropertyValue(background)
        const bg = luminance(surface)
        return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)
      },
      { foreground, background, pseudo }
    )
}

async function prefs(page: Page, values: Record<string, unknown>): Promise<void> {
  await page.evaluate((values) => {
    const app = document.querySelector('writemd-app') as unknown as { settingsStore: SettingsStore }
    app.settingsStore.setMany(values)
  }, values)
}

test.describe('Settings consistency', () => {
  let app: ElectronApplication
  let page: Page
  test.beforeAll(async () => {
    app = await launch(fixture)
    page = await firstWindow(app)
  })
  test.afterAll(async () => {
    await app?.close()
  })

  for (const theme of ['dark', 'graphite', 'midnight', 'nord', 'dracula', 'light', 'paper']) {
    for (const width of [800, 1200]) {
      test(`${theme} settings fit all categories at ${width}px`, async () => {
        await app.evaluate(
          ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 650),
          width
        )
        await prefs(page, {
          'appearance.theme': theme,
          'appearance.accentColor': '#ffffff',
          'appearance.panelOrientation': 'vertical'
        })
        await openSettings(page)
        const modal = page.locator('writemd-settings-modal')
        try {
          for (const category of categories) {
            await modal.locator('.nav-btn', { hasText: category }).click()
            const overflow = await modal.evaluate((element) => {
              const root = element.shadowRoot!
              const content = root.querySelector<HTMLElement>('.content-panel')!
              const bad = Array.from(
                root.querySelectorAll<HTMLElement>(
                  '.section, .setting-row, .font-card, .control-group'
                )
              )
                .filter((element) => element.scrollWidth > element.clientWidth + 1)
                .map((element) => element.className)
              const background = root.querySelector('writemd-background-controls')?.shadowRoot
              if (background) {
                for (const element of background.querySelectorAll<HTMLElement>(
                  '.card, .row, .actions, .range'
                )) {
                  if (element.scrollWidth > element.clientWidth + 1)
                    bad.push(`background ${element.className}`)
                }
              }
              return { content: content.scrollWidth > content.clientWidth + 1, bad }
            })
            expect(overflow, category).toEqual({ content: false, bad: [] })
            await expect(modal.locator('select')).toHaveCount(0)
            if (category === 'Editor') {
              expect(
                await contrast(page, 'writemd-settings-modal .setting-desc', 'color', 'parent')
              ).toBeGreaterThanOrEqual(4.5)
              expect(
                await contrast(
                  page,
                  'writemd-settings-modal .toggle-switch[aria-checked="true"]',
                  'background-color',
                  'background-color',
                  '::after'
                )
              ).toBeGreaterThanOrEqual(3)
            }
            if (category === 'Appearance') {
              await expect(modal.locator('.beta-badge')).toHaveCount(0)
              if (['graphite', 'light'].includes(theme)) {
                await page.screenshot({
                  path: `artifacts/ui-review/refined-appearance-${theme}-${width}.png`
                })
              }
            }
            if (category === 'Keyboard shortcuts' && theme === 'graphite' && width === 800) {
              const notice = await modal.locator('.section').first().boundingBox()
              expect(notice!.height).toBeGreaterThan(40)
              await page.screenshot({ path: 'artifacts/ui-review/refined-shortcuts.png' })
            }
          }
        } finally {
          await page.keyboard.press('Escape')
        }
      })
    }
  }

  test('custom dropdown supports selection, keyboard input, Escape, and persistence', async () => {
    await openSettings(page)
    const modal = page.locator('writemd-settings-modal')
    await modal.locator('.nav-btn', { hasText: 'Advanced' }).click()
    await chooseSettingsOption(page, 'PDF page size', 'Letter')
    const size = modal.locator('wa-select[aria-label="PDF page size"]')
    await expect(size).toHaveJSProperty('value', 'Letter')
    for (const value of ['Legal', 'Letter']) {
      await size.click()
      await size.locator(`wa-option[value="${value}"]`).click()
      await expect(size).toHaveJSProperty('value', value)
    }
    await size.click()
    await expect(size.locator('[part="listbox"]')).toBeVisible()
    await page.screenshot({ path: 'artifacts/ui-review/refined-dropdown.png' })
    await page.keyboard.press('Escape')
    await expect(size).toHaveJSProperty('open', false)
    await expect(modal).toBeVisible()
    await size.locator('input[part="display-input"]').focus()
    await page.keyboard.press('Home')
    await page.keyboard.press('Home')
    await page.keyboard.press('Enter')
    await expect(size).toHaveJSProperty('value', 'A4')
    await page.keyboard.press('Escape')
    await openSettings(page)
    await expect(modal.locator('wa-select[aria-label="PDF page size"]')).toHaveJSProperty(
      'value',
      'A4'
    )
    await page.keyboard.press('Escape')
  })

  test('minimal fonts load locally and selection applies to the editor', async () => {
    await openSettings(page)
    const modal = page.locator('writemd-settings-modal')
    await modal.locator('.nav-btn', { hasText: 'Editor' }).click()
    await expect(modal.locator('.font-name')).toHaveText(fonts)
    for (const font of fonts) {
      const loaded = await page.evaluate(async (font) => {
        await document.fonts.load(`16px "${font}"`)
        return Array.from(document.fonts).some(
          (face) => face.family.replaceAll('"', '') === font && face.status === 'loaded'
        )
      }, font)
      expect(loaded, font).toBe(true)
    }
    await modal.locator('.font-card[aria-label="Manrope"]').click()
    await expect(modal.locator('.font-card[aria-label="Manrope"]')).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await page.screenshot({ path: 'artifacts/ui-review/refined-fonts.png' })
    await page.keyboard.press('Escape')
    await expect(page.locator('.cm-editor').first()).toHaveCSS('font-family', /Manrope/)
  })

  test('file path and floating mode control stay visible in both document layouts', async () => {
    await prefs(page, { 'appearance.theme': 'graphite', 'appearance.accentColor': '#ffffff' })
    for (const orientation of ['vertical', 'horizontal']) {
      await prefs(page, { 'appearance.panelOrientation': orientation })
      const path = page.locator('writemd-doc-bar .sub-header-left').first()
      await expect(path).toBeVisible()
      await expect(path).toContainText('README.md')
      await expect(path).toHaveAttribute('title', /README\.md$/)
      const pill = page.locator('writemd-info-pill').first()
      await expect(pill.locator('.counts')).toBeVisible()
      expect(
        await contrast(page, 'writemd-info-pill .pill', 'color', 'background-color')
      ).toBeGreaterThanOrEqual(4.5)
      await pill.locator('.mode-btn').click()
      await expect(pill.locator('writemd-mode-menu')).toBeVisible()
      await pill.locator('writemd-mode-menu .item', { hasText: 'Source mode' }).click()
      await expect(pill).toHaveJSProperty('mode', 'source')
      await page.screenshot({ path: `artifacts/ui-review/refined-workspace-${orientation}.png` })
    }
  })
})
