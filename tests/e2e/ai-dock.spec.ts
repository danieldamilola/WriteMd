import { test, expect, type Page } from '@playwright/test'
import { createServer } from 'http'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow, resizeWindow } from './fixtures'

/**
 * Enabling the assistant exposes its controls without opening the dock.
 * Disabled profiles keep the panel unavailable.
 */
test.setTimeout(120000)

/**
 * A profile pointed at a mock provider, plus the vault path so a test can read
 * what actually landed on disk.
 */
async function withProvider(answers: string[]): Promise<{
  page: Page
  vault: string
  close: () => Promise<void>
}> {
  const scripted = [...answers]
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
        void body
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: scripted.shift() ?? 'Done.' } }] })}\n\n`
        )
        res.end('data: [DONE]\n\n')
      })
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Provider did not start')

  const fixture = makeFixture('ai-bar-vault')
  writeFileSync(
    join(fixture.userData, 'config.json'),
    JSON.stringify({
      files: {
        vaultPath: fixture.vault,
        recentFiles: [],
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
        cachedModels: ['mock-model']
      }
    }),
    'utf-8'
  )
  const app = await launch(fixture)
  const page = await firstWindow(app)
  await resizeWindow(app, 1400, 900)
  await expect(page.locator('writemd-editor')).toBeVisible()
  return {
    page,
    vault: fixture.vault,
    close: async () => {
      await app.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

async function open(name: string, aiEnabled: boolean): Promise<Page> {
  const fixture = makeFixture(`ai-${name}`)
  const config = {
    files: {
      vaultPath: fixture.vault,
      recentFiles: [],
      openTabs: [join(fixture.vault, 'README.md')],
      activeTabPath: join(fixture.vault, 'README.md')
    },
    appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical' },
    ai: {
      enabled: aiEnabled,
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKeySet: false,
      historyTurns: 8,
      cachedModels: []
    }
  }
  writeFileSync(join(fixture.userData, 'config.json'), JSON.stringify(config, null, 2), 'utf-8')
  const app = await launch(fixture)
  const page = await firstWindow(app)
  await resizeWindow(app, 1400, 900)
  await page.waitForTimeout(1600)
  return page
}

test('the bar edits a second file in the vault once the change is accepted', async () => {
  const { page, vault, close } = await withProvider([
    '<<<<<<< SEARCH path="PRD.md"\nE2E fixture.\n=======\nREWRITTEN BY THE BAR\n>>>>>>> REPLACE'
  ])
  try {
    const target = join(vault, 'PRD.md')
    await page.keyboard.press('Control+Alt+A')
    const bar = page.locator('writemd-ai-quick')
    await expect(bar.getByRole('dialog', { name: 'Ask AI' })).toBeVisible()
    await bar.locator('writemd-ai-composer textarea').fill('Rewrite the PRD too')
    await bar.locator('writemd-ai-composer textarea').press('Enter')

    // Not the note on screen, and it is offered rather than written.
    await expect(bar.locator('.suggestion')).toBeVisible({ timeout: 20000 })
    expect(readFileSync(target, 'utf8')).toBe('# PRD.md\n\nE2E fixture.\n')
    await page.screenshot({ path: 'artifacts/ui-review/ai-bar-vault-write.png' })

    await bar.getByRole('button', { name: 'Accept', exact: true }).click()
    // The user accepted it, so it is on disk, and the file it belonged to.
    await expect.poll(() => readFileSync(target, 'utf8')).toContain('REWRITTEN BY THE BAR')
    // The open note is untouched: only the file that was named.
    await expect(page.locator('#primary-cm-wrapper .cm-content')).toContainText('E2E fixture.')
  } finally {
    await close()
  }
})

test('a saved conversation can be deleted from the history menu', async () => {
  // Seeded rather than produced: this is about the delete control, and the
  // conversation only needs to exist, not to have been earned from a provider.
  const fixture = makeFixture('ai-history-delete')
  const config = {
    files: {
      vaultPath: fixture.vault,
      recentFiles: [],
      openTabs: [join(fixture.vault, 'README.md')],
      activeTabPath: join(fixture.vault, 'README.md')
    },
    appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical' },
    ai: { enabled: true, providerId: 'openai', model: 'gpt-4o-mini', apiKeySet: false }
  }
  writeFileSync(join(fixture.userData, 'config.json'), JSON.stringify(config, null, 2), 'utf-8')
  writeFileSync(
    join(fixture.userData, 'ai-sessions.json'),
    JSON.stringify([
      {
        id: 'keep-me',
        title: 'A conversation to keep',
        providerId: 'openai',
        model: 'gpt-4o-mini',
        contextFile: null,
        createdAt: 1,
        updatedAt: 2,
        messages: [
          { role: 'user', content: 'A conversation to keep' },
          { role: 'assistant', content: 'Kept.' }
        ]
      },
      {
        id: 'delete-me',
        title: 'A conversation to delete',
        providerId: 'openai',
        model: 'gpt-4o-mini',
        contextFile: null,
        createdAt: 1,
        updatedAt: 1,
        messages: [
          { role: 'user', content: 'A conversation to delete' },
          { role: 'assistant', content: 'Deleted.' }
        ]
      }
    ]),
    'utf-8'
  )
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await resizeWindow(app, 1400, 900)
    await page.keyboard.press('Control+Alt+Shift+A')
    const dock = page.locator('writemd-ai-dock')
    await expect(dock).toBeVisible()
    const history = dock.locator('writemd-ai-history-picker')
    await history.getByLabel('Conversation history').click()
    const row = history.getByRole('menuitem', { name: 'A conversation to delete', exact: true })
    await expect(row).toBeVisible()
    await expect(
      history.getByRole('menuitem', { name: 'A conversation to keep', exact: true })
    ).toBeVisible()

    // Delete sits beside the row, not inside it: a nested button would take the
    // click as an instruction to open the conversation instead.
    await row
      .locator('xpath=..')
      .getByRole('button', { name: /^Delete conversation/ })
      .click()
    // The menu stays open, so tidying up more than one is not five reopenings.
    await expect(
      history.getByRole('menuitem', { name: 'A conversation to delete', exact: true })
    ).toHaveCount(0)
    await expect(
      history.getByRole('menuitem', { name: 'A conversation to keep', exact: true })
    ).toBeVisible()
    await page.screenshot({ path: 'artifacts/ui-review/ai-history-delete.png' })

    // And it is gone from disk, not just from the list.
    await expect
      .poll(() => JSON.parse(readFileSync(join(fixture.userData, 'ai-sessions.json'), 'utf-8')))
      .toHaveLength(1)
  } finally {
    await app.close()
  }
})

test('the panel opens and closes with motion, and Ctrl+J is a shortcut for it', async () => {
  const { page, close } = await withProvider([])
  try {
    // Full motion, so the animation is actually there to observe.
    await page.evaluate(() =>
      (
        document.querySelector('writemd-app') as unknown as {
          settingsStore: { set(key: string, value: unknown): void }
        }
      ).settingsStore.set('appearance.motion', 'full')
    )
    await page.keyboard.press('Control+j')
    const column = page.locator('writemd-editor .ai-column')
    await expect(page.locator('writemd-ai-dock')).toBeVisible()
    await expect(column).toHaveClass(/entering/)

    // The panel is held mounted for its exit rather than blinking out.
    await page.locator('writemd-ai-dock').getByLabel('Close assistant').click()
    await expect(column).toHaveClass(/leaving/)
    await expect(page.locator('writemd-ai-dock')).toHaveCount(0)
    await expect(column).toHaveCount(0)

    // And it comes back to a resting state, not a re-run of the entrance.
    await page.keyboard.press('Control+j')
    await expect(page.locator('writemd-ai-dock')).toBeVisible()
    await page.screenshot({ path: 'artifacts/ui-review/ai-panel-open.png' })
  } finally {
    await close()
  }
})

test('reduced motion resolves the panel instantly', async () => {
  const { page, close } = await withProvider([])
  try {
    await page.evaluate(() =>
      (
        document.querySelector('writemd-app') as unknown as {
          settingsStore: { set(key: string, value: unknown): void }
        }
      ).settingsStore.set('appearance.motion', 'reduced')
    )
    await page.keyboard.press('Control+j')
    await expect(page.locator('writemd-ai-dock')).toBeVisible()
    await expect(page.locator('writemd-editor .ai-column')).toHaveCSS('animation-name', 'none')
    await page.locator('writemd-ai-dock').getByLabel('Close assistant').click()
    await expect(page.locator('writemd-ai-dock')).toHaveCount(0)
  } finally {
    await close()
  }
})

test('the dock is hidden until it is asked for', async () => {
  const page = await open('closed', true)
  await expect(page.locator('writemd-ai-dock')).toHaveCount(0)

  await page.keyboard.press('Control+Alt+Shift+A')
  await page.waitForTimeout(600)
  await expect(page.locator('writemd-ai-dock')).toHaveCount(1)

  // And it closes again, from its own close control.
  await page.locator('writemd-ai-dock').getByLabel('Close assistant').click()
  await page.waitForTimeout(400)
  await expect(page.locator('writemd-ai-dock')).toHaveCount(0)
  await page.context().close()
})

test('the dock narrows the editor rather than covering it', async () => {
  const page = await open('layout', true)
  // boundingBox, not page.evaluate: the dock lives inside the editor's shadow
  // root, and document.querySelector does not pierce one - which reads as the
  // element being zero-width when it is in fact rendering.
  const editorWidth = async (): Promise<number> =>
    (await page.locator('writemd-editor .body-area').boundingBox())?.width ?? 0

  const before = await editorWidth()
  await page.keyboard.press('Control+Alt+Shift+A')
  await page.waitForTimeout(800)
  const after = await editorWidth()
  const dock = await page.locator('writemd-ai-dock').boundingBox()

  expect(dock?.width ?? 0).toBeGreaterThan(200)
  // The editor gave up width rather than being overlapped.
  expect(after).toBeLessThan(before)
  expect(after).toBeGreaterThan(0)
  await page.screenshot({ path: 'artifacts/ui-review/ai-dock.png' })
  await page.context().close()
})

test('the assistant stays hidden while it is switched off in settings', async () => {
  const page = await open('disabled', false)
  await page.keyboard.press('Control+Alt+Shift+A')
  await page.waitForTimeout(600)
  // The command is still bound, but there is nothing to drive without a provider.
  await expect(page.locator('writemd-ai-dock')).toHaveCount(0)
  await page.context().close()
})

test('AI settings expose provider, model discovery, and API key controls', async () => {
  const page = await open('settings', true)
  await page.keyboard.press('Control+,')
  await page.waitForTimeout(700)
  await page
    .locator('writemd-settings-modal')
    .getByRole('button', { name: 'AI assistant', exact: true })
    .click()
  await page.waitForTimeout(500)

  // The Fetch button is what the user asked to keep from the old panel.
  await expect(page.getByRole('button', { name: 'Fetch models' })).toBeVisible()
  // A local provider is offered, and needs no key. Scoped to the select itself:
  // getByLabel on a WebAwesome select also matches the listbox it labels.
  await expect(page.locator('wa-select[aria-label="Provider"]')).toHaveCount(1)
  await expect(page.locator('wa-select[aria-label="Model"]')).toHaveCount(1)
  await expect(page.getByLabel('API Key')).toBeVisible()
  await page.screenshot({ path: 'artifacts/ui-review/ai-settings.png' })
  await page.context().close()
})
