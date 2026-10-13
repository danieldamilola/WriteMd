import { test, expect, type ElectronApplication } from '@playwright/test'
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { WriteMdSettings } from '../../src/shared/settings-schema'
import { makeFixture, launch, firstWindow, resizeWindow } from './fixtures'

// Explicit opt-in: ordinary test runs must never call a user's paid provider.
test.skip(process.env.WRITEMD_LIVE_AI_TEST !== '1', 'Requires an explicit live provider test')
test.setTimeout(240000)

test('live provider edits through the floating bar first and the side panel second', async () => {
  const appData = process.env.APPDATA
  if (!appData) throw new Error('This live check requires the Windows WriteMd profile')
  const profile = join(appData, 'writemd')
  const settings = JSON.parse(readFileSync(join(profile, 'config.json'), 'utf8')) as WriteMdSettings
  const fixture = makeFixture('ai-live-edit')
  const path = join(fixture.userData, 'External-note.md')
  const original = '# AI edit check\n\nStatus: ORIGINAL\n\nKeep this line unchanged.\n'
  const floating = original.replace('Status: ORIGINAL', 'Status: FLOATING_PASSED')
  const panel = floating.replace('Status: FLOATING_PASSED', 'Status: PANEL_PASSED')
  writeFileSync(path, original)
  const keyFile = join(fixture.userData, 'ai-key')
  const encryptionState = join(fixture.userData, 'Local State')
  if (existsSync(join(profile, 'Local State')))
    copyFileSync(join(profile, 'Local State'), encryptionState)
  if (existsSync(join(profile, 'ai-key'))) copyFileSync(join(profile, 'ai-key'), keyFile)
  writeFileSync(
    join(fixture.userData, 'config.json'),
    JSON.stringify({
      files: { vaultPath: fixture.vault, openTabs: [path], activeTabPath: path },
      appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical' },
      ai: { ...settings.ai, enabled: true, autoAcceptEdits: false }
    })
  )
  let app: ElectronApplication | undefined
  try {
    app = await launch(fixture)
    const page = await firstWindow(app)
    await resizeWindow(app, 1200, 800)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await test.step('1. Floating bar edits and saves the external file', async () => {
      await page.keyboard.press('Control+Alt+A')
      const quick = page.locator('writemd-ai-quick')
      await quick
        .locator('textarea')
        .fill(
          "Edit the current Markdown file. Replace exactly 'Status: ORIGINAL' with 'Status: FLOATING_PASSED'. Keep every other line unchanged. Do not search the web."
        )
      await quick.getByRole('button', { name: 'Send message' }).click()
      await expect
        .poll(
          async () => {
            const error = await quick
              .locator('.error')
              .textContent()
              .catch(() => '')
            if (error) throw new Error(error)
            return quick
              .locator('.suggestion .replacement')
              .textContent()
              .catch(() => '')
          },
          { timeout: 90000 }
        )
        .toContain('Status: FLOATING_PASSED')
      await expect(quick.getByRole('button', { name: 'Stop response' })).toHaveCount(0)
      expect(readFileSync(path, 'utf8')).toBe(original)
      await page.screenshot({ path: 'artifacts/ui-review/ai-live-floating-preview.png' })
      await quick.getByRole('button', { name: 'Accept' }).click()
      await expect.poll(() => readFileSync(path, 'utf8'), { timeout: 15000 }).toBe(floating)
      await expect(page.locator('writemd-editor .cm-content')).toContainText(
        'Status: FLOATING_PASSED'
      )
      await page.screenshot({ path: 'artifacts/ui-review/ai-live-floating-saved.png' })
      console.log('PASS: floating bar saved Status: FLOATING_PASSED at the original external path.')
    })

    await test.step('2. Side panel edits and saves the same external file', async () => {
      await page.keyboard.press('Control+j')
      const dock = page.locator('writemd-ai-dock')
      await expect(dock).toBeVisible()
      await dock
        .locator('textarea')
        .fill(
          "Edit the current Markdown file. Replace exactly 'Status: FLOATING_PASSED' with 'Status: PANEL_PASSED'. Keep every other line unchanged. Do not search the web."
        )
      await dock.locator('textarea').press('Enter')
      await expect.poll(() => readFileSync(path, 'utf8'), { timeout: 90000 }).toBe(panel)
      await expect(dock.getByRole('button', { name: `Undo the change to ${path}` })).toBeVisible()
      await expect(page.locator('writemd-editor .cm-content')).toContainText(
        'Status: PANEL_PASSED',
        { timeout: 15000 }
      )
      await page.screenshot({ path: 'artifacts/ui-review/ai-live-side-panel-saved.png' })
      console.log('PASS: side panel saved Status: PANEL_PASSED at the same external path.')
      expect(existsSync(join(fixture.vault, 'External-note.md'))).toBe(false)
    })
  } finally {
    try {
      await app?.close()
    } finally {
      rmSync(keyFile, { force: true })
      rmSync(encryptionState, { force: true })
    }
  }
})

