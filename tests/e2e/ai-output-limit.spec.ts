import { test, expect } from '@playwright/test'
import { createServer } from 'http'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow, chooseSettingsOption } from './fixtures'

test('Automatic removes the app cap and a saved custom limit reaches the side panel', async () => {
  test.setTimeout(90000)
  const fixture = makeFixture('ai-output-limit')
  const floatingPath = join(fixture.userData, 'Floating.md')
  const panelPath = join(fixture.userData, 'Panel.md')
  writeFileSync(floatingPath, 'Original')
  writeFileSync(panelPath, 'Original')
  const draft =
    '# Rust\n\n' + 'Ownership gives each value a clear lifetime.\n'.repeat(1000).trimEnd()
  const requests: Array<{ max_tokens?: number }> = []
  const answers = [draft, 'Panel draft.']
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      requests.push(JSON.parse(body))
      const edit = `<<<<<<< SEARCH\nOriginal\n=======\n${answers.shift()}\n>>>>>>> REPLACE`
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: edit }, finish_reason: 'stop' }] })}\n\n`
      )
      res.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not start')
  const configPath = join(fixture.userData, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.files.openTabs = [floatingPath, panelPath]
  config.files.activeTabPath = floatingPath
  config.appearance.panelOrientation = 'vertical'
  config.ai = {
    enabled: true,
    providerId: 'lmstudio',
    model: 'mock-model',
    baseUrl: `http://127.0.0.1:${address.port}/v1`
  }
  writeFileSync(configPath, JSON.stringify(config))
  let app = await launch(fixture)
  try {
    let page = await firstWindow(app)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await page.keyboard.press('Control+Alt+A')
    const quick = page.locator('writemd-ai-quick')
    await quick.locator('textarea').fill('Rewrite the note as a Rust article.')
    await quick.getByRole('button', { name: 'Send message' }).click()
    await expect(quick.getByRole('button', { name: 'Accept', exact: true })).toBeVisible()
    await expect(quick.getByRole('button', { name: 'Stop response' })).toHaveCount(0)
    expect(requests[0]).not.toHaveProperty('max_tokens')
    await quick.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect.poll(() => readFileSync(floatingPath, 'utf8')).toBe(draft)
    await page.keyboard.press('Control+,')
    let settings = page.locator('writemd-settings-modal')
    await settings.getByRole('button', { name: 'AI assistant', exact: true }).click()
    await expect(settings.locator('wa-select[aria-label="Output limit"]')).toHaveJSProperty(
      'value',
      '0'
    )
    await chooseSettingsOption(page, 'Output limit', '65536')
    await expect
      .poll(() => JSON.parse(readFileSync(configPath, 'utf8')).ai.maxOutputTokens)
      .toBe(65536)
    await page.screenshot({ path: 'artifacts/ui-review/ai-output-limit-setting.png' })
    await app.close()
    app = await launch(fixture)
    page = await firstWindow(app)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await page.keyboard.press('Control+,')
    settings = page.locator('writemd-settings-modal')
    await settings.getByRole('button', { name: 'AI assistant', exact: true }).click()
    await expect(settings.locator('wa-select[aria-label="Output limit"]')).toHaveJSProperty(
      'value',
      '65536'
    )
    await settings.getByRole('button', { name: 'Back to editor' }).click()
    await page.getByRole('tab', { name: /Panel.md/ }).click()
    await page.keyboard.press('Control+j')
    const dock = page.locator('writemd-ai-dock')
    await dock.locator('textarea').fill('Rewrite this note.')
    await dock.locator('textarea').press('Enter')
    await expect.poll(() => readFileSync(panelPath, 'utf8')).toBe('Panel draft.')
    expect(requests[1].max_tokens).toBe(65536)
  } finally {
    await app.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
