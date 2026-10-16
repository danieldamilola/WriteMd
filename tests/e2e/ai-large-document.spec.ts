import { test, expect, type ElectronApplication } from '@playwright/test'
import { createServer } from 'http'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow, resizeWindow } from './fixtures'

test('large notes reach the AI intact and support local edits and direct rewrites', async () => {
  test.setTimeout(90000)
  const fixture = makeFixture('ai-large-document')
  const path = join(fixture.vault, 'README.md')
  const original =
    '# Long document\n\n' +
    'Keep this paragraph unchanged.\n\n'.repeat(4100) +
    'Unique final paragraph.'
  const addition = '\n\n[[Related note]]'
  const rewritten = '# Rewritten document\n\nThe requested replacement.'
  writeFileSync(path, original)
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = []
  let finishRewrite: (() => void) | undefined
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      requests.push(JSON.parse(body))
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const send = (content: string): void => {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
      }
      if (requests.length === 1) {
        send(
          `<<<<<<< SEARCH\nUnique final paragraph.\n=======\nUnique final paragraph.${addition}\n>>>>>>> REPLACE`
        )
        res.end('data: [DONE]\n\n')
      } else if (requests.length === 2) {
        send(`<<<<<<< REWRITE\n${rewritten}`)
        finishRewrite = () => {
          send('\n>>>>>>> REPLACE')
          res.end('data: [DONE]\n\n')
        }
      } else {
        send('<<<<<<< REWRITE\nUnfinished replacement')
        res.end('data: [DONE]\n\n')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Provider did not start')
  const configPath = join(fixture.userData, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.appearance = { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical' }
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
    const editor = page.locator('writemd-editor')
    await expect(editor).toBeVisible()
    await editor.evaluate((element) => {
      const view = (
        element as unknown as { editorView: { dispatch(spec: unknown): void; focus(): void } }
      ).editorView
      view.dispatch({ selection: { anchor: 100 } })
      view.focus()
    })
    await page.keyboard.press('Control+Alt+A')
    const quick = page.locator('writemd-ai-quick')
    await quick.locator('textarea').fill('Add a backlink to Related note at the end of this file.')
    await quick.getByRole('button', { name: 'Send message' }).click()
    await expect(quick.locator('.suggestion')).toBeVisible()
    expect(JSON.stringify(requests[0].messages)).toContain('Unique final paragraph.')
    expect(JSON.stringify(requests[0].messages)).not.toContain('[truncated:')
    await expect(quick.locator('.suggestion del')).toHaveCount(0)
    await expect(quick.locator('.replacement')).toHaveText(addition)
    expect(readFileSync(path, 'utf8')).toBe(original)
    await page.screenshot({ path: 'artifacts/ui-review/ai-large-document-local-preview.png' })
    await quick.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect.poll(() => readFileSync(path, 'utf8')).toBe(original + addition)
    await expect
      .poll(() =>
        editor.evaluate(
          (element) =>
            (
              element as unknown as {
                editorView: { state: { selection: { main: { anchor: number } } } }
              }
            ).editorView.state.selection.main.anchor
        )
      )
      .toBe(100)

    await page.keyboard.press('Control+j')
    const dock = page.locator('writemd-ai-dock')
    await expect(dock).toBeVisible()
    await dock.locator('textarea').fill('Rewrite the entire document.')
    await dock.locator('textarea').press('Enter')
    await expect.poll(() => !!finishRewrite).toBe(true)
    await expect(dock.getByRole('button', { name: 'Stop response' })).toBeVisible()
    await expect(dock.locator('.msg.assistant').last()).not.toContainText('<<<<<<<')
    expect(readFileSync(path, 'utf8')).toBe(original + addition)
    finishRewrite!()
    await expect.poll(() => readFileSync(path, 'utf8')).toBe(rewritten)
    await expect(editor.locator('.cm-content')).toContainText('The requested replacement.')
    await expect(page.locator('writemd-info-pill')).toContainText(`${rewritten.length} characters`)
    await page.screenshot({ path: 'artifacts/ui-review/ai-large-document-rewritten.png' })

    await dock.locator('textarea').fill('Rewrite the entire document again.')
    await dock.locator('textarea').press('Enter')
    await expect(dock.locator('.error')).toContainText('No edits were applied.')
    expect(readFileSync(path, 'utf8')).toBe(rewritten)
  } finally {
    await app?.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
