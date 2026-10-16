import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow, resizeWindow } from './fixtures'

/**
 * The appearance settings, checked against what they actually change.
 *
 * Every assertion here is about whether the control the user is holding did
 * something. A setting that saves and does nothing is worse than one that is
 * missing, because from the outside they look identical.
 */

test.setTimeout(180000)

async function setMany(page: Page, values: Record<string, unknown>): Promise<void> {
  await page.evaluate((values) => {
    ;(
      document.querySelector('writemd-app') as unknown as {
        settingsStore: { setMany(values: Record<string, unknown>): void }
      }
    ).settingsStore.setMany(values)
  }, values)
  // The store notifies, the DOM repaints. Give the frame before anyone reads
  // a computed style or captures a screenshot.
  await page.waitForTimeout(150)
}

/**
 * Something with real luminance spread to look through the surface.
 *
 * Transparency only reads when there is something behind it. Over a bare window
 * every opacity composites onto the same black, so a screenshot comparison at
 * 50 and 100 comes out identical and tells you nothing about which is right.
 */
async function installBackground(
  app: ElectronApplication,
  page: Page,
  vault: string
): Promise<void> {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 800
    const context = canvas.getContext('2d')!
    const gradient = context.createLinearGradient(0, 0, 1200, 800)
    gradient.addColorStop(0, '#dfe7ef')
    gradient.addColorStop(0.45, '#7d93ad')
    gradient.addColorStop(1, '#20262e')
    context.fillStyle = gradient
    context.fillRect(0, 0, 1200, 800)
    context.fillStyle = '#e8b04b'
    context.beginPath()
    context.arc(300, 220, 150, 0, Math.PI * 2)
    context.fill()
    return canvas.toDataURL('image/png').split(',')[1]
  })
  const source = join(vault, 'surface-art.png')
  writeFileSync(source, Buffer.from(encoded, 'base64'))
  await app.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
  }, source)
  const id = await page.evaluate(async () => {
    const asset = await window.electronAPI!.appearance.importBackground()
    return asset!.id
  })
  await setMany(page, {
    'appearance.backgroundId': id,
    'appearance.backgroundShowOn': 'all',
    'appearance.backgroundContentOpacity': 100,
    'appearance.backgroundEmptyOpacity': 100
  })
}

async function open(
  name: string,
  settings: Record<string, unknown>
): Promise<{ app: ElectronApplication; page: Page; vault: string }> {
  const fixture = makeFixture(name)
  writeFileSync(
    join(fixture.userData, 'config.json'),
    JSON.stringify({
      files: {
        vaultPath: fixture.vault,
        recentFiles: [],
        openTabs: [join(fixture.vault, 'README.md')],
        activeTabPath: join(fixture.vault, 'README.md')
      },
      appearance: {
        designVersion: 1,
        theme: 'graphite',
        panelOrientation: 'vertical',
        surfaceOpacity: 100,
        windowMaterial: 'none',
        ...settings
      }
    }),
    'utf-8'
  )
  const app = await launch(fixture)
  const page = await firstWindow(app)
  await resizeWindow(app, 1280, 860)
  await expect(page.locator('writemd-editor')).toBeVisible()
  return { app, page, vault: fixture.vault }
}

/** Chromium resolves a surface colour to `color(srgb ...)`; alpha only shows up painted. */
async function alpha(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const context = document.createElement('canvas').getContext('2d')!
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = getComputedStyle(element).backgroundColor
    context.fillRect(0, 0, 1, 1)
    return context.getImageData(0, 0, 1, 1).data[3] / 255
  })
}

async function showAppearance(page: Page): Promise<Locator> {
  await page.keyboard.press('Control+,')
  const modal = page.locator('writemd-settings-modal')
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: 'Appearance', exact: true }).click()
  return modal
}

