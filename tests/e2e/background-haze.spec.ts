import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow, openSettings } from './fixtures'
import type { SettingsStore } from '../../src/renderer/src/state/settings'
import type { FileState } from '../../src/renderer/src/state/file-state'

type Host = HTMLElement & { settingsStore: SettingsStore; fileState: FileState }

async function appearance(page: Page, values: Record<string, unknown>): Promise<void> {
  await page.evaluate((values) => {
    ;(document.querySelector('writemd-app') as unknown as Host).settingsStore.setMany(values)
  }, values)
}

async function samples(app: ElectronApplication, artwork: Locator): Promise<number[][]> {
  const bitmap = (await artwork.screenshot({ scale: 'css' })).toString('base64')
  return app.evaluate(({ nativeImage }, bitmap) => {
    const image = nativeImage.createFromBuffer(Buffer.from(bitmap, 'base64'))
    const { width, height } = image.getSize()
    const pixels = image.toBitmap()
    // The left stripes test sharpness; the white right half tests the fade.
    return [
      [0.1, 0.1],
      [0.12, 0.1],
      [0.8, 0.1],
      [0.8, 0.8],
      [0.8, 0.94]
    ].map(([x, y]) => {
      const offset = (Math.floor(y * height) * width + Math.floor(x * width)) * 4
      return [...pixels.subarray(offset, offset + 3)]
    })
  }, bitmap)
}

