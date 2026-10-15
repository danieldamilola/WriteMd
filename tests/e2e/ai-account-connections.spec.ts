import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  chooseSettingsOption,
  firstWindow,
  launch,
  makeFixture,
  openSettings,
  resizeWindow
} from './fixtures'

test.setTimeout(120_000)

async function checkComposer(page: Page): Promise<void> {
  const geometry = await page.locator('writemd-ai-dock writemd-ai-composer').evaluate((host) => {
    const root = host.shadowRoot!
    const field = root.querySelector('.field')!.getBoundingClientRect()
    const send = root.querySelector('.send')!.getBoundingClientRect()
    const actions = root.querySelector('.actions')!.getBoundingClientRect()
    const attach = root.querySelector('[aria-label="Attach a file"]')!.getBoundingClientRect()
    const model = root.querySelector('writemd-ai-model-picker')!.getBoundingClientRect()
    const bounds = host.getBoundingClientRect()
    return {
      sendInside:
        send.left >= field.left && send.right <= field.right && send.bottom <= field.bottom,
      controlsBelow: actions.top >= field.bottom,
      attachmentLeft: attach.right < model.left,
      fits: [...root.querySelectorAll<HTMLElement>('.actions > *')].every((element) => {
        const rect = element.getBoundingClientRect()
        return !rect.width || (rect.left >= bounds.left && rect.right <= bounds.right)
      })
    }
  })
  expect(geometry).toEqual({
    sendInside: true,
    controlsBelow: true,
    attachmentLeft: true,
    fits: true
  })
}

test('chat account switching preserves the draft and refreshes models in the redesigned prompt bar', async () => {
  const fixture = makeFixture('chat-account-picker')
  const configPath = join(fixture.userData, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.appearance.theme = 'graphite'
  config.appearance.motion = 'reduced'
  config.ai = {
    enabled: true,
    providerId: 'chatgpt',
    baseUrl: 'https://api.openai.com/v1',
    model: 'first-model',
    cachedModels: ['first-model']
  }
  writeFileSync(configPath, JSON.stringify(config))
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      const state = {
        connected: true,
        pending: false,
        activeId: 'account-1',
        accounts: [
          { id: 'account-1', label: 'writer@example.test' },
          { id: 'account-2', label: 'studio@example.test' }
        ],
        error: null,
        sessionOnly: false,
        needsWelcome: false
      }
      for (const channel of ['ai:chatgpt-state', 'ai:chatgpt-select', 'ai:chatgpt-models'])
        ipcMain.removeHandler(channel)
      ipcMain.handle('ai:chatgpt-state', () => state)
      ipcMain.handle('ai:chatgpt-select', (_, id: string) => {
        if (!state.accounts.some((account) => account.id === id)) throw new Error('Unknown account')
        state.activeId = id
        for (const window of BrowserWindow.getAllWindows())
          window.webContents.send('ai:chatgpt-auth', state)
        return state
      })
      ipcMain.handle('ai:chatgpt-models', () =>
        state.activeId === 'account-1'
          ? [{ id: 'first-model', label: 'First model' }]
          : [{ id: 'studio-model', label: 'Studio model' }]
      )
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send('ai:chatgpt-auth', state)
    })
    await resizeWindow(app, 1400, 900)
    await page.keyboard.press('Control+Alt+Shift+A')
    const composer = page.locator('writemd-ai-dock writemd-ai-composer')
    const account = composer.getByRole('button', { name: 'Switch ChatGPT account', exact: true })
    await expect(account).toBeVisible()
    await composer
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Keep this unsent draft while switching accounts.')
    await account.click()
    await composer.getByRole('menuitemradio', { name: 'studio@example.test' }).click()
    await expect(account).toContainText('studio@example.test')
    await expect(composer.getByRole('button', { name: 'Choose AI model' })).toContainText(
      'Studio model'
    )
    await expect(composer.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
      'Keep this unsent draft while switching accounts.'
    )
    await expect
      .poll(() => JSON.parse(readFileSync(configPath, 'utf8')).ai.cachedModels)
      .toEqual(['studio-model'])
    await checkComposer(page)
    await page.screenshot({ path: 'artifacts/ui-review/ai-prompt-bar-accounts-graphite.png' })
    await account.click()
    const menu = composer.getByRole('menu', { name: 'ChatGPT accounts' })
    await expect(menu).toBeVisible()
    expect(await menu.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: 'artifacts/ui-review/ai-prompt-bar-account-menu.png' })
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await expect(account).toContainText('writer@example.test')
    await expect(composer.getByRole('button', { name: 'Choose AI model' })).toContainText(
      'First model'
    )
    await account.click()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(account).toContainText('studio@example.test')
    await expect(composer.getByRole('button', { name: 'Choose AI model' })).toContainText(
      'Studio model'
    )
    await account.click()
    await page.keyboard.press('Escape')
    await expect(menu).not.toBeVisible()
    await resizeWindow(app, 800, 700)
    await page.evaluate(() => {
      const host = document.querySelector('writemd-app') as unknown as {
        settingsStore: { set(key: string, value: string): void }
      }
      host.settingsStore.set('appearance.theme', 'paper')
    })
    await checkComposer(page)
    await page.screenshot({ path: 'artifacts/ui-review/ai-prompt-bar-accounts-paper.png' })
  } finally {
    await app.close()
    fixture.cleanup()
  }
})

