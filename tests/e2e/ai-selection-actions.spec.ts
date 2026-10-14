import { test, expect } from '@playwright/test'
import { createServer } from 'http'
import { join } from 'path'
import { writeFileSync } from 'fs'
import type { EditorView } from '@codemirror/view'
import type { FileState } from '../../src/renderer/src/state/file-state'
import { makeFixture, launch, firstWindow, resizeWindow } from './fixtures'

test.setTimeout(120000)

/**
 * Explain and Summarize go to the floating bar.
 *
 * They used to open the docked panel, which meant a question about one word
 * cost half the window and buried the document it was about. Each one now opens
 * the bar with its question already typed in.
 */
test('the text menu explains a word and summarizes a split selection through the floating bar', async () => {
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = []
  const server = createServer((req, res) => {
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }))
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
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'MOCK_ANSWER_ONLY' } }] })}\n\n`
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
  const fixture = makeFixture('ai-selection-actions')
  writeFileSync(
    join(fixture.vault, 'README.md'),
    '# Transport\n\nA car is parked.\n\nSECRET_PRIMARY_UNSELECTED\n'
  )
  const paragraph = 'A boat carries passengers across the harbor.'
  writeFileSync(
    join(fixture.vault, 'PRD.md'),
    `# Boats\n\n${paragraph}\n\nSECRET_SECONDARY_UNSELECTED\n`
  )
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
        motion: 'reduced'
      },
      ai: {
        enabled: true,
        providerId: 'lmstudio',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: 'mock-model',
        apiKeySet: false,
        historyTurns: 8
      }
    })
  )
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await resizeWindow(app, 1400, 900)
    await expect(page.locator('writemd-editor')).toBeVisible()

    const quick = page.locator('writemd-ai-quick')
    const prompt = quick.locator('writemd-ai-composer textarea')

    const openSelectionMenu = async (text: string, secondary: boolean): Promise<void> => {
      await page.locator('writemd-editor').evaluate(
        (element, { text, secondary }) => {
          const editor = element as unknown as {
            editorView: EditorView
            secondaryEditorView: EditorView
          }
          const view = secondary ? editor.secondaryEditorView : editor.editorView
          const start = view.state.doc.toString().indexOf(text)
          if (start < 0) throw new Error('Selected text is absent')
          view.dispatch({ selection: { anchor: start, head: start + text.length } })
          element
            .shadowRoot!.querySelector(secondary ? '#secondary-cm-wrapper' : '#primary-cm-wrapper')!
            .dispatchEvent(
              new MouseEvent('contextmenu', {
                clientX: 520,
                clientY: 220,
                bubbles: true,
                composed: true,
                cancelable: true
              })
            )
        },
        { text, secondary }
      )
      await expect(
        page
          .locator('writemd-text-menu')
          .getByRole('menuitem', { name: 'Explain with AI', exact: true })
      ).toBeVisible()
    }

    await openSelectionMenu('car', false)
    await page.screenshot({ path: 'artifacts/ui-review/ai-selection-menu-dark.png' })
    await page
      .locator('writemd-text-menu')
      .getByRole('menuitem', { name: 'Explain with AI', exact: true })
      .click()

    // The bar opens with its question already in it, and the panel does not.
    await expect(quick.getByRole('dialog', { name: 'Ask AI' })).toBeVisible()
    await expect(page.locator('writemd-ai-dock')).toHaveCount(0)
    await expect(prompt).toHaveValue(/Explain only the highlighted text/)
    // The placeholder carries the selection's scope, and the typed question
    // replaces it: one click, and the ask is already made.
    await expect(prompt).toHaveAttribute('placeholder', /Ask about your selection/)
    await page.screenshot({ path: 'artifacts/ui-review/ai-selection-explain-bar.png' })

    await prompt.press('Enter')
    await expect.poll(() => requests.length).toBe(1)
    await expect(quick.locator('.reply')).toContainText('MOCK_ANSWER_ONLY')
    const explain = JSON.stringify(requests[0].messages)
    expect(explain).toContain('car')
    expect(explain.toLowerCase()).toContain('explain')
    expect(explain).not.toContain('SECRET_PRIMARY_UNSELECTED')
    expect(explain).not.toContain('MOCK_ANSWER_ONLY')
    expect(requests[0].messages.filter((message) => message.role === 'user')).toHaveLength(1)
    await expect(page.getByLabel('Stop response')).toHaveCount(0)

    // Handing off to the panel carries the exchange rather than opening blank.
    await quick.getByRole('button', { name: 'Open full chat' }).click()
    const dock = page.locator('writemd-ai-dock')
    await expect(dock).toBeVisible()
    await expect(dock.locator('.md')).toContainText('MOCK_ANSWER_ONLY')
    await expect(page.locator('writemd-ai-quick')).toHaveCount(0)
    await page.screenshot({ path: 'artifacts/ui-review/ai-selection-handoff.png' })

    await page.evaluate(
      async (path) => {
        const result = await window.electronAPI!.file.read(path)
        await (
          document.querySelector('writemd-app') as unknown as { fileState: FileState }
        ).fileState.openSecondaryFile(path, result.content)
      },
      join(fixture.vault, 'PRD.md')
    )
    await expect(page.locator('#secondary-cm-wrapper .cm-content')).toBeVisible()
    await openSelectionMenu(paragraph, true)
    await page
      .locator('writemd-text-menu')
      .getByRole('menuitem', { name: 'Summarize with AI', exact: true })
      .click()
    await expect(quick.getByRole('dialog', { name: 'Ask AI' })).toBeVisible()
    await expect(page.locator('writemd-ai-dock')).toHaveCount(0)
    await expect(prompt).toHaveValue(/Summarize only the highlighted text/)
    await prompt.press('Enter')
    await expect.poll(() => requests.length).toBe(2)
    const summary = JSON.stringify(requests[1].messages)
    expect(summary).toContain(paragraph)
    expect(summary.toLowerCase()).toContain('summar')
    for (const excluded of [
      'SECRET_PRIMARY_UNSELECTED',
      'SECRET_SECONDARY_UNSELECTED',
      'MOCK_ANSWER_ONLY'
    ]) {
      expect(summary).not.toContain(excluded)
    }
    expect(requests[1].messages.filter((message) => message.role === 'user')).toHaveLength(1)
  } finally {
    await app.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
