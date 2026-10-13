import { test, expect } from '@playwright/test'
import { createServer } from 'http'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { SettingsStore } from '../../src/renderer/src/state/settings'
import { makeFixture, launch, firstWindow, resizeWindow } from './fixtures'

test.setTimeout(120000)

/**
 * A provider that answers each request with the next scripted reply, so the bar
 * has something to render above it.
 */
function mockProvider(
  answers: string[] = [],
  delayMs = 0
): {
  port: Promise<number>
  requests: Array<{ messages: Array<{ role: string; content: unknown }> }>
  close: () => Promise<void>
} {
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = []
  const scripted = [...answers]
  const searchReplace = '<<<<<<< SEARCH\ncar\n=======\nvehicle\n>>>>>>> REPLACE'
  const server = createServer((req, res) => {
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }))
      return
    }
    if (req.url?.endsWith('/chat/completions')) {
      let body = ''
      req.on('data', (chunk: Buffer) => (body += chunk.toString()))
      req.on('end', () => {
        requests.push(JSON.parse(body))
        const answer = scripted.shift() ?? searchReplace
        const send = (): void => {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`)
          res.end('data: [DONE]\n\n')
        }
        if (delayMs) setTimeout(send, delayMs)
        else send()
      })
      return
    }
    res.writeHead(404).end()
  })
  const listening = new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Provider did not start')
      resolve(address.port)
    })
  })
  return {
    port: listening,
    requests,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

/** The bar's box, and the box it is centred and anchored against. */
async function geometry(page: import('@playwright/test').Page): Promise<{
  bar: { x: number; y: number; width: number; height: number }
  main: { x: number; y: number; width: number; height: number }
}> {
  const bar = (await page.locator('writemd-ai-quick .panel').boundingBox())!
  const main = (await page.locator('writemd-ai-quick').boundingBox())!
  return { bar, main }
}

test('quick AI previews a selected-text edit and accepts it into the note', async () => {
  const provider = mockProvider()
  const port = await provider.port
  const fixture = makeFixture('ai-quick')
  const note = 'A car is red.\n\nSECRET_UNSELECTED_TEXT'
  writeFileSync(join(fixture.vault, 'README.md'), note)
  writeFileSync(
    join(fixture.userData, 'config.json'),
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
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'mock-model',
        apiKeySet: false,
        historyTurns: 8,
        cachedModels: ['mock-model']
      }
    })
  )
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await resizeWindow(app, 1000, 720)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await page.locator('writemd-editor').evaluate((element) => {
      const editor = element as unknown as {
        editorView: {
          state: { doc: { toString(): string } }
          dispatch: (spec: unknown) => void
          focus: () => void
        }
      }
      const text = editor.editorView.state.doc.toString()
      const start = text.indexOf('car')
      editor.editorView.dispatch({ selection: { anchor: start, head: start + 3 } })
      editor.editorView.focus()
    })
    await page.locator('writemd-sidebar').locator('writemd-icon-button.assistant').click()
    const quick = page.locator('writemd-ai-quick')
    await expect(quick.getByRole('dialog', { name: 'Ask AI' })).toBeVisible()
    await expect(page.locator('writemd-ai-dock')).toHaveCount(0)

    const prompt = quick.locator('writemd-ai-composer textarea')
    const promptBox = await prompt.boundingBox()
    expect(promptBox).not.toBeNull()

    // The bar floats over the foot of the document: horizontally centred on the
    // document rather than the window, and clear of the footer beneath it.
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    const mainArea = (await page.locator('writemd-editor').boundingBox())!
    const { bar } = await geometry(page)
    expect(Math.abs(bar.x + bar.width / 2 - (mainArea.x + mainArea.width / 2))).toBeLessThanOrEqual(
      1
    )
    expect(bar.x).toBeGreaterThan(mainArea.x)
    expect(bar.x + bar.width).toBeLessThanOrEqual(mainArea.x + mainArea.width)
    // One prompt line, not a dialog: the bar is short and it is near the floor.
    expect(bar.height).toBeLessThan(viewport.height / 2)
    expect(viewport.height - (bar.y + bar.height)).toBeLessThan(120)
    // A prompt is not a page. It should not span the editor's measure.
    expect(bar.width).toBeLessThanOrEqual(520)
    // Bar and reply card share a corner radius, so they read as one piece.
    const barRadius = await quick
      .locator('writemd-ai-composer .field')
      .evaluate((el) => getComputedStyle(el).borderRadius)
    expect(Number.parseFloat(barRadius)).toBeLessThanOrEqual(16)

    // The bar is attach, prompt and send. No model picker.
    await expect(quick.locator('writemd-ai-composer writemd-ai-model-picker')).toHaveCount(0)
    await expect(quick.getByRole('button', { name: 'Attach a file' })).toBeVisible()
    await expect(quick.getByRole('button', { name: 'Send message' })).toBeVisible()
    // Nothing to read while idle.
    await expect(quick.locator('.head, .context, .output')).toHaveCount(0)

    await page.screenshot({ path: 'artifacts/ui-review/ai-quick-prompt.png' })

    await prompt.fill('Replace the selected word with a more formal term.')
    await prompt.press('Enter')
    await expect(quick.locator('.suggestion')).toBeVisible()
    expect(JSON.stringify(provider.requests[0]?.messages)).toContain('car')
    expect(JSON.stringify(provider.requests[0]?.messages)).not.toContain('SECRET_UNSELECTED_TEXT')
    await page.screenshot({ path: 'artifacts/ui-review/ai-quick-suggestion.png' })

    // Both of the bar's other exits sit above the prompt, not beside it and not
    // wedged into the reply.
    const promptBar = (await quick.locator('writemd-ai-composer .field').boundingBox())!
    for (const selector of ['.handoff', "button[aria-label='Put the prompt bar away']"]) {
      const control = (await quick.locator(selector).boundingBox())!
      expect(control.y).toBeLessThan(promptBar.y)
      expect(control.y + control.height).toBeLessThanOrEqual(promptBar.y + 1)
      // Inside the bar's own width, so the row reads as belonging to it.
      expect(control.x).toBeGreaterThanOrEqual(promptBar.x - 1)
      expect(control.x + control.width).toBeLessThanOrEqual(promptBar.x + promptBar.width + 1)
    }
    // The two sit at opposite ends of that row.
    const away = (await quick
      .locator("button[aria-label='Put the prompt bar away']")
      .boundingBox())!
    const handoffControl = (await quick.locator('.handoff').boundingBox())!
    expect(away.x).toBeLessThan(handoffControl.x)
    expect(Math.abs(away.y - handoffControl.y)).toBeLessThanOrEqual(4)
    const card = (await quick.locator('.output').boundingBox())!
    expect(card.y).toBeLessThan(promptBar.y)

    await quick.getByRole('button', { name: 'Open full chat' }).click()
    await expect(page.locator('writemd-ai-quick')).toHaveCount(0)
    await expect(page.locator('writemd-ai-dock')).toBeVisible()
    await page.screenshot({ path: 'artifacts/ui-review/ai-quick-handoff.png' })
  } finally {
    await app.close()
    await provider.close()
  }
})

test('AI edits an external note and accepts an unopened external file with undo', async () => {
  const fixture = makeFixture('ai-external')
  const currentPath = join(fixture.userData, 'External.MD')
  const otherPath = join(fixture.userData, 'Other.markdown')
  writeFileSync(currentPath, 'A car is red.')
  writeFileSync(otherPath, 'Original')
  const provider = mockProvider([
    '<<<<<<< SEARCH\ncar\n=======\nvehicle\n>>>>>>> REPLACE',
    `<<<<<<< SEARCH path="${otherPath}"\nOriginal\n=======\nRevised\n>>>>>>> REPLACE`,
    `<<<<<<< SEARCH path="${otherPath}"\nOriginal\n=======\nChat revision\n>>>>>>> REPLACE`
  ])
  const port = await provider.port
  writeFileSync(
    join(fixture.userData, 'config.json'),
    JSON.stringify({
      files: { vaultPath: fixture.vault, openTabs: [currentPath], activeTabPath: currentPath },
      appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical' },
      ai: {
        enabled: true,
        providerId: 'lmstudio',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'mock-model',
        apiKeySet: false,
        historyTurns: 8
      }
    })
  )
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await page.keyboard.press('Control+Alt+A')
    const quick = page.locator('writemd-ai-quick')
    await quick.locator('writemd-ai-composer textarea').fill('Change car to vehicle in this note')
    await quick.getByRole('button', { name: 'Send message' }).click()
    await expect(quick.getByRole('button', { name: 'Accept' })).toBeVisible()
    expect(readFileSync(currentPath, 'utf8')).toBe('A car is red.')
    await page.screenshot({ path: 'artifacts/ui-review/ai-external-note-preview.png' })
    await quick.getByRole('button', { name: 'Accept' }).click()
    await expect(quick.getByRole('dialog', { name: 'Ask AI' })).toBeVisible()
    await expect(quick.locator('.reply')).toContainText('Applied the requested change.')
    await expect.poll(() => readFileSync(currentPath, 'utf8')).toBe('A vehicle is red.')
    expect(existsSync(join(fixture.vault, 'External.MD'))).toBe(false)

    await quick
      .locator('writemd-ai-composer textarea')
      .fill(`Change Original to Revised in ${otherPath}`)
    await quick.getByRole('button', { name: 'Send message' }).click()
    await expect(quick.getByRole('button', { name: 'Accept' })).toBeVisible()
    expect(readFileSync(otherPath, 'utf8')).toBe('Original')
    await quick.getByRole('button', { name: 'Accept' }).click()
    await expect(quick.locator('.applied')).toContainText('Other.markdown')
    await expect(quick.getByRole('button', { name: 'Accept' })).toHaveCount(0)
    expect(readFileSync(otherPath, 'utf8')).toBe('Revised')
    expect(readFileSync(currentPath, 'utf8')).toBe('A vehicle is red.')
    await page.screenshot({ path: 'artifacts/ui-review/ai-external-file-accepted.png' })
    const undo = await page.evaluate(async (path) => {
      const api = window.electronAPI!
      const changes = await api.ai.listChanges()
      const change = changes.find((entry) => entry.path === path)
      if (!change) throw new Error('The accepted edit has no undo entry')
      return api.ai.undoChange(change.id)
    }, otherPath)
    expect(undo.status).toBe('restored')
    expect(readFileSync(otherPath, 'utf8')).toBe('Original')

    await quick.getByRole('button', { name: 'Open full chat' }).click()
    const dock = page.locator('writemd-ai-dock')
    await expect(dock).toBeVisible()
    await dock.locator('textarea').fill(`Change Original to Chat revision in ${otherPath}`)
    await dock.locator('textarea').press('Enter')
    await expect.poll(() => readFileSync(otherPath, 'utf8')).toBe('Chat revision')
    const chatUndo = dock.getByRole('button', { name: `Undo the change to ${otherPath}` }).last()
    await expect(chatUndo).toBeVisible()
    await page.screenshot({ path: 'artifacts/ui-review/ai-external-chat-edit.png' })
    await chatUndo.click()
    await expect.poll(() => readFileSync(otherPath, 'utf8')).toBe('Original')
  } finally {
    await app.close()
    await provider.close()
  }
})

test('floating conversations keep follow-up context, appear in the panel and survive restart', async () => {
  const fixture = makeFixture('ai-shared-session')
  const provider = mockProvider(['First answer.', 'Follow-up answer.', 'Panel answer.'])
  const port = await provider.port
  const firstPrompt = 'Explain this note briefly'
  writeFileSync(
    join(fixture.userData, 'config.json'),
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
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'mock-model',
        apiKeySet: false,
        historyTurns: 8
      }
    })
  )
  let app = await launch(fixture)
  try {
    let page = await firstWindow(app)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await page.keyboard.press('Control+Alt+A')
    const quick = page.locator('writemd-ai-quick')
    const prompt = quick.locator('writemd-ai-composer textarea')
    await prompt.fill(firstPrompt)
    await quick.getByRole('button', { name: 'Send message' }).click()
    await expect(quick.locator('.reply')).toContainText('First answer.')
    await expect(quick.getByRole('button', { name: 'Stop response' })).toHaveCount(0)
    await prompt.fill('Tell me more')
    await quick.getByRole('button', { name: 'Send message' }).click()
    await expect(quick.locator('.reply')).toContainText('Follow-up answer.')
    await expect(quick.getByRole('button', { name: 'Stop response' })).toHaveCount(0)
    expect(JSON.stringify(provider.requests[1].messages)).toContain('First answer.')
    const sessions = await page.evaluate(() => window.electronAPI!.ai.listSessions())
    expect(sessions).toHaveLength(1)
    expect(sessions[0].messages).toHaveLength(4)
    const sessionId = sessions[0].id

    await page.keyboard.press('Control+Alt+A')
    await expect(quick).toHaveCount(0)
    await page.keyboard.press('Control+j')
    let dock = page.locator('writemd-ai-dock')
    await expect(dock).toBeVisible()
    await expect(dock.locator('.thread')).toContainText(firstPrompt)
    await expect(dock.locator('.thread')).toContainText('First answer.')
    await expect(dock.locator('.thread')).toContainText('Follow-up answer.')
    await dock.getByRole('button', { name: 'Conversation history' }).click()
    const history = dock.locator('writemd-ai-history-picker .m-item')
    await expect(history).toHaveCount(1)
    await expect(history).toHaveAttribute('aria-current', 'true')
    await history.click()
    await dock.locator('textarea').fill('Continue in the panel')
    await dock.locator('textarea').press('Enter')
    await expect(dock.locator('.thread')).toContainText('Panel answer.')
    await expect(dock.getByRole('button', { name: 'Stop response' })).toHaveCount(0)
    const after = await page.evaluate(() => window.electronAPI!.ai.listSessions())
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(sessionId)
    expect(after[0].messages).toHaveLength(6)
    expect(JSON.stringify(provider.requests[2].messages)).toContain('Follow-up answer.')
    await page.screenshot({ path: 'artifacts/ui-review/ai-shared-conversation.png' })
    await dock.getByRole('button', { name: 'Open in floating bar' }).click()
    await expect(dock).toHaveCount(0)
    await expect(quick.locator('.reply')).toContainText('Panel answer.')
    expect((await page.evaluate(() => window.electronAPI!.ai.listSessions()))[0].id).toBe(sessionId)
    await page.screenshot({ path: 'artifacts/ui-review/ai-panel-to-floating.png' })

    await app.close()
    app = await launch(fixture)
    page = await firstWindow(app)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await page.keyboard.press('Control+j')
    dock = page.locator('writemd-ai-dock')
    await dock.getByRole('button', { name: 'Conversation history' }).click()
    await dock.locator('writemd-ai-history-picker .m-item').filter({ hasText: firstPrompt }).click()
    await expect(dock.locator('.thread')).toContainText('First answer.')
    await expect(dock.locator('.thread')).toContainText('Panel answer.')
    expect((await page.evaluate(() => window.electronAPI!.ai.listSessions()))[0].id).toBe(sessionId)
    await page.screenshot({ path: 'artifacts/ui-review/ai-shared-conversation-restored.png' })
  } finally {
    await app.close()
    await provider.close()
  }
})

test('Open full chat continues the floating bar live reply without starting a second session', async () => {
  const fixture = makeFixture('ai-live-switch')
  const provider = mockProvider(['The reply continued in full chat.'], 2500)
  const port = await provider.port
  writeFileSync(
    join(fixture.userData, 'config.json'),
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
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'mock-model',
        apiKeySet: false,
        historyTurns: 8
      }
    })
  )
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await page.keyboard.press('Control+Alt+A')
    const quick = page.locator('writemd-ai-quick')
    await quick.locator('textarea').fill('Answer in full chat')
    await quick.getByRole('button', { name: 'Send message' }).click()
    await expect(quick.getByRole('button', { name: 'Stop response' })).toBeVisible()
    await quick.getByRole('button', { name: 'Open full chat' }).click()
    const dock = page.locator('writemd-ai-dock')
    await expect(dock).toBeVisible()
    await expect(dock.locator('.thread')).toContainText('The reply continued in full chat.')
    await expect(dock.getByRole('button', { name: 'Stop response' })).toHaveCount(0)
    expect(provider.requests).toHaveLength(1)
    const sessions = await page.evaluate(() => window.electronAPI!.ai.listSessions())
    expect(sessions).toHaveLength(1)
    expect(sessions[0].messages).toHaveLength(2)
  } finally {
    await app.close()
    await provider.close()
  }
})

for (const selected of [false, true]) {
  test(`accept keeps the floating bar open for successive ${selected ? 'selected-text' : 'whole-note'} edits`, async () => {
    const fixture = makeFixture(`ai-accept-followup-${selected}`)
    const path = join(fixture.vault, 'README.md')
    writeFileSync(path, 'A car is red.')
    const provider = mockProvider([
      '<<<<<<< SEARCH\ncar\n=======\nvehicle\n>>>>>>> REPLACE',
      '<<<<<<< SEARCH\nvehicle\n=======\ntruck\n>>>>>>> REPLACE'
    ])
    const port = await provider.port
    const configPath = join(fixture.userData, 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.appearance.theme = selected ? 'paper' : 'graphite'
    config.ai = {
      enabled: true,
      providerId: 'lmstudio',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: 'mock-model'
    }
    writeFileSync(configPath, JSON.stringify(config))
    const app = await launch(fixture)
    try {
      const page = await firstWindow(app)
      await expect(page.locator('writemd-editor')).toBeVisible()
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
      await expect(quick.getByRole('button', { name: 'Accept' })).toBeVisible()
      await expect(quick.getByRole('button', { name: 'Stop response' })).toHaveCount(0)
      await quick.getByRole('button', { name: 'Accept' }).click()
      await expect(quick.getByRole('dialog', { name: 'Ask AI' })).toBeVisible()
      await expect(quick.getByRole('button', { name: 'Accept' })).toHaveCount(0)
      await expect(quick.locator('.reply')).toContainText('Applied the requested change.')
      await expect.poll(() => readFileSync(path, 'utf8')).toBe('A vehicle is red.')
      await quick.locator('textarea').fill('Make it more precise.')
      await quick.getByRole('button', { name: 'Send message' }).click()
      await expect(quick.getByRole('button', { name: 'Accept' })).toBeVisible()
      await expect(quick.getByRole('button', { name: 'Stop response' })).toHaveCount(0)
      const latestUser = provider.requests[1]?.messages
        .filter((message) => message.role === 'user')
        .at(-1)
      expect(JSON.stringify(latestUser?.content)).toContain('vehicle')
      await quick.getByRole('button', { name: 'Accept' }).click()
      await expect.poll(() => readFileSync(path, 'utf8')).toBe('A truck is red.')
      await expect(quick.getByRole('dialog', { name: 'Ask AI' })).toBeVisible()
      await page.screenshot({
        path: `artifacts/ui-review/ai-accept-followup-${selected ? 'selection' : 'note'}.png`
      })
    } finally {
      await app.close()
      await provider.close()
    }
  })
}

for (const theme of ['graphite', 'paper']) {
  test(`side panel hands a live edit to the floating bar in ${theme}`, async () => {
    const fixture = makeFixture(`ai-panel-live-${theme}`)
    const path = join(fixture.vault, 'README.md')
    writeFileSync(path, 'A car is red.')
    const provider = mockProvider(
      [
        '<<<<<<< SEARCH\ncar\n=======\nvehicle\n>>>>>>> REPLACE',
        '<<<<<<< SEARCH\nvehicle\n=======\ntruck\n>>>>>>> REPLACE'
      ],
      1500
    )
    const port = await provider.port
    writeFileSync(
      join(fixture.userData, 'config.json'),
      JSON.stringify({
        files: { vaultPath: fixture.vault, openTabs: [path], activeTabPath: path },
        appearance: { designVersion: 1, theme, panelOrientation: 'vertical' },
        editor: { autoSave: false },
        ai: {
          enabled: true,
          providerId: 'lmstudio',
          baseUrl: `http://127.0.0.1:${port}/v1`,
          model: 'mock-model'
        }
      })
    )
    const app = await launch(fixture)
    try {
      const page = await firstWindow(app)
      await resizeWindow(app, theme === 'paper' ? 800 : 1200, 720)
      await expect(page.locator('writemd-editor')).toBeVisible()
      // Committed AI edits also refresh when the OS watcher delivers no event.
      await page.evaluate((path) => window.electronAPI!.file.unwatch(path), path)
      await page.keyboard.press('Control+j')
      const dock = page.locator('writemd-ai-dock')
      const handoff = dock.getByRole('button', { name: 'Open in floating bar' })
      await expect(handoff).toBeVisible()
      const dockBounds = (await dock.boundingBox())!
      const buttonBounds = (await handoff.boundingBox())!
      expect(buttonBounds.x + buttonBounds.width).toBeLessThanOrEqual(
        dockBounds.x + dockBounds.width
      )
      await page.screenshot({ path: `artifacts/ui-review/ai-panel-floating-action-${theme}.png` })
      await dock.locator('textarea').fill('Replace car with vehicle.')
      await dock.locator('textarea').press('Enter')
      await expect(dock.getByRole('button', { name: 'Stop response' })).toBeVisible()
      await handoff.click()
      const quick = page.locator('writemd-ai-quick')
      await expect(dock).toHaveCount(0)
      await expect(quick.getByRole('dialog', { name: 'Ask AI' })).toBeVisible()
      await expect.poll(() => readFileSync(path, 'utf8')).toBe('A vehicle is red.')
      await expect(page.locator('writemd-editor .cm-content')).toContainText('A vehicle is red.')
      await expect(quick.getByRole('button', { name: 'Stop response' })).toHaveCount(0)
      expect(provider.requests).toHaveLength(1)
      const before = await page.evaluate(() => window.electronAPI!.ai.listSessions())
      await quick.locator('textarea').fill('Replace vehicle with truck.')
      await quick.locator('textarea').press('Enter')
      await expect(quick.getByRole('button', { name: 'Accept', exact: true })).toBeVisible()
      expect(JSON.stringify(provider.requests[1].messages.at(-1))).toContain('A vehicle is red.')
      await quick.getByRole('button', { name: 'Accept', exact: true }).click()
      await expect(quick.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0)
      expect(readFileSync(path, 'utf8')).toBe('A truck is red.')
      await expect(page.locator('writemd-editor .cm-content')).toContainText('A truck is red.')
      const after = await page.evaluate(() => window.electronAPI!.ai.listSessions())
      expect(after).toHaveLength(1)
      expect(after[0].id).toBe(before[0].id)
      await page.screenshot({ path: `artifacts/ui-review/ai-panel-floating-live-${theme}.png` })
    } finally {
      await app.close()
      await provider.close()
    }
  })
}

