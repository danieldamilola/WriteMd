import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'http'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { firstWindow, launch, makeFixture } from './fixtures'

const ANSWER =
  'Here is a **short** answer that arrives in several pieces, so the panel has something to reveal.'

/** Words per fake chunk. Small enough to see the reveal, large enough to be quick. */
const CHUNK = 3

/**
 * The AI panel, driven end to end.
 *
 * The provider is a fake Ollama on 127.0.0.1:11434 speaking real SSE, which is
 * the URL `ai-providers.ts` already points Ollama at. Everything is therefore
 * exercised: the composer, `net:chat-stream`, the SSE parser, the provider
 * adapter, the streaming message, the word reveal and the settled transcript.
 * No API key and no network are involved.
 *
 * The bridge itself cannot be stubbed from the page: `contextBridge` hands the
 * renderer a proxy, and assigning to one of its properties silently does
 * nothing. A server on the port the adapter already uses is the seam that
 * actually holds.
 */
test.describe('AI panel', () => {
  let server: Server
  let app: ElectronApplication | undefined
  let window: Page

  /** Kept so the model-chip test can assert what was persisted. */
  let userData: string

  test.beforeAll(async () => {
    server = await startFakeOllama(ANSWER)

    const fixture = makeFixture('ai-panel')
    userData = fixture.userData
    // Ollama counts as configured with no API key, so the panel mounts without a
    // settings round trip and without touching the developer's real profile.
    writeFileSync(
      join(fixture.userData, 'config.json'),
      JSON.stringify({
        files: {
          vaultPath: fixture.vault,
          recentFiles: [join(fixture.vault, 'README.md')],
          openTabs: [join(fixture.vault, 'README.md')],
          activeTabPath: join(fixture.vault, 'README.md')
        },
        appearance: { designVersion: 1, theme: 'dark', panelOrientation: 'horizontal' },
        ai: { provider: 'Ollama', model: 'stub-model' }
      }),
      'utf-8'
    )
    app = await launch(fixture)
    window = await firstWindow(app)
  })

  test.afterAll(async () => {
    await app?.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  test('the composer opens with a hint naming the model', async () => {
    await openAiSurface(window)
    const panel = window.locator('writemd-ai-panel')
    await expect(panel).toBeVisible()

    const input = panel.locator('textarea.ai-input')
    await expect(input).toBeVisible()
    await expect(input).toHaveAttribute('placeholder', 'Ask anything')
    await expect(panel.locator('.ai-chip-pick')).toHaveText(/stub-model/)
    // Unarmed, not disabled: the pill becomes a stop control while busy, so it
    // cannot be a button that goes dead at that moment.
    await expect(panel.locator('button.ai-send')).not.toHaveAttribute('data-armed', '')
  })

  test('the composer grows to fit its content, and sends on Enter', async () => {
    const panel = window.locator('writemd-ai-panel')
    const input = panel.locator('textarea.ai-input')

    await input.fill('one line')
    await expect(panel.locator('button.ai-send')).toHaveAttribute('data-armed', '')
    const single = await height(input)

    await input.fill('l1\nl2\nl3\nl4')
    expect(await height(input)).toBeGreaterThan(single)

    // Ten lines: capped, so a pasted document does not take over the panel.
    await input.fill('l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10')
    const capped = await height(input)
    expect(capped).toBeGreaterThan(single)
    expect(capped).toBeLessThanOrEqual(140)

    // Shift+Enter is a newline, not a send: the text stays in the box and
    // nothing reaches the transcript.
    await input.fill('first')
    await input.press('Shift+Enter')
    await expect(input).toHaveValue('first\n')
    await expect(panel.locator('.chat-log')).not.toContainText('first')
  })

  test('a sent prompt reaches the provider and its reply comes back', async () => {
    const panel = window.locator('writemd-ai-panel')
    const log = panel.locator('.chat-log')

    await panel.locator('textarea.ai-input').fill('ship it')
    await panel.locator('textarea.ai-input').press('Enter')

    // Enter clears the box and the prompt lands in the transcript.
    await expect(panel.locator('textarea.ai-input')).toHaveValue('')
    await expect(log).toContainText('ship it')

    // The reply arrives as rendered markdown, and the composer unlocks. The
    // fast provider settles before this can observe it mid-stream; the reveal
    // itself is checked below against a slow one.
    await expect(log.locator('strong')).toHaveText('short', { timeout: 15000 })
    await expect(log).toContainText('Here is a short answer')
    await expect(panel.locator('textarea.ai-input')).toBeEnabled({ timeout: 15000 })
    // Settled messages are not stream boxes: there is nothing left to reveal.
    expect(await log.locator('.stream').count()).toBe(0)
  })

  test('a streamed reply is revealed word by word, not dumped at once', async () => {
    const panel = window.locator('writemd-ai-panel')
    const log = panel.locator('.chat-log')

    const hidden = async (): Promise<number> =>
      log.evaluate((el) => el.querySelectorAll('.stream-w:not(.is-in)').length)

    // Nothing is mid-reveal once the previous reply settled: the finished
    // message has no .stream-w spans at all.
    expect(await hidden()).toBe(0)
    expect(await log.locator('.stream-w').count()).toBe(0)

    // A slow provider this time, so the reveal is observable mid-flight rather
    // than after the fact.
    server.closeAllConnections?.()
    await stopServer(server)
    server = await startFakeOllama(ANSWER, { wordDelayMs: 40 })

    await panel.locator('textarea.ai-input').fill('show me the reveal')
    await panel.locator('textarea.ai-input').press('Enter')

    // Words are wrapped and at least one is still hidden while the stream runs.
    await expect
      .poll(async () => log.locator('.stream-w').count(), { timeout: 15000 })
      .toBeGreaterThan(3)
    expect(await hidden()).toBeGreaterThan(0)

    // The nesting regression: re-wrapping on every render doubled the span count
    // each pass until the renderer hung. A slow stream renders many times, so
    // this is where it would show.
    expect(await log.locator('.stream-w .stream-w').count()).toBe(0)

    // The reveal finishes on its own, with no further updates from the server.
    await expect.poll(hidden, { timeout: 15000 }).toBe(0)

    // And the transcript ends up with the elapsed time and the full answer, as
    // rendered markdown: the `**` around "short" became a <strong>.
    await expect(log).toContainText('Thought for')
    const answers = log.locator('.bubble.assistant')
    await expect(answers.last()).toContainText('Here is a short answer')
    await expect(answers.last().locator('strong')).toHaveText('short')
  })

  test('the log stays scrolled to the newest message', async () => {
    const panel = window.locator('writemd-ai-panel')
    // Polled, not sampled once: the panel holds the live thought line briefly
    // past the end of a reply so its settle event can fire, and removing it
    // changes the scroll height after the last render. The log re-scrolls when
    // that happens, so the settled position is what has to hold.
    await expect
      .poll(
        () =>
          panel
            .locator('.chat-log')
            .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
        { timeout: 5000 }
      )
      .toBeLessThan(4)
  })

  test('the model chip lists what the provider reports, and switching persists', async () => {
    // The fake provider's /v1/models, so this is the real fetch path: the chip
    // opens only models this key can actually reach.
    const panel = window.locator('writemd-ai-panel')
    const chip = panel.locator('.ai-chip-pick')

    await chip.click()
    const list = panel.locator('.ai-pop-item')
    await expect(list.first()).toBeVisible()
    await expect(list).toHaveCount(3)

    const target = 'stub-model-mini'
    await list.filter({ hasText: target }).click()
    await expect(panel.locator('.ai-pop')).toHaveCount(0)
    await expect(chip).toHaveText(new RegExp(target))

    // Persisted, so a reopen does not silently fall back to the old model.
    const stored = JSON.parse(readFileSync(join(userData, 'config.json'), 'utf-8')) as {
      ai: { model: string }
    }
    expect(stored.ai.model).toBe(target)
  })

  test('the send pill becomes a stop control that really cancels', async () => {
    const panel = window.locator('writemd-ai-panel')
    const send = panel.locator('button.ai-send')

    // A slow provider, so the reply is still arriving when stop is pressed.
    server.closeAllConnections?.()
    await stopServer(server)
    server = await startFakeOllama(ANSWER, { wordDelayMs: 40 })

    await panel.locator('textarea.ai-input').fill('stop me halfway')
    await panel.locator('textarea.ai-input').press('Enter')

    await expect(send).toHaveAttribute('data-busy', '')
    await expect(send).toHaveAttribute('aria-label', 'Stop')
    // The glyph has morphed into the square. Polled rather than sampled once,
    // because it is an animation: the arrow is still showing for the first few
    // frames after `loading` flips, and sampling immediately would only ever
    // catch the shape it started from.
    await expect
      .poll(() => panel.locator('.ai-send path').getAttribute('d'), { timeout: 15_000 })
      .toMatch(/^M12\.00 6\.00/)

    await send.click()

    // Cancelling resolves the stream rather than throwing, so the composer
    // unlocks and no error line lands in the transcript.
    await expect(panel.locator('textarea.ai-input')).toBeEnabled({ timeout: 15000 })
    await expect(panel.locator('.chat-log')).not.toContainText('Error:')
    // The partial answer is kept, not discarded.
    await expect(panel.locator('.chat-log .bubble.assistant').last()).toContainText('Here is a')
  })
})

async function height(input: ReturnType<Page['locator']>): Promise<number> {
  return input.evaluate((el) => el.getBoundingClientRect().height)
}

/**
 * Open the AI surface the way a user does: split the view, then pick AI from the
 * launcher that appears. Both steps are real clicks, so a spec that stops
 * passing means the user cannot reach the panel either.
 */
async function openAiSurface(window: Page): Promise<void> {
  if ((await window.locator('writemd-ai-panel').count()) > 0) return
  await window.locator('writemd-icon-button[title="Split view"]').click()
  const launcher = window.locator('writemd-surface-launcher')
  await expect(launcher).toBeVisible()
  await launcher.locator('.row', { hasText: 'Ai' }).first().click()
  await expect(window.locator('writemd-ai-panel')).toBeAttached()
}

/**
 * An Ollama stand-in on the port `ai-providers.ts` already uses for Ollama,
 * answering `/v1/chat/completions` with an OpenAI-shaped SSE stream.
 */
function startFakeOllama(answer: string, opts: { wordDelayMs?: number } = {}): Promise<Server> {
  const words = answer.split(' ')
  const delay = opts.wordDelayMs ?? 0

  const server = createServer((req, res) => {
    // The real Ollama tag list, so the composer's model chip exercises the same
    // fetch the app does rather than a stubbed response.
    if (req.url?.startsWith('/api/tags')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          models: [
            { name: 'stub-model' },
            { name: 'stub-model-mini' },
            { name: 'stub-model-large:latest' }
          ]
        })
      )
      return
    }
    if (!req.url?.startsWith('/v1/chat/completions')) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    const frame = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`
    const text = (content: string): string => frame({ choices: [{ delta: { content }, index: 0 }] })

    let index = 0
    const step = (): void => {
      if (index >= words.length) {
        res.write(frame({ choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] }))
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      res.write(text(words.slice(index, index + CHUNK).join(' ') + ' '))
      index += CHUNK
      setTimeout(step, delay)
    }
    step()
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(11434, '127.0.0.1', () => resolve(server))
  })
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}