test('OpenCode settings show browser approval, cancellation, workspace models and sign-out', async () => {
  const fixture = makeFixture('opencode-settings')
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      const state = {
        connected: false,
        pending: false,
        connectionId: null as string | null,
        workspaceId: null as string | null,
        userCode: null as string | null,
        verificationUri: null as string | null,
        error: null,
        sessionOnly: false
      }
      const changed = (): typeof state => {
        for (const window of BrowserWindow.getAllWindows())
          window.webContents.send('ai:opencode-auth', state)
        return state
      }
      for (const channel of [
        'ai:opencode-state',
        'ai:opencode-login',
        'ai:opencode-cancel',
        'ai:opencode-logout',
        'ai:opencode-models'
      ])
        ipcMain.removeHandler(channel)
      ipcMain.handle('ai:opencode-state', () => state)
      ipcMain.handle('ai:opencode-login', () => {
        Object.assign(state, {
          pending: true,
          userCode: 'TEST-CODE',
          verificationUri: 'https://opencode.ai/console/device?user_code=TEST-CODE'
        })
        return changed()
      })
      ipcMain.handle('ai:opencode-cancel', () => {
        Object.assign(state, { pending: false, userCode: null, verificationUri: null })
        return changed()
      })
      ipcMain.handle('ai:opencode-logout', () => {
        Object.assign(state, {
          connected: false,
          pending: false,
          connectionId: null,
          workspaceId: null,
          userCode: null,
          verificationUri: null
        })
        return changed()
      })
      ipcMain.handle('ai:opencode-models', () =>
        state.connected ? [{ id: 'workspace/kimi', label: 'Kimi · Workspace' }] : []
      )
    })
    await resizeWindow(app, 1200, 900)
    await openSettings(page)
    const modal = page.locator('writemd-settings-modal')
    await modal.getByRole('button', { name: 'AI assistant', exact: true }).click()
    await chooseSettingsOption(page, 'Provider', 'opencode')
    await expect(modal.getByLabel('API Key', { exact: true })).toHaveCount(0)
    await expect(modal.getByLabel('Endpoint', { exact: true })).toHaveCount(0)
    await modal.getByRole('button', { name: 'Continue with OpenCode' }).click()
    await expect(modal.getByRole('status')).toContainText('TEST-CODE')
    await expect(modal.getByRole('button', { name: 'Open sign-in page' })).toBeVisible()
    await page.screenshot({ path: 'artifacts/ui-review/opencode-sign-in.png' })
    await modal.getByRole('button', { name: 'Cancel sign-in' }).click()
    await expect(modal.getByRole('button', { name: 'Continue with OpenCode' })).toBeVisible()
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send('ai:opencode-auth', {
          connected: true,
          pending: false,
          connectionId: 'connection-test',
          workspaceId: 'org_test',
          userCode: null,
          verificationUri: null,
          error: null,
          sessionOnly: false
        })
    })
    // Replace the controlled model response after the simulated approval.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('ai:opencode-models')
      ipcMain.handle('ai:opencode-models', () => [
        { id: 'workspace/kimi', label: 'Kimi · Workspace' }
      ])
    })
    await modal.getByRole('button', { name: 'Fetch models' }).click()
    await expect(modal.locator('wa-option[value="workspace/kimi"]')).toContainText(
      'Kimi · Workspace'
    )
    await expect(modal.getByRole('button', { name: 'Change workspace' })).toBeVisible()
    await page.screenshot({ path: 'artifacts/ui-review/opencode-connected.png' })
    await modal.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(modal.getByRole('button', { name: 'Continue with OpenCode' })).toBeVisible()
    await expect(modal.locator('wa-option[value="workspace/kimi"]')).toHaveCount(1)
    await expect(modal).not.toContainText('No models returned')
  } finally {
    await app.close()
    fixture.cleanup()
  }
})