test('writing a Rust article fills an empty note through the floating bar and side panel', async () => {
  const fixture = makeFixture('ai-article')
  const floatingPath = join(fixture.userData, 'Rust-floating.md')
  const panelPath = join(fixture.userData, 'Rust-panel.md')
  writeFileSync(floatingPath, '')
  writeFileSync(panelPath, '')
  const article =
    '# Rust\n\nRust uses ownership and borrowing to manage memory.\n\nIts compiler checks how values are used before a program runs.'
  const edit = `<<<<<<< SEARCH\n=======\n${article}\n>>>>>>> REPLACE`
  const provider = mockProvider([article, edit, edit])
  const port = await provider.port
  writeFileSync(
    join(fixture.userData, 'config.json'),
    JSON.stringify({
      files: {
        vaultPath: fixture.vault,
        openTabs: [floatingPath, panelPath],
        activeTabPath: floatingPath
      },
      appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical' },
      editor: { autoSave: false },
      ai: {
        enabled: true,
        providerId: 'lmstudio',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'mock-model',
        apiKeySet: false,
        historyTurns: 8
      }
    })
  )
  const prompt = 'please write an article on rust and please use the unslop skill.'
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await page.keyboard.press('Control+Alt+A')
    const quick = page.locator('writemd-ai-quick')
    await quick.locator('textarea').fill(prompt)
    await quick.getByRole('button', { name: 'Send message' }).click()
    await expect(quick.locator('.suggestion .replacement')).toContainText(article)
    await expect(quick.getByRole('button', { name: 'Stop response' })).toHaveCount(0)
    expect(provider.requests).toHaveLength(2)
    expect(readFileSync(floatingPath, 'utf8')).toBe('')
    await quick.getByRole('button', { name: 'Accept' }).click()
    await expect.poll(() => readFileSync(floatingPath, 'utf8')).toBe(article)
    await page.screenshot({ path: 'artifacts/ui-review/ai-article-floating-saved.png' })

    await page.getByRole('tab', { name: /Rust-panel.md/ }).click()
    await page.keyboard.press('Control+j')
    const dock = page.locator('writemd-ai-dock')
    await dock.locator('textarea').fill(prompt)
    await dock.locator('textarea').press('Enter')
    await expect.poll(() => readFileSync(panelPath, 'utf8')).toBe(article)
    await expect(page.locator('writemd-editor .cm-content')).toContainText('Rust uses ownership')
    await page.screenshot({ path: 'artifacts/ui-review/ai-article-side-panel-saved.png' })
    expect(readFileSync(floatingPath, 'utf8')).toBe(article)
  } finally {
    await app.close()
    await provider.close()
  }
})

