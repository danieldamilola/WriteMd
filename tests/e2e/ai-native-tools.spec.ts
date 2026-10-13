import { test, expect, type ElectronApplication } from '@playwright/test'
import { createServer } from 'http'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow, resizeWindow } from './fixtures'

for (const selected of [false, true]) {
  test(`floating edits recover native tool markup with selected text=${selected}`, async () => {
    const fixture = makeFixture(`ai-native-tools-${selected}`)
    const path = join(fixture.vault, 'README.md')
    const original = '# Note\n\nOriginal\n\nKeep this paragraph.'
    writeFileSync(path, original)
    const requests: Array<{
      tools?: unknown[]
      messages: Array<{ role: string; content: unknown }>
    }> = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        requests.push(JSON.parse(body))
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        const response =
          requests.length === 1
            ? '<｜DSML｜function_calls><｜DSML｜invoke name="read_file">unused</｜DSML｜invoke></｜DSML｜function_calls>'
            : '<<<<<<< SEARCH\nOriginal\n=======\nChanged\n>>>>>>> REPLACE'
        for (const content of response)
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
        res.end('data: [DONE]\n\n')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Provider did not start')
    const configPath = join(fixture.userData, 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.appearance = {
      designVersion: 1,
      theme: selected ? 'paper' : 'graphite',
      panelOrientation: 'vertical'
    }
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
      const page = await firstWindow(app)
      await resizeWindow(app, 1200, 800)
      await expect(page.locator('writemd-editor')).toBeVisible()
      if (selected)
        await page.locator('writemd-editor').evaluate((element) => {
          const view = (
            element as unknown as { editorView: { dispatch(spec: unknown): void; focus(): void } }
          ).editorView
          view.dispatch({ selection: { anchor: 8, head: 16 } })
          view.focus()
        })
      await page.keyboard.press('Control+Alt+A')
      const quick = page.locator('writemd-ai-quick')
      await quick.locator('textarea').fill('Replace Original with Changed.')
      await quick.getByRole('button', { name: 'Send message' }).click()
      await expect(quick.getByRole('button', { name: 'Accept', exact: true })).toBeVisible()
      await expect(quick.locator('.error')).toHaveCount(0)
      await expect(quick.locator('.replacement')).toContainText('Changed')
      expect(requests).toHaveLength(2)
      expect(requests[0].tools?.length ?? 0).toBe(selected ? 0 : 1)
      expect(requests[1].tools).toBeUndefined()
      expect(String(requests[1].messages[0].content)).toContain('No tools are available')
      expect(readFileSync(path, 'utf8')).toBe(original)
      await page.screenshot({
        path: `artifacts/ui-review/ai-native-tools-recovered-${selected ? 'selection' : 'note'}.png`
      })
      await quick.getByRole('button', { name: 'Accept', exact: true }).click()
      await expect
        .poll(() => readFileSync(path, 'utf8'))
        .toBe(original.replace('Original', 'Changed'))
    } finally {
      await app?.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}
