import { test, expect } from '@playwright/test'
import { createServer, type Server } from 'http'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow, resizeWindow } from './fixtures'

/**
 * The whole chain, against a provider that is actually a server.
 *
 * Every other AI test checks a piece: that the regex parses, that the journal
 * restores, that the dock renders. None of them proves that a request leaves
 * the app, comes back as edit blocks, and lands in a file. That is the one path
 * a user actually exercises, and the one where every layer can be individually
 * green while the feature does nothing.
 */

test.setTimeout(120000)

/** A minimal OpenAI-compatible server: a model list and a streamed reply. */
async function startProvider(reply: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }, { id: 'mock-model-fast' }] }))
      return
    }
    if (req.url?.includes('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      // Streamed in fragments, because a single chunk would not exercise the
      // framer's boundary handling - which is where SSE bugs actually live.
      for (const piece of reply.match(/.{1,7}/gs) ?? []) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`)
      }
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

test('a requested change lands in the file and can be undone', async () => {
  const reply = [
    'Here you go.',
    '<<<<<<< SEARCH path="README.md"',
    'E2E fixture.',
    '=======',
    'Rewritten by the assistant.',
    '>>>>>>> REPLACE'
  ].join('\n')

  const provider = await startProvider(reply)
  const fixture = makeFixture('ai-turn')
  const target = join(fixture.vault, 'README.md')

  writeFileSync(
    join(fixture.userData, 'config.json'),
    JSON.stringify(
      {
        files: {
          vaultPath: fixture.vault,
          recentFiles: [],
          openTabs: [target],
          activeTabPath: target
        },
        appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical' },
        ai: {
          enabled: true,
          providerId: 'lmstudio',
          baseUrl: provider.url,
          model: 'mock-model',
          apiKeySet: false,
          historyTurns: 8,
          cachedModels: []
        }
      },
      null,
      2
    ),
    'utf-8'
  )

  const app = await launch(fixture)
  const page = await firstWindow(app)
  await resizeWindow(app, 1400, 900)
  await page.waitForTimeout(1600)

  expect(readFileSync(target, 'utf-8')).toContain('E2E fixture.')

  await page.keyboard.press('Control+Alt+Shift+A')
  await page.waitForTimeout(700)
  const dock = page.locator('writemd-ai-dock')
  await expect(dock).toHaveCount(1)

  const composer = dock.locator('textarea')
  await composer.fill('rewrite the first line')
  await composer.press('Enter')
  await page.waitForTimeout(2500)

  // The edit reached the file on disk. The journal is not a preview: the change
  // is live, which is the whole point of the design and the reason undo is
  // load-bearing rather than a nicety.
  expect(readFileSync(target, 'utf-8')).toContain('Rewritten by the assistant.')

  // And it is listed, with its own undo.
  const undo = dock.getByRole('button', { name: /Undo the change to/ }).first()
  await expect(undo).toBeVisible()
  await undo.click()
  await page.waitForTimeout(800)

  expect(readFileSync(target, 'utf-8')).toContain('E2E fixture.')
  expect(readFileSync(target, 'utf-8')).not.toContain('Rewritten by the assistant.')

  await page.screenshot({ path: 'artifacts/ui-review/ai-turn.png' })
  await app.close()
  await provider.close()
})

test('a change that does not match leaves the file alone', async () => {
  // The rule that makes auto-apply survivable. A SEARCH the model got wrong
  // means its picture of the file is stale; writing anyway produces a document
  // missing that edit, which looks like success.
  const reply = [
    '<<<<<<< SEARCH path="README.md"',
    'text that is not in the file at all',
    '=======',
    'replacement',
    '>>>>>>> REPLACE'
  ].join('\n')

  const provider = await startProvider(reply)
  const fixture = makeFixture('ai-mismatch')
  const target = join(fixture.vault, 'README.md')
  writeFileSync(
    join(fixture.userData, 'config.json'),
    JSON.stringify(
      {
        files: {
          vaultPath: fixture.vault,
          recentFiles: [],
          openTabs: [target],
          activeTabPath: target
        },
        appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical' },
        ai: {
          enabled: true,
          providerId: 'lmstudio',
          baseUrl: provider.url,
          model: 'mock-model',
          apiKeySet: false,
          historyTurns: 8,
          cachedModels: []
        }
      },
      null,
      2
    ),
    'utf-8'
  )

  const app = await launch(fixture)
  const page = await firstWindow(app)
  await resizeWindow(app, 1400, 900)
  await page.waitForTimeout(1600)

  await page.keyboard.press('Control+Alt+Shift+A')
  await page.waitForTimeout(700)
  const dock = page.locator('writemd-ai-dock')
  const composer = dock.locator('textarea')
  await composer.fill('do something impossible')
  await composer.press('Enter')
  await page.waitForTimeout(2500)

  // Untouched, and the user is told why rather than left with a file that
  // silently lost an edit.
  expect(readFileSync(target, 'utf-8')).toContain('E2E fixture.')
  expect(readFileSync(target, 'utf-8')).not.toContain('replacement')
  await expect(dock.locator('.skipped, [class*="skip"]').first()).toBeVisible()

  await app.close()
  await provider.close()
})

test('the Fetch button lists what the key can reach', async () => {
  const provider = await startProvider('unused')
  const fixture = makeFixture('ai-fetch')
  writeFileSync(
    join(fixture.userData, 'config.json'),
    JSON.stringify(
      {
        files: { vaultPath: fixture.vault, recentFiles: [], openTabs: [], activeTabPath: null },
        appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical' },
        ai: {
          enabled: true,
          providerId: 'openai',
          baseUrl: provider.url,
          model: '',
          apiKeySet: false,
          historyTurns: 8,
          cachedModels: []
        }
      },
      null,
      2
    ),
    'utf-8'
  )

  const app = await launch(fixture)
  const page = await firstWindow(app)
  await page.waitForTimeout(1500)
  await page.keyboard.press('Control+,')
  await page.waitForTimeout(700)
  await page
    .locator('writemd-settings-modal')
    .getByRole('button', { name: 'AI assistant', exact: true })
    .click()
  await page.waitForTimeout(500)

  await page.getByRole('button', { name: 'Fetch models' }).click()
  await page.waitForTimeout(2000)

  // The models the endpoint reported, and the first one selected because there
  // was no model before.
  const modelSelect = page.locator('wa-select[aria-label="Model"]')
  await expect(modelSelect.locator('wa-option')).toHaveCount(2)
  await expect(modelSelect).toContainText('mock-model')

  const persisted = JSON.parse(readFileSync(join(fixture.userData, 'config.json'), 'utf-8'))
  expect(persisted.ai.cachedModels).toEqual(['mock-model', 'mock-model-fast'])
  expect(persisted.ai.model).toBe('mock-model')

  if (existsSync(join(fixture.userData, 'ai-journal.json'))) {
    // No turns were run in this spec, so the journal should not exist at all.
    expect(readFileSync(join(fixture.userData, 'ai-journal.json'), 'utf-8')).toBe(
      '{"version":1,"entries":[]}'
    )
  }

  await app.close()
  await provider.close()
})