test('the bar centres on the document, stays inside it, and takes a markdown reply', async () => {
  const markdown = [
    '# Release plan',
    '',
    '## Next steps',
    '',
    '- Ship the prompt bar',
    '- Test with long documents',
    '- Write the changelog',
    '',
    'See `docs/phases.md` for the rest.'
  ].join('\n')
  const provider = mockProvider([markdown])
  const port = await provider.port
  const fixture = makeFixture('ai-quick-bar')
  writeFileSync(
    join(fixture.userData, 'config.json'),
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
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'mock-model',
        apiKeySet: false,
        historyTurns: 8,
        cachedModels: ['mock-model']
      }
    })
  )
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await resizeWindow(app, 1000, 720)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await page.locator('writemd-sidebar').locator('writemd-icon-button.assistant').click()
    const quick = page.locator('writemd-ai-quick')
    await expect(quick.getByRole('dialog', { name: 'Ask AI' })).toBeVisible()
    await quick.locator('writemd-ai-composer textarea').fill('What is next?')
    await quick.locator('writemd-ai-composer textarea').press('Enter')
    await expect(quick.locator('.output')).toBeVisible()
    await expect(quick.locator('.reply h1')).toHaveText('Release plan')
    await expect(quick.locator('.reply h2')).toHaveText('Next steps')
    await expect(quick.locator('.reply li')).toHaveCount(3)
    await expect(quick.locator('.reply code')).toHaveText('docs/phases.md')
    await page.screenshot({ path: 'artifacts/ui-review/ai-quick-reply.png' })

    // A reply is prose, so raw markdown must not leak through as text.
    expect(await quick.locator('.reply').innerText()).not.toContain('# Release plan')

    // The bar belongs to the note, so a side panel narrows it rather than the
    // bar sitting across the panel it was supposed to sit over.
    await page.keyboard.press('Control+Alt+S')
    await expect(page.locator('writemd-editor writemd-panel[slot="auxiliary"]')).toBeVisible()
    await expect(quick.getByRole('dialog', { name: 'Ask AI' })).toBeVisible()
    const pane = (await page.locator('writemd-editor writemd-panel[slot="primary"]').boundingBox())!
    const split = (await geometry(page)).bar
    expect(split.x).toBeGreaterThanOrEqual(pane.x - 1)
    expect(split.x + split.width).toBeLessThanOrEqual(pane.x + pane.width + 1)
    await page.screenshot({ path: 'artifacts/ui-review/ai-quick-split.png' })
    await page.keyboard.press('Control+Alt+S')
    await expect(page.locator('writemd-editor writemd-panel[slot="auxiliary"]')).toHaveCount(0)

    await page.evaluate(() =>
      (
        document.querySelector('writemd-app') as unknown as { settingsStore: SettingsStore }
      ).settingsStore.set('appearance.panelOrientation', 'horizontal')
    )
    const toolbarAi = page.locator('writemd-top-bar writemd-icon-button.assistant')
    await expect(toolbarAi).toBeVisible()
    // The same conversation survives the switch: the bar was opened from the
    // sidebar icon, and the toolbar icon now means the same thing.
    await expect(quick.getByRole('dialog', { name: 'Ask AI' })).toBeVisible()
    await toolbarAi.click()
    await expect(page.locator('writemd-ai-quick')).toHaveCount(0)
    await toolbarAi.click()
    await expect(quick.getByRole('dialog', { name: 'Ask AI' })).toBeVisible()
    await expect(page.locator('writemd-ai-dock')).toHaveCount(0)
    const { bar } = await geometry(page)
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(Math.abs(bar.x + bar.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1)
    expect(bar.x + bar.width).toBeLessThanOrEqual(viewport.width)
    await page.screenshot({ path: 'artifacts/ui-review/ai-quick-toolbar.png' })

    // Clicking into the note keeps writing and does not dismiss the bar.
    await page.locator('#primary-cm-wrapper .cm-content').click()
    await expect(page.locator('writemd-ai-quick')).toHaveCount(1)
    // The icon closes it, which is the only click that does.
    await toolbarAi.click()
    await expect(page.locator('writemd-ai-quick')).toHaveCount(0)
  } finally {
    await app.close()
    await provider.close()
  }
})

