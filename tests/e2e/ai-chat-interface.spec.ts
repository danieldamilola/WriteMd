import { test, expect } from '@playwright/test'
import { createServer } from 'http'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow, openSettings, resizeWindow } from './fixtures'

test.setTimeout(120000)

test('chat switches provider models, restores history, and fits workspace themes', async () => {
  const requests: Array<{ model: string; messages: Array<{ role: string; content: unknown }> }> = []
  const server = createServer((req, res) => {
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }, { id: 'mock-model-fast' }] }))
      return
    }
    if (req.url?.endsWith('/chat/completions')) {
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        requests.push(JSON.parse(body))
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        const answer =
          '## A clearer note\n\nKeep the introduction short, then describe the next step.\n\n- Use a descriptive title.\n- Keep each paragraph focused.'
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`)
        res.end('data: [DONE]\n\n')
      })
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Provider did not start')
  const fixture = makeFixture('ai-chat-interface')
  const longNoteName = `planning ${'long-note-name-'.repeat(9)}.md`
  writeFileSync(join(fixture.vault, longNoteName), '# Planning\n\nA long note reference.')
  const configPath = join(fixture.userData, 'config.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      files: {
        vaultPath: fixture.vault,
        openTabs: [join(fixture.vault, 'README.md')],
        activeTabPath: join(fixture.vault, 'README.md')
      },
      appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical' },
      ai: {
        enabled: true,
        providerId: 'lmstudio',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: 'mock-model',
        apiKeySet: false,
        historyTurns: 8,
        cachedModels: []
      }
    })
  )
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await resizeWindow(app, 1400, 900)
    await expect(page.locator('writemd-editor')).toBeVisible()
    // Ctrl+Alt+A opens the floating bar, which is what the AI buttons open.
    await page.keyboard.press('Control+Alt+A')
    const quick = page.locator('writemd-ai-quick')
    await expect(quick.getByRole('dialog', { name: 'Ask AI' })).toBeVisible()
    // A click in the note is not a dismissal, so the icon is what closes it.
    await page.locator('#primary-cm-wrapper .cm-content').click()
    await expect(page.locator('writemd-ai-quick')).toHaveCount(1)
    await page.locator('writemd-sidebar').locator('writemd-icon-button.assistant').click()
    await expect(page.locator('writemd-ai-quick')).toHaveCount(0)

    // The panel keeps its own shortcut.
    await page.keyboard.press('Control+Alt+Shift+A')
    const dock = page.locator('writemd-ai-dock')
    await expect(dock).toBeVisible()
    const assertFitsWindow = async (): Promise<void> => {
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      const contentSize = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getContentSize()
      )
      expect([viewport.width, viewport.height]).toEqual(contentSize)
      for (const control of [
        dock,
        dock.getByLabel('Close assistant'),
        dock.getByLabel('Send message'),
        composer
      ]) {
        const bounds = await control.boundingBox()
        expect(bounds).not.toBeNull()
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.y).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1)
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1)
      }
    }
    const composer = dock.locator('writemd-ai-composer textarea')
    await assertFitsWindow()
    const initialPrompt = await composer.boundingBox()
    expect(initialPrompt!.height).toBeLessThanOrEqual(44)
    const promptField = dock.locator('writemd-ai-composer .field')
    expect(
      await promptField.evaluate((element) => parseFloat(getComputedStyle(element).borderRadius))
    ).toBeGreaterThanOrEqual(12)
    const sendControl = dock.getByLabel('Send message')
    expect(
      await sendControl.evaluate((element) => parseFloat(getComputedStyle(element).borderRadius))
    ).toBe(4)
    await composer.fill(Array.from({ length: 12 }, (_, index) => `Draft line ${index}`).join('\n'))
    const grownPrompt = await composer.boundingBox()
    expect(grownPrompt!.height).toBeGreaterThan(initialPrompt!.height)
    expect(grownPrompt!.height).toBeLessThanOrEqual(160)
    await assertFitsWindow()
    await composer.fill('')
    expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(44)
    const editorSurface = await page
      .locator('writemd-editor writemd-panel[slot="primary"]')
      .evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(await dock.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
      editorSurface
    )
    await expect(dock.locator('select')).toHaveCount(0)
    expect(
      await dock
        .locator('.suggestions button')
        .first()
        .evaluate((element) => getComputedStyle(element).borderTopWidth)
    ).toBe('0px')
    await composer.focus()
    const fieldColors = await dock.locator('writemd-ai-composer .field').evaluate((element) => {
      const style = getComputedStyle(element)
      const reference = document.createElement('span')
      reference.style.color = 'var(--border)'
      element.append(reference)
      const border = getComputedStyle(reference).color
      reference.remove()
      return { border: style.borderTopColor, expected: border }
    })
    expect(fieldColors.border).toBe(fieldColors.expected)
    await page.screenshot({ path: 'artifacts/ui-review/ai-chat-empty-dark.png' })

    const picker = dock.locator('writemd-ai-model-picker')
    await picker.getByLabel('Choose AI model').click()
    await expect(picker.getByRole('option', { name: 'mock-model-fast', exact: true })).toBeVisible()
    await page.screenshot({ path: 'artifacts/ui-review/ai-chat-models-dark.png' })
    await picker.getByRole('option', { name: 'mock-model-fast', exact: true }).click()
    await expect
      .poll(() => JSON.parse(readFileSync(configPath, 'utf-8')).ai.model)
      .toBe('mock-model-fast')

    const editor = page.locator('#primary-cm-wrapper .cm-content')
    await editor.focus()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('Control+Shift+End')
    // Alt+J opens the bar over the note, with the selection already scoped.
    await page.keyboard.press('Alt+j')
    await expect(quick.getByRole('dialog', { name: 'Ask AI' })).toBeVisible()
    await expect(quick.locator('writemd-ai-composer textarea')).toHaveAttribute(
      'placeholder',
      /Ask about your selection/
    )
    await expect(page.locator('writemd-ai-dock')).toHaveCount(0)
    await page.screenshot({ path: 'artifacts/ui-review/ai-chat-selection-bar.png' })

    // Hand off to the panel, which carries the same captured selection.
    await quick.getByRole('button', { name: 'Open full chat' }).click()
    await expect(dock).toBeVisible()
    await expect(dock.getByLabel('Remove selection from context')).toBeVisible()

    await composer.fill('Help me improve this note')
    await composer.press('Enter')
    await expect(dock.locator('.md')).toContainText('A clearer note')
    expect(requests[0]?.model).toBe('mock-model-fast')
    expect(JSON.stringify(requests[0]?.messages)).toContain('E2E fixture.')
    await expect
      .poll(() => {
        try {
          return JSON.parse(readFileSync(join(fixture.userData, 'ai-sessions.json'), 'utf-8'))
            .length
        } catch {
          return 0
        }
      })
      .toBe(1)
    await page.screenshot({ path: 'artifacts/ui-review/ai-chat-conversation-dark.png' })

    await dock.getByLabel('New chat', { exact: true }).click()
    await expect(dock.locator('.msg')).toHaveCount(0)
    const history = dock.locator('writemd-ai-history-picker')
    await history.getByRole('button', { name: 'Conversation history', exact: true }).click()
    await history.getByRole('menuitem', { name: 'Help me improve this note', exact: true }).click()
    await expect(dock.locator('.md')).toContainText('A clearer note')
    await composer.fill('What should I write next?')
    await composer.press('Enter')
    await expect.poll(() => requests.length).toBe(2)
    await expect(dock.locator('.md')).toHaveCount(2)
    expect(JSON.stringify(requests[1]?.messages)).toContain('Help me improve this note')

    await openSettings(page)
    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    await page.getByRole('radio', { name: 'Light theme', exact: true }).click()
    await page.getByRole('button', { name: 'Back to editor', exact: true }).click()
    await expect(dock).toBeVisible()
    await page.screenshot({ path: 'artifacts/ui-review/ai-chat-conversation-light.png' })
    await resizeWindow(app, 860, 640)
    await expect(composer).toBeVisible()
    await assertFitsWindow()
    expect((await dock.boundingBox())!.width).toBeLessThanOrEqual(640)
    const panel = await dock.boundingBox()
    const input = await composer.boundingBox()
    expect(panel).not.toBeNull()
    expect(input).not.toBeNull()
    expect((input?.x ?? 0) + (input?.width ?? 0)).toBeLessThanOrEqual(
      (panel?.x ?? 0) + (panel?.width ?? 0) + 1
    )
    await page.screenshot({ path: 'artifacts/ui-review/ai-chat-compact-light.png' })
    await picker.getByLabel('Choose AI model').click()
    const menu = picker.getByRole('dialog', { name: 'Choose AI model' })
    await expect(menu).toBeVisible()
    const menuBounds = await menu.boundingBox()
    expect(menuBounds).not.toBeNull()
    expect(menuBounds!.x).toBeGreaterThanOrEqual(0)
    expect(menuBounds!.y).toBeGreaterThanOrEqual(0)
    expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(860)
    expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(640)
    await page.screenshot({ path: 'artifacts/ui-review/ai-chat-compact-models-light.png' })
    await menu.getByLabel('Search models').press('Escape')
    await openSettings(page)
    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    await page.getByRole('radio', { name: 'Graphite theme', exact: true }).click()
    await page.getByRole('button', { name: 'Back to editor', exact: true }).click()
    await resizeWindow(app, 800, 600)
    await assertFitsWindow()
    await page.screenshot({ path: 'artifacts/ui-review/ai-chat-minimum-dark.png' })
    await history.getByRole('button', { name: 'Conversation history', exact: true }).click()
    const historyMenu = history.getByRole('menu', { name: 'Conversation history', exact: true })
    await expect(historyMenu).toBeVisible()
    const historyBounds = (await historyMenu.boundingBox())!
    expect(historyBounds.x).toBeGreaterThanOrEqual(0)
    expect(historyBounds.x + historyBounds.width).toBeLessThanOrEqual(800)
    expect(historyBounds.y + historyBounds.height).toBeLessThanOrEqual(600)
    await page.screenshot({ path: 'artifacts/ui-review/ai-chat-history-dark.png' })
    await page.keyboard.press('Escape')
    await composer.fill('@planning')
    const mentions = dock.locator('writemd-ai-composer .mention')
    await expect(mentions).toBeVisible()
    const name = mentions.locator('.mention-name')
    await expect(name).toHaveText(longNoteName)
    expect(await mentions.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true
    )
    const mentionBounds = (await mentions.boundingBox())!
    expect(mentionBounds.x + mentionBounds.width).toBeLessThanOrEqual(800)
    expect(mentionBounds.y + mentionBounds.height).toBeLessThanOrEqual(600)
    await page.screenshot({ path: 'artifacts/ui-review/ai-chat-mentions-dark.png' })
    await composer.press('Enter')
    await expect(composer).toHaveValue(`@"${longNoteName}" `)
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