test.describe('Haze backgrounds', () => {
  let app: ElectronApplication
  let page: Page
  let fixture: ReturnType<typeof makeFixture>

  test.beforeEach(async () => {
    fixture = makeFixture('background-haze', ['README.md'])
    writeFileSync(join(fixture.vault, 'README.md'), '')
    app = await launch(fixture)
    page = await firstWindow(app)
    await expect(page.locator('writemd-editor')).toBeVisible()
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 1000
      canvas.height = 1000
      const context = canvas.getContext('2d')!
      context.fillStyle = 'white'
      context.fillRect(0, 0, 1000, 1000)
      context.fillStyle = 'black'
      for (let x = 0; x < 500; x += 20) context.fillRect(x, 0, 10, 1000)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    const source = join(fixture.vault, 'haze-stripes.png')
    writeFileSync(source, Buffer.from(image, 'base64'))
    await app.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
    }, source)
    await page.evaluate(async () => {
      const asset = await window.electronAPI!.appearance.importBackground()
      ;(document.querySelector('writemd-app') as unknown as Host).settingsStore.setMany({
        'appearance.backgroundId': asset!.id,
        'appearance.backgroundEffect': 'haze',
        'appearance.backgroundBlur': 12,
        'appearance.backgroundEmptyOpacity': 100,
        'appearance.backgroundContentOpacity': 100,
        'appearance.panelOrientation': 'vertical',
        'appearance.motion': 'reduced'
      })
    })
    await expect(page.locator('writemd-panel[slot="primary"] .haze')).toBeVisible()
  })

  test.afterEach(async () => {
    await app?.close()
  })

  test('preserves sharp artwork above progressive blur and fades content sooner', async () => {
    const background = page.locator('writemd-panel[slot="primary"] writemd-background')
    const haze = background.locator('.haze')
    await expect(background.locator('img')).toHaveCSS('filter', 'none')
    await expect(background.locator('img')).toHaveCSS('transform', 'none')
    await expect(background.locator('.haze-soft')).toHaveCSS('filter', 'blur(7px)')
    await expect(background.locator('.haze-strong')).toHaveCSS('filter', 'blur(18px)')
    const texture = await haze.evaluate(
      (element) => getComputedStyle(element, '::after').backgroundImage
    )
    expect(texture).toContain('repeating-linear-gradient')
    const imageSources = await background.evaluate((element) => {
      const root = element.shadowRoot!
      const image = root.querySelector('img')!
      return Array.from(root.querySelectorAll('span')).map((layer) =>
        getComputedStyle(layer).backgroundImage.includes(image.src)
      )
    })
    expect(imageSources).toEqual([true, true])

    // Compare the rendered top to None at the same coordinates. A uniform
    // blur or enlarged base image changes these stripes even above the fade.
    const empty = await samples(app, background)
    await appearance(page, { 'appearance.backgroundEffect': 'none' })
    const plain = await samples(app, background)
    for (const index of [0, 1]) {
      expect(Math.abs(empty[index][0] - plain[index][0])).toBeLessThan(95)
    }
    expect(empty[2][0] - empty[4][0]).toBeGreaterThan(100)
    expect(empty[3][0] - empty[4][0]).toBeGreaterThan(1)
    await appearance(page, { 'appearance.backgroundEffect': 'haze' })
    await page.screenshot({ path: 'artifacts/ui-review/haze-empty.png' })

    await page.evaluate(() => {
      ;(document.querySelector('writemd-app') as unknown as Host).fileState.setContent(
        'Haze content fixture'
      )
    })
    await expect(haze).toHaveClass(/content/)
    await expect(background.locator('.haze-soft')).toHaveCSS('filter', 'blur(5px)')
    await expect(background.locator('.haze-strong')).toHaveCSS('filter', 'blur(12px)')
    const content = await samples(app, background)
    // Chromium can dither the theme surface by one channel value.
    for (let channel = 0; channel < 3; channel += 1) {
      expect(Math.abs(content[3][channel] - content[4][channel])).toBeLessThanOrEqual(1)
    }
    await page.screenshot({ path: 'artifacts/ui-review/haze-content.png' })

    await appearance(page, { 'appearance.backgroundBlur': 0 })
    await expect(background.locator('.haze-soft')).toHaveCSS('filter', 'blur(0px)')
    await expect(background.locator('.haze-strong')).toHaveCSS('filter', 'blur(0px)')
    await appearance(page, { 'appearance.backgroundShowOn': 'empty' })
    await expect(haze).toHaveCSS('opacity', '0')
  })

  test('scales preview blur, follows visibility, and uses the current theme surface', async () => {
    await appearance(page, {
      'appearance.backgroundEmptyOpacity': 31,
      'appearance.backgroundContentOpacity': 19
    })
    await openSettings(page)
    await page.locator('writemd-settings-modal .nav-btn', { hasText: 'Appearance' }).click()
    const controls = page.locator('writemd-background-controls')
    const preview = controls.locator('writemd-background')
    const haze = preview.locator('.haze')
    await expect(preview.locator('.haze-soft')).toHaveCSS('filter', 'blur(2px)')
    await expect(preview.locator('.haze-strong')).toHaveCSS('filter', 'blur(5px)')
    await expect(haze).toHaveCSS('opacity', '0.31')
    await expect(haze).toHaveCSS('transition-duration', '0s')
    await controls.getByRole('button', { name: 'Preview content', exact: true }).click()
    await expect(haze).toHaveClass(/content/)
    await expect(haze).toHaveCSS('opacity', '0.19')
    await controls.getByRole('button', { name: 'Empty only', exact: true }).click()
    await expect(haze).toHaveCSS('opacity', '0')
    await controls.getByRole('button', { name: 'Preview empty view', exact: true }).click()
    await expect(haze).toHaveCSS('opacity', '0.31')
    await page.screenshot({ path: 'artifacts/ui-review/haze-settings-dark.png' })

    const darkOverlay = await haze.evaluate(
      (element) => getComputedStyle(element, '::after').backgroundImage
    )
    await appearance(page, { 'appearance.theme': 'light' })
    const lightOverlay = await haze.evaluate(
      (element) => getComputedStyle(element, '::after').backgroundImage
    )
    expect(lightOverlay).not.toEqual(darkOverlay)
    await page.screenshot({ path: 'artifacts/ui-review/haze-settings-light.png' })
  })
})