test('the bar shows the thinking state, stops, and matches the panel prompt in a small light window', async () => {
  const provider = mockProvider([], 4000)
  const port = await provider.port
  const fixture = makeFixture('ai-quick-thinking')
  writeFileSync(
    join(fixture.userData, 'config.json'),
    JSON.stringify({
      files: {
        vaultPath: fixture.vault,
        openTabs: [join(fixture.vault, 'README.md')],
        activeTabPath: join(fixture.vault, 'README.md')
      },
      appearance: { designVersion: 1, theme: 'paper', panelOrientation: 'vertical' },
      ai: {
        enabled: true,
        providerId: 'lmstudio',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'mock-model',
        apiKeySet: false,
        historyTurns: 8,
        cachedModels: ['mock-model']
      }
    })
  )
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await resizeWindow(app, 820, 600)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await page.locator('writemd-sidebar').locator('writemd-icon-button.assistant').click()
    const quick = page.locator('writemd-ai-quick')
    await expect(quick.getByRole('dialog', { name: 'Ask AI' })).toBeVisible()

    // The bar and the reply card stay inside a small window.
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    for (const selector of ['.panel', '.panel .field']) {
      const box = (await quick.locator(selector).boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    }
    await page.screenshot({ path: 'artifacts/ui-review/ai-quick-paper-idle.png' })

    await quick.locator('writemd-ai-composer textarea').fill('Summarise this note.')
    await quick.locator('writemd-ai-composer textarea').press('Enter')
    // While the turn runs the bar says so and offers a stop, and does not
    // pretend to be streaming prose that is really the edit protocol.
    // The bar becomes the Thinking state: no prompt, no reply card, just the stop
    // control in the row where the prompt was.
    await expect(quick.locator('.waiting')).toBeVisible()
    await expect(quick.getByRole('button', { name: 'Stop response' })).toBeVisible()
    await expect(quick.locator('writemd-ai-composer textarea')).toBeHidden()
    await expect(quick.locator('.output')).toHaveCount(0)
    await expect(quick.locator('.reply')).toHaveCount(0)
    const thinkingBox = (await quick.locator('.waiting').boundingBox())!
    const barBox = (await quick.locator('.panel .field').boundingBox())!
    // Inside the bar, not floating in a card above it.
    expect(thinkingBox.y).toBeGreaterThanOrEqual(barBox.y - 1)
    expect(thinkingBox.y + thinkingBox.height).toBeLessThanOrEqual(barBox.y + barBox.height + 1)
    await page.screenshot({ path: 'artifacts/ui-review/ai-quick-paper-thinking.png' })

    // Stopping cancels the turn and leaves the bar ready to try again, rather
    // than closing on a request the user may want to rewrite.
    await quick.getByRole('button', { name: 'Stop response' }).click()
    await expect(quick.locator('.waiting')).toHaveCount(0)
    await expect(quick.getByRole('button', { name: 'Send message' })).toBeVisible()
    await expect(page.locator('writemd-ai-quick')).toHaveCount(1)
    await page.screenshot({ path: 'artifacts/ui-review/ai-quick-paper-stopped.png' })
    // Escape puts it away; the handle stays where the bar was.
    await page.keyboard.press('Escape')
    await expect(quick.locator('.handle')).toBeVisible()
    await expect(quick.locator('.panel')).toBeHidden()
    await expect(page.locator('writemd-ai-quick')).toHaveCount(1)
    await page.screenshot({ path: 'artifacts/ui-review/ai-quick-paper-collapsed.png' })
    await quick.locator('.handle').click()
    await expect(quick.locator('.panel')).toBeVisible()
    // A second Escape, with nothing left to put away, closes it.
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.locator('writemd-ai-quick')).toHaveCount(0)
  } finally {
    await app.close()
    await provider.close()
  }
})
