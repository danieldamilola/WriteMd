import { test, expect } from '@playwright/test'
import { createServer, type ServerResponse } from 'http'
import { join } from 'path'
import { writeFileSync } from 'fs'
import type { SettingsStore } from '../../src/renderer/src/state/settings'
import { makeFixture, launch, firstWindow, resizeWindow } from './fixtures'

test.setTimeout(120000)

test('supplied AI activity artwork animates only during a request and follows motion preferences', async () => {
  let response: ServerResponse | undefined
  const server = createServer((req, res) => {
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }))
    } else if (req.url?.endsWith('/chat/completions')) {
      req.resume()
      req.on('end', () => {
        response = res
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.flushHeaders()
      })
    } else res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Provider did not start')
  const fixture = makeFixture('ai-activity')
  writeFileSync(
    join(fixture.userData, 'config.json'),
    JSON.stringify({
      files: {
        vaultPath: fixture.vault,
        openTabs: [join(fixture.vault, 'README.md')],
        activeTabPath: join(fixture.vault, 'README.md')
      },
      appearance: {
        designVersion: 1,
        theme: 'graphite',
        panelOrientation: 'vertical',
        motion: 'full'
      },
      ai: {
        enabled: true,
        providerId: 'lmstudio',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: 'mock-model',
        apiKeySet: false
      }
    })
  )
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await resizeWindow(app, 1400, 900)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await page.keyboard.press('Control+Alt+Shift+A')
    const dock = page.locator('writemd-ai-dock')
    const composer = dock.locator('writemd-ai-composer textarea')
    await composer.fill('Help me develop this idea')
    await composer.press('Enter')
    await expect.poll(() => response !== undefined).toBe(true)
    const thinking = dock.locator('.writemd-ai-thinking-label')
    await expect(thinking).toBeVisible()
    await expect(thinking).toHaveAttribute('data-artwork', 'label')
    const artworkBounds = await thinking.locator('[data-icon="ai-thinking"]').boundingBox()
    expect(artworkBounds!.width).toBe(18)
    expect(artworkBounds!.height).toBe(18)
    expect((await thinking.boundingBox())!.height).toBeLessThanOrEqual(20)
    await expect(thinking.locator('.writemd-ai-thinking-text')).toHaveText('Thinking...')
    await expect(dock.locator('.assistant .role, .bubble.idle')).toHaveCount(0)
    const animation = async (): Promise<string> =>
      thinking
        .locator('.writemd-ai-eyes')
        .evaluate((element) => getComputedStyle(element).animationName)
    await expect.poll(animation).toBe('writemd-ai-think')
    const dotAnimation = async (): Promise<string> =>
      thinking
        .locator('.writemd-ai-dot')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName)
    await expect.poll(dotAnimation).toBe('writemd-ai-dot')
    const originalMasks = await page
      .locator('[data-icon="ai"], [data-icon="ai-thinking"]')
      .evaluateAll((icons) => icons.map((icon) => icon.querySelector('mask')!.id))
    expect(new Set(originalMasks).size).toBe(originalMasks.length)
    await page.screenshot({ path: 'artifacts/ui-review/ai-thinking-dark.png' })
    await page.evaluate(() =>
      (
        document.querySelector('writemd-app') as unknown as { settingsStore: SettingsStore }
      ).settingsStore.set('appearance.theme', 'light')
    )
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(thinking).toBeVisible()
    await page.screenshot({ path: 'artifacts/ui-review/ai-thinking-light.png' })
    await page.evaluate(() =>
      (
        document.querySelector('writemd-app') as unknown as { settingsStore: SettingsStore }
      ).settingsStore.set('appearance.theme', 'graphite')
    )

    await page.evaluate(() =>
      (
        document.querySelector('writemd-app') as unknown as { settingsStore: SettingsStore }
      ).settingsStore.set('appearance.motion', 'reduced')
    )
    await expect.poll(animation).toBe('none')
    await expect.poll(dotAnimation).toBe('none')
    await page.evaluate(() =>
      (
        document.querySelector('writemd-app') as unknown as { settingsStore: SettingsStore }
      ).settingsStore.set('appearance.motion', 'system')
    )
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect.poll(animation).toBe('none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect.poll(animation).toBe('writemd-ai-think')

    response!.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'A useful starting point.' } }] })}\n\n`
    )
    await expect(dock.locator('.md')).toContainText('A useful starting point.')
    await expect(thinking).toHaveCount(0)
    await expect(dock.locator('.assistant .role, .assistant svg[data-icon]')).toHaveCount(0)
    await expect(dock.getByLabel('Stop response')).toBeVisible()
    response!.end('data: [DONE]\n\n')
    await expect(dock.getByLabel('Stop response')).toHaveCount(0)
    await page.screenshot({ path: 'artifacts/ui-review/ai-activity-settled-dark.png' })
  } finally {
    response?.end()
    await app.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