test('the settings page follows the surface opacity the user sets', async () => {
  const { app, page, vault } = await open('appearance-settings-opacity', {})
  try {
    await installBackground(app, page, vault)
    const modal = await showAppearance(page)
    const settingsPane = modal.locator('.main-area')
    expect(await alpha(modal.locator('.modal-dialog'))).toBe(0)
    await expect(page.locator('writemd-app .main-area[slot="content"]')).toBeHidden()
    const settingsNav = modal.locator('.sidebar')
    const section = modal.locator('.section').first()

    // The default is solid, and has to stay solid. If this drifts, every
    // screenshot below stops meaning anything.
    expect(await alpha(settingsPane)).toBeCloseTo(1, 2)

    await setMany(page, { 'appearance.surfaceOpacity': 55 })

    // The content pane goes translucent because it now paints the same token
    // the document panes do, instead of a solid colour of its own.
    expect(await alpha(settingsPane)).toBeLessThan(0.95)
    // The blur that comes with reduced opacity switches on, rather than the
    // page inventing a look of its own.
    expect(await settingsPane.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe(
      'blur(8px)'
    )
    // The nav rail follows the material rather than the opacity. It is chrome,
    // and chrome stays solid until a material is chosen to tint it - the same
    // rule as the app's own rail, which is the whole point of the pairing.
    expect(await alpha(settingsNav)).toBeCloseTo(1, 2)
    // Cards hold their elevation, so they read as objects sitting on the pane
    // rather than dissolving along with it.
    expect(await alpha(section)).toBeCloseTo(1, 2)

    /*
     * The check that actually matters.
     *
     * Every assertion above passed while the page still looked opaque: the
     * pane was genuinely translucent, it just had a solid layer behind it to
     * reveal. Alpha proves the token applied, not that the user sees through.
     * So sample the rendered window instead, across the pane's width where the
     * background gradient runs light to dark, and require the pixels to differ.
     */
    await setMany(page, { 'appearance.surfaceOpacity': 50 })
    const box = (await modal.locator('.content-panel').boundingBox())!
    const shot = await page.screenshot({ scale: 'css' })
    // Sample across the content area, just below the title bar and above the
    // first card: bare pane, where the only thing that can vary the pixels is
    // the background showing through. Not the dialog box, which in embedded
    // mode starts at y=0 and would put the sample on the opaque chrome.
    const points = {
      data: shot.toString('base64'),
      y: Math.round(box.y + 8),
      left: Math.round(box.x + box.width * 0.15),
      right: Math.round(box.x + box.width * 0.95)
    }
    const seen = await app.evaluate(({ nativeImage }, points) => {
      const image = nativeImage.createFromBuffer(Buffer.from(points.data, 'base64'))
      const { width } = image.getSize()
      const pixels = image.toBitmap()
      const at = (x: number): number => {
        const offset = (points.y * width + x) * 4
        return pixels[offset] + pixels[offset + 1] + pixels[offset + 2]
      }
      return { left: at(points.left), right: at(points.right) }
    }, points)
    // Flat means something opaque is still in the way, whatever the tokens say.
    expect(Math.abs(seen.left - seen.right)).toBeGreaterThan(60)

    // The numbers are a means to an end. Capture what each one looks like with
    // something actually behind it, so a look can be picked instead of guessed.
    for (const value of [100, 70, 50]) {
      await setMany(page, { 'appearance.surfaceOpacity': value })
      await page.screenshot({ path: `artifacts/ui-review/settings-opacity-${value}.png` })
    }
  } finally {
    await app.close()
  }
})

test('window material is offered when the system supports it and reports why not otherwise', async () => {
  const { app, page, vault } = await open('appearance-material', { windowMaterial: 'mica' })
  try {
    await installBackground(app, page, vault)
    const modal = await showAppearance(page)
    // The combobox, not the wrapper: wa-select labels its host, its inner input
    // and its listbox alike, so a label query alone matches three of them.
    await expect(modal.getByRole('combobox', { name: 'Window material' })).toBeVisible()
    // Mica on, opacity down: the combination a user actually reaches for.
    await setMany(page, { 'appearance.surfaceOpacity': 60 })
    const support = await page.evaluate(() => window.electronAPI!.appearance.materialSupport())
    await expect(page.locator('html')).toHaveAttribute(
      'data-window-material',
      support.supported ? 'mica' : 'none'
    )
    await page.screenshot({ path: 'artifacts/ui-review/settings-material.png' })
  } finally {
    await app.close()
  }
})

test('Settings uses one material layer, follows every theme, and preserves the editor', async () => {
  const { app, page, vault } = await open('settings-theme-materials', { surfaceOpacity: 55 })
  try {
    await setMany(page, { 'editor.autoSave': false })
    await page.locator('writemd-editor').evaluate((element) => {
      const editor = element as unknown as {
        editorView: { state: { doc: { length: number } }; dispatch: (spec: unknown) => void }
      }
      editor.editorView.dispatch({
        changes: {
          from: editor.editorView.state.doc.length,
          insert: '\nUnsaved note stays intact.'
        }
      })
      ;(globalThis as typeof globalThis & { settingsTestEditor?: unknown }).settingsTestEditor =
        editor.editorView
    })
    await installBackground(app, page, vault)
    const modal = await showAppearance(page)
    const support = await page.evaluate(() => window.electronAPI!.appearance.materialSupport())
    for (const material of ['none', 'mica', 'acrylic']) {
      for (const theme of ['dark', 'graphite', 'midnight', 'nord', 'dracula', 'light', 'paper']) {
        await setMany(page, { 'appearance.windowMaterial': material, 'appearance.theme': theme })
        await page.evaluate(async () => {
          const host = document.querySelector('writemd-app') as unknown as {
            settingsStore: { whenSaved: () => Promise<boolean> }
          }
          if (!(await host.settingsStore.whenSaved())) throw new Error('Appearance did not save')
        })
        const scheme = ['light', 'paper'].includes(theme) ? 'light' : 'dark'
        expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe(scheme)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(page.locator('html')).toHaveAttribute(
          'data-window-material',
          support.supported ? material : 'none'
        )
        expect(await alpha(page.locator('writemd-app'))).toBe(0)
        expect(await alpha(modal.locator('.modal-dialog'))).toBe(0)
        expect(await alpha(modal.locator('.main-area'))).toBeCloseTo(0.55, 2)
        const titleBar = await page.locator('writemd-top-bar').boundingBox()
        const contentSurface = await modal.locator('.main-area').boundingBox()
        expect(titleBar!.y + titleBar!.height).toBeLessThanOrEqual(contentSurface!.y)
        expect(await alpha(modal.locator('.sidebar'))).toBeCloseTo(
          support.supported && material !== 'none' ? 0.55 : 1,
          2
        )
        await expect(page.locator('writemd-app .main-area[slot="content"]')).toBeHidden()
        await expect(page.locator('writemd-rail-frame')).toBeHidden()
        await modal.getByRole('button', { name: 'Editor', exact: true }).click()
        const contrast = await modal
          .locator('.setting-desc')
          .first()
          .evaluate((element) => {
            const context = document.createElement('canvas').getContext('2d')!
            const luminance = (color: string): number => {
              context.fillStyle = color
              context.fillRect(0, 0, 1, 1)
              const data = context.getImageData(0, 0, 1, 1).data
              const channels = [data[0], data[1], data[2]].map((value) => {
                const c = value / 255
                return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
              })
              return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
            }
            const fg = luminance(getComputedStyle(element).color)
            const bg = luminance(getComputedStyle(element.closest('.section')!).backgroundColor)
            return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)
          })
        expect(contrast).toBeGreaterThanOrEqual(4.5)
        if (material === 'mica' || ['graphite', 'paper'].includes(theme)) {
          await page.screenshot({ path: `artifacts/ui-review/settings-${theme}-${material}.png` })
        }
      }
    }
    await modal.getByRole('button', { name: 'Back to editor' }).click()
    await expect(page.locator('writemd-app .main-area[slot="content"]')).toBeVisible()
    await expect(page.locator('writemd-editor .cm-content')).toContainText(
      'Unsaved note stays intact.'
    )
    expect(
      await page
        .locator('writemd-editor')
        .evaluate(
          (element) =>
            (element as unknown as { editorView: unknown }).editorView ===
            (globalThis as typeof globalThis & { settingsTestEditor?: unknown }).settingsTestEditor
        )
    ).toBe(true)
  } finally {
    await app.close()
  }
})
