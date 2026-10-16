import { test, expect, type ElectronApplication } from '@playwright/test'
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { WriteMdSettings } from '../../src/shared/settings-schema'
import { makeFixture, launch, firstWindow, resizeWindow } from './fixtures'

test.skip(process.env.WRITEMD_LIVE_AI_TEST !== '1', 'Requires an explicit live provider test')
test.setTimeout(240000)

test('live configured provider reorganizes a large transcript note and prepares a local addition', async () => {
  const appData = process.env.APPDATA
  if (!appData) throw new Error('This check requires the Windows WriteMd profile')
  const profile = join(appData, 'writemd')
  const settings = JSON.parse(readFileSync(join(profile, 'config.json'), 'utf8')) as WriteMdSettings
  const fixture = makeFixture('ai-native-tools-live')
  const path = join(fixture.userData, 'Large-note.md')
  const transcript = [
    'Tutorial transcript: scripting and planning. Um, you know, first outline the promise, main points, and conclusion. A strong intro shows a concrete problem. Example: show the messy desk, then promise three steps to organize it. Repeat: outline before drafting.',
    'Tutorial transcript: audio. Well, like, keep the microphone close and listen for room echo. Record a quiet sample first. Example: compare the voice with the microphone near and far away. Clear audio matters more than background music. Um, clear audio matters.',
    'Tutorial transcript: video. You know, face a soft light and keep the camera steady. Use a wide shot for context and a close-up for details. Example: show the whole desk, then a close-up of the cable organizer. Repeat the lighting lesson before recording.'
  ].join('\n\n')
  const original = '# YouTube tutorial transcripts\n\n' + (transcript + '\n\n').repeat(180)
  const organizePrompt = `the content of this file is a lot and it very very
important to me in my youtube jorney.
this are all the tutorial transcript i watched on
youtube. now i can't sit down and start reading
everything.
so this is what you will do for me.
i want you to organise the content of this file. there
are some concepts that are repetitive. and some
that are just filler words.

please reorganise them. and i thing there is like a
category mention here. for scritping .... everything
understand scripting
then audio and video or something
then went in depth with intro and showed examples;
blah blah blah. just orgnise this file please`
  writeFileSync(path, original)
  const keyFile = join(fixture.userData, 'ai-key')
  const encryptionState = join(fixture.userData, 'Local State')
  if (existsSync(join(profile, 'Local State')))
    copyFileSync(join(profile, 'Local State'), encryptionState)
  if (existsSync(join(profile, 'ai-key'))) copyFileSync(join(profile, 'ai-key'), keyFile)
  writeFileSync(
    join(fixture.userData, 'config.json'),
    JSON.stringify({
      files: { vaultPath: fixture.vault, openTabs: [path], activeTabPath: path },
      appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical' },
      ai: { ...settings.ai, enabled: true, autoAcceptEdits: false }
    })
  )
  let app: ElectronApplication | undefined
  try {
    app = await launch(fixture)
    const page = await firstWindow(app)
    await resizeWindow(app, 1200, 800)
    await expect(page.locator('writemd-editor')).toBeVisible()
    await page.keyboard.press('Control+Alt+A')
    const quick = page.locator('writemd-ai-quick')
    await quick.locator('textarea').fill(organizePrompt)
    await quick.getByRole('button', { name: 'Send message' }).click()
    await expect(quick.getByRole('button', { name: 'Stop response' })).toHaveCount(0, {
      timeout: 110000
    })
    await page.screenshot({
      path: 'artifacts/ui-review/ai-native-tools-live-organized-preview.png'
    })
    const error = await quick
      .locator('.error')
      .textContent()
      .catch(() => '')
    expect(error).toBeFalsy()
    await expect(quick.getByRole('button', { name: 'Accept', exact: true })).toBeVisible()
    const replacement = (await quick.locator('.replacement').allTextContents()).join('\n')
    expect(replacement).toMatch(/script/i)
    expect(replacement).toMatch(/audio/i)
    expect(replacement).toMatch(/video/i)
    expect(replacement).toMatch(/example|desk/i)
    expect(readFileSync(path, 'utf8')).toBe(original)
    await quick.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect.poll(() => readFileSync(path, 'utf8').length).toBeLessThan(original.length)
    const reorganized = readFileSync(path, 'utf8')
    expect(reorganized).toMatch(/script/i)
    expect(reorganized).toMatch(/audio/i)
    expect(reorganized).toMatch(/video/i)
    await page.screenshot({ path: 'artifacts/ui-review/ai-native-tools-live-organized-saved.png' })

    // Force the observed malformed-response case once, then let the recovery
    // request reach the real provider. Credentials remain in Electron main.
    await app.evaluate(() => {
      const originalFetch = globalThis.fetch
      const probe = { injected: false, thinkingDisabled: false, toolsOmitted: false }
      const scope = globalThis as typeof globalThis & { nativeRecoveryProbe?: typeof probe }
      scope.nativeRecoveryProbe = probe
      globalThis.fetch = async (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('/chat/completions')) {
          if (!probe.injected) {
            probe.injected = true
            return new Response(
              `data: ${JSON.stringify({ choices: [{ delta: { content: '<|DSML|tool_calls><|DSML|invoke name="read_file">unused</|DSML|invoke>' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
              { headers: { 'content-type': 'text/event-stream' } }
            )
          }
          const body = JSON.parse(String(init?.body)) as {
            tools?: unknown
            thinking?: { type?: string }
          }
          probe.thinkingDisabled = body.thinking?.type === 'disabled'
          probe.toolsOmitted = body.tools === undefined
        }
        return originalFetch(input, init)
      }
    })
    await quick
      .locator('textarea')
      .fill('Add [[AI_NATIVE_TOOL_CHECK]] at the end of this file. Preserve all existing text.')
    await quick.getByRole('button', { name: 'Send message' }).click()
    await expect(quick.getByRole('button', { name: 'Stop response' })).toHaveCount(0, {
      timeout: 110000
    })
    await page.screenshot({ path: 'artifacts/ui-review/ai-native-tools-live-preview.png' })
    expect(
      await quick
        .locator('.error')
        .textContent()
        .catch(() => '')
    ).toBeFalsy()
    await expect(quick.locator('.replacement')).toContainText('[[AI_NATIVE_TOOL_CHECK]]')
    await quick.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect
      .poll(() => readFileSync(path, 'utf8'), { timeout: 15000 })
      .toContain('[[AI_NATIVE_TOOL_CHECK]]')
    expect(readFileSync(path, 'utf8').startsWith(reorganized.trimEnd())).toBe(true)
    const probe = await app.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            nativeRecoveryProbe?: {
              injected: boolean
              thinkingDisabled: boolean
              toolsOmitted: boolean
            }
          }
        ).nativeRecoveryProbe
    )
    expect(probe?.injected).toBe(true)
    expect(probe?.toolsOmitted).toBe(true)
    if (settings.ai.providerId === 'deepseek') expect(probe?.thinkingDisabled).toBe(true)
    await page.screenshot({ path: 'artifacts/ui-review/ai-native-tools-live-saved.png' })
    console.log(
      `PASS: ${settings.ai.providerId}/${settings.ai.model} reorganized ${original.length} characters with the user's prompt and saved the local addition.`
    )
  } finally {
    try {
      await app?.close()
    } finally {
      rmSync(keyFile, { force: true })
      rmSync(encryptionState, { force: true })
    }
  }
})
