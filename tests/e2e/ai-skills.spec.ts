import { test, expect } from '@playwright/test'
import { createServer } from 'http'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { makeFixture, launch, firstWindow, resizeWindow } from './fixtures'

test.setTimeout(120_000)

test('personal skills are selectable, discoverable in Settings, and sent only on explicit requests', async () => {
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = []
  const server = createServer((req, res) => {
    if (req.url?.endsWith('/chat/completions')) {
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        requests.push(JSON.parse(body))
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'Skill test reply.' } }] })}\n\n`
        )
        res.end('data: [DONE]\n\n')
      })
    } else res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Provider did not start')
  const fixture = makeFixture('ai-skills')
  const skillFolder = join(fixture.vault, 'Skills')
  const skillPath = join(skillFolder, 'proofread.md')
  expect(existsSync(skillFolder)).toBe(false)
  const configPath = join(fixture.userData, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.appearance.panelOrientation = 'vertical'
  config.appearance.motion = 'reduced'
  config.ai = {
    enabled: true,
    providerId: 'lmstudio',
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: 'mock-model'
  }
  writeFileSync(configPath, JSON.stringify(config))
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await expect.poll(() => existsSync(skillFolder)).toBe(true)
    writeFileSync(
      skillPath,
      '---\ndescription: Preserve my voice\n---\nPERSONAL_STYLE_ONLY\n' +
        "Preserve the meaning and the author's wording.\n".repeat(500) +
        'FULL_SKILL_END'
    )
    const nested = join(skillFolder, 'outline')
    mkdirSync(nested)
    writeFileSync(join(nested, 'SKILL.md'), '# Outline a note\nOUTLINE_GUIDANCE')
    await app.evaluate(({ shell }) => {
      const state = globalThis as typeof globalThis & {
        skillsOpenPaths: string[]
        skillsOpenError: string
      }
      state.skillsOpenPaths = []
      state.skillsOpenError = ''
      shell.openPath = async (path: string): Promise<string> => {
        state.skillsOpenPaths.push(path)
        return state.skillsOpenError
      }
    })
    await resizeWindow(app, 1400, 900)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await page.keyboard.press('Control+,')
    const settings = page.locator('writemd-settings-modal')
    await settings.getByRole('button', { name: 'AI assistant', exact: true }).click()
    await expect(
      settings.getByRole('button', { name: 'Open skills folder', exact: true })
    ).toBeVisible()
    await expect(settings).toContainText('/proofread')
    await expect(settings).toContainText('/outline')
    await expect(settings).not.toContainText('must be 16 KB')
    const openFolder = settings.getByRole('button', { name: 'Open skills folder', exact: true })
    await openFolder.click()
    await expect
      .poll(() =>
        app.evaluate(
          () => (globalThis as typeof globalThis & { skillsOpenPaths: string[] }).skillsOpenPaths
        )
      )
      .toEqual([skillFolder])
    await expect(settings).not.toContainText('No handler registered')
    await app.evaluate(() => {
      ;(globalThis as typeof globalThis & { skillsOpenError: string }).skillsOpenError =
        'Explorer unavailable'
    })
    await openFolder.click()
    await expect(settings.getByRole('alert')).toContainText('Could not open the Skills folder')
    await app.evaluate(() => {
      ;(globalThis as typeof globalThis & { skillsOpenError: string }).skillsOpenError = ''
    })
    await openFolder.click()
    await expect(settings.getByRole('alert')).toHaveCount(0)
    await expect
      .poll(() =>
        app.evaluate(
          () => (globalThis as typeof globalThis & { skillsOpenPaths: string[] }).skillsOpenPaths
        )
      )
      .toEqual([skillFolder, skillFolder, skillFolder])
    await settings
      .getByRole('button', { name: 'Refresh skills', exact: true })
      .scrollIntoViewIfNeeded()
    await settings.getByText('Preserve my voice', { exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'artifacts/ui-review/ai-skills-settings.png' })
    await resizeWindow(app, 800, 600)
    await settings
      .getByRole('button', { name: 'Refresh skills', exact: true })
      .scrollIntoViewIfNeeded()
    for (const name of ['Open skills folder', 'Refresh skills']) {
      const bounds = await settings.getByRole('button', { name, exact: true }).boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(800)
    }
    await page.screenshot({ path: 'artifacts/ui-review/ai-skills-settings-compact.png' })
    await resizeWindow(app, 1400, 900)
    await settings.getByRole('button', { name: 'Back to editor', exact: true }).click()
    await page.keyboard.press('Control+Alt+Shift+A')
    const dock = page.locator('writemd-ai-dock')
    const composer = dock.locator('writemd-ai-composer')
    const textarea = composer.locator('textarea')
    await textarea.fill('/')
    await expect(composer.getByRole('option', { name: /proofread/ })).toBeVisible()
    await page.screenshot({ path: 'artifacts/ui-review/ai-skills-picker.png' })
    await composer.getByRole('option', { name: /proofread/ }).click()
    await expect(textarea).toHaveValue('/proofread ')
    await textarea.press('End')
    await textarea.pressSequentially('review this note')
    await textarea.press('Enter')
    await expect.poll(() => requests.length).toBe(1)
    await expect(dock.getByLabel('Stop response')).toHaveCount(0)
    expect(
      JSON.stringify(requests[0].messages.filter((message) => message.role === 'system'))
    ).toContain('PERSONAL_STYLE_ONLY')
    expect(
      JSON.stringify(requests[0].messages.filter((message) => message.role === 'system'))
    ).toContain('FULL_SKILL_END')
    expect(
      JSON.stringify(requests[0].messages.filter((message) => message.role !== 'system'))
    ).not.toContain('PERSONAL_STYLE_ONLY')
    expect(JSON.stringify(requests[0])).not.toContain(skillPath.replace(/\\/g, '\\\\'))

    await textarea.fill('A normal chat request')
    await textarea.press('Enter')
    await expect.poll(() => requests.length).toBe(2)
    await expect(dock.getByLabel('Stop response')).toHaveCount(0)
    expect(JSON.stringify(requests[1].messages)).not.toContain('PERSONAL_STYLE_ONLY')
    writeFileSync(skillPath, '# UPDATED_SKILL_INSTRUCTIONS')
    await textarea.fill('/proofread another request')
    await textarea.press('Enter')
    await expect.poll(() => requests.length).toBe(3)
    expect(JSON.stringify(requests[2].messages)).toContain('UPDATED_SKILL_INSTRUCTIONS')
    await expect(dock.getByLabel('Stop response')).toHaveCount(0)
    await textarea.fill('/missing explain this')
    await textarea.press('Enter')
    await expect(dock).toContainText('Skill /missing was not found')
    expect(requests).toHaveLength(3)
  } finally {
    await app.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