test('live provider writes a Rust article into empty notes through both AI surfaces', async () => {
  const appData = process.env.APPDATA
  if (!appData) throw new Error('This live check requires the Windows WriteMd profile')
  const profile = join(appData, 'writemd')
  const settings = JSON.parse(readFileSync(join(profile, 'config.json'), 'utf8')) as WriteMdSettings
  const fixture = makeFixture('ai-live-article')
  const floatingPath = join(fixture.userData, 'Rust-floating.md')
  const panelPath = join(fixture.userData, 'Rust-panel.md')
  writeFileSync(floatingPath, '')
  writeFileSync(panelPath, '')
  const keyFile = join(fixture.userData, 'ai-key')
  const encryptionState = join(fixture.userData, 'Local State')
  if (existsSync(join(profile, 'Local State')))
    copyFileSync(join(profile, 'Local State'), encryptionState)
  if (existsSync(join(profile, 'ai-key'))) copyFileSync(join(profile, 'ai-key'), keyFile)
  writeFileSync(
    join(fixture.userData, 'config.json'),
    JSON.stringify({
      files: {
        vaultPath: fixture.vault,
        openTabs: [floatingPath, panelPath],
        activeTabPath: floatingPath
      },
      appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical' },
      ai: { ...settings.ai, enabled: true, autoAcceptEdits: false, maxOutputTokens: 0 }
    })
  )
  const prompt = 'please write an article on rust and please use the unslop skill.'
  let app: ElectronApplication | undefined
  try {
    app = await launch(fixture)
    const page = await firstWindow(app)
    await resizeWindow(app, 1200, 800)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await test.step('1. Floating bar drafts an article into an empty file', async () => {
      await page.keyboard.press('Control+Alt+A')
      const quick = page.locator('writemd-ai-quick')
      await quick.locator('textarea').fill(prompt)
      await quick.getByRole('button', { name: 'Send message' }).click()
      await expect
        .poll(
          async () => {
            const error = await quick
              .locator('.error')
              .textContent()
              .catch(() => '')
            if (error) throw new Error(error)
            return quick
              .locator('.suggestion .replacement')
              .textContent()
              .catch(() => '')
          },
          { timeout: 120000 }
        )
        .toMatch(/rust/i)
      await expect(quick.getByRole('button', { name: 'Stop response' })).toHaveCount(0)
      expect(readFileSync(floatingPath, 'utf8')).toBe('')
      await page.screenshot({ path: 'artifacts/ui-review/ai-live-rust-floating-preview.png' })
      await quick.getByRole('button', { name: 'Accept' }).click()
      await expect
        .poll(() => readFileSync(floatingPath, 'utf8').length, { timeout: 15000 })
        .toBeGreaterThan(300)
      expect(readFileSync(floatingPath, 'utf8')).toMatch(/rust/i)
      await expect(page.locator('writemd-editor .cm-content')).toContainText(/rust/i)
      await page.screenshot({ path: 'artifacts/ui-review/ai-live-rust-floating-saved.png' })
      console.log(
        'PASS: floating bar offered and saved a Rust article in the previously empty file.'
      )
    })
    await test.step('2. Side panel writes an article into a second empty file', async () => {
      await page.getByRole('tab', { name: /Rust-panel.md/ }).click()
      await page.keyboard.press('Control+j')
      const dock = page.locator('writemd-ai-dock')
      await expect(dock).toBeVisible()
      await dock.locator('textarea').fill(prompt)
      await dock.locator('textarea').press('Enter')
      await expect
        .poll(
          async () => {
            const error = await dock
              .locator('.error')
              .textContent()
              .catch(() => '')
            if (error) throw new Error(error)
            return readFileSync(panelPath, 'utf8').length
          },
          { timeout: 120000 }
        )
        .toBeGreaterThan(300)
      expect(readFileSync(panelPath, 'utf8')).toMatch(/rust/i)
      await expect(page.locator('writemd-editor .cm-content')).toContainText(/rust/i)
      await page.screenshot({ path: 'artifacts/ui-review/ai-live-rust-side-panel-saved.png' })
      console.log('PASS: side panel wrote and saved a Rust article in a second empty file.')
    })
  } finally {
    try {
      await app?.close()
    } finally {
      rmSync(keyFile, { force: true })
      rmSync(encryptionState, { force: true })
    }
  }
})
