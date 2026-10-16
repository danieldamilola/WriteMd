import { test, expect, type ElectronApplication } from '@playwright/test'
import { createServer } from 'http'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'

for (const selected of [false, true]) {
  test(`auto-accept persists and applies ${selected ? 'selected-text' : 'whole-note'} edits and multiple files`, async () => {
    test.setTimeout(60000)
    const fixture = makeFixture(`ai-auto-accept-${selected}`)
    const note = join(fixture.vault, 'README.md')
    const other = join(fixture.userData, 'Other.md')
    writeFileSync(note, 'A car is red.')
    writeFileSync(other, 'Original')
    const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = []
    const answers = [
      '<<<<<<< SEARCH\ncar\n=======\nvehicle\n>>>>>>> REPLACE',
      '<<<<<<< SEARCH\nvehicle\n=======\ntruck\n>>>>>>> REPLACE',
      `<<<<<<< SEARCH path="${note}"\ntruck\n=======\nbus\n>>>>>>> REPLACE\n` +
        `<<<<<<< SEARCH path="${other}"\nOriginal\n=======\nRevised\n>>>>>>> REPLACE`
    ]
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        requests.push(JSON.parse(body))
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: answers.shift() } }] })}\n\n`
        )
        res.end('data: [DONE]\n\n')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not start')
    const configPath = join(fixture.userData, 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.appearance.theme = selected ? 'paper' : 'graphite'
    config.ai = {
      enabled: true,
      providerId: 'lmstudio',
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: 'mock-model'
    }
    writeFileSync(configPath, JSON.stringify(config))
    let app: ElectronApplication | undefined
    try {
      app = await launch(fixture)
      let page = await firstWindow(app)
      await expect(page.locator('writemd-editor')).toBeVisible()
      await page.keyboard.press('Control+,')
      let settings = page.locator('writemd-settings-modal')
      await settings.getByRole('button', { name: 'AI assistant', exact: true }).click()
      let toggle = settings.getByRole('switch', { name: 'Automatically accept AI edits' })
      await expect(toggle).toHaveAttribute('aria-checked', 'false')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-checked', 'true')
      await expect
        .poll(() => JSON.parse(readFileSync(configPath, 'utf8')).ai.autoAcceptEdits)
        .toBe(true)
      await page.screenshot({
        path: `artifacts/ui-review/ai-auto-accept-settings-${selected ? 'paper' : 'dark'}.png`
      })
      await app.close()
      app = await launch(fixture)
      page = await firstWindow(app)
      await expect(page.locator('writemd-editor')).toBeVisible()
      await page.keyboard.press('Control+,')
      settings = page.locator('writemd-settings-modal')
      await settings.getByRole('button', { name: 'AI assistant', exact: true }).click()
      toggle = settings.getByRole('switch', { name: 'Automatically accept AI edits' })
      await expect(toggle).toHaveAttribute('aria-checked', 'true')
      await settings.getByRole('button', { name: 'Back to editor' }).click()
      if (selected)
        await page.locator('writemd-editor').evaluate((element) => {
          const editor = element as unknown as {
            editorView: { dispatch: (spec: unknown) => void; focus: () => void }
          }
          editor.editorView.dispatch({ selection: { anchor: 2, head: 5 } })
          editor.editorView.focus()
        })
      await page.keyboard.press('Control+Alt+A')
      const quick = page.locator('writemd-ai-quick')
      await quick.locator('textarea').fill('Replace car with vehicle.')
      await quick.getByRole('button', { name: 'Send message' }).click()
      await expect.poll(() => readFileSync(note, 'utf8')).toBe('A vehicle is red.')
      await expect(quick.getByRole('dialog', { name: 'Ask AI' })).toBeVisible()
      await expect(quick.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0)
      await quick.locator('textarea').fill('Make it more precise.')
      await quick.getByRole('button', { name: 'Send message' }).click()
      await expect.poll(() => readFileSync(note, 'utf8')).toBe('A truck is red.')
      const latestUser = requests[1]?.messages.filter((message) => message.role === 'user').at(-1)
      expect(JSON.stringify(latestUser?.content)).toContain('vehicle')
      await quick
        .locator('textarea')
        .fill(`Change truck to bus, and Original to Revised in ${other}`)
      await quick.getByRole('button', { name: 'Send message' }).click()
      await expect.poll(() => readFileSync(note, 'utf8')).toBe('A bus is red.')
      await expect.poll(() => readFileSync(other, 'utf8')).toBe('Revised')
      await expect(quick.getByRole('dialog', { name: 'Ask AI' })).toBeVisible()
      await expect(quick.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0)
      await page.screenshot({
        path: `artifacts/ui-review/ai-auto-accept-${selected ? 'selection' : 'note'}.png`
      })
      await page.evaluate(async (path) => {
        const changes = await window.electronAPI!.ai.listChanges()
        const change = changes.find((entry) => entry.path === path)
        if (!change) throw new Error('The external edit has no undo entry')
        return window.electronAPI!.ai.undoChange(change.id)
      }, other)
      expect(readFileSync(other, 'utf8')).toBe('Original')
    } finally {
      await app?.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}
