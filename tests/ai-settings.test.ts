import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from '../src/renderer/src/components/SettingsModal'
import '../src/renderer/src/components/SettingsModal'
import { SettingsStore } from '../src/renderer/src/state/settings'

// Provider and endpoint races do not depend on the dropdown implementation.
// Its native form internals are exercised in the Electron tests.
vi.mock('@awesome.me/webawesome/dist/components/select/select.js', () => ({}))

const settings = SettingsStore.getInstance()
const fetchModels = vi.fn<() => Promise<string[]>>()
const listSkills = vi
  .fn()
  .mockResolvedValue({ folder: 'C:/vault/Skills', skills: [], warnings: [] })
const openSkillsFolder = vi.fn().mockResolvedValue('C:/vault/Skills')

async function settle(element: SettingsModal): Promise<void> {
  await element.updateComplete
  await new Promise((resolve) => setTimeout(resolve, 0))
  await element.updateComplete
}

async function mount(): Promise<SettingsModal> {
  const element = new SettingsModal()
  element.embedded = true
  element.initialTab = 'ai'
  document.body.append(element)
  await settle(element)
  return element
}

describe('AI model discovery in Settings', () => {
  beforeEach(() => {
    fetchModels.mockReset()
    listSkills
      .mockReset()
      .mockResolvedValue({ folder: 'C:/vault/Skills', skills: [], warnings: [] })
    openSkillsFolder.mockReset().mockResolvedValue('C:/vault/Skills')
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        ai: {
          fetchModels,
          listSkills,
          openSkillsFolder,
          presets: vi.fn().mockResolvedValue([]),
          keyState: vi.fn().mockResolvedValue('empty')
        },
        settings: { set: vi.fn().mockResolvedValue(undefined) }
      }
    })
    settings.setMany(
      {
        'ai.providerId': 'openai',
        'ai.baseUrl': 'https://first.test/v1',
        'ai.model': 'configured-model',
        'ai.cachedModels': [],
        'ai.apiKeySet': false,
        'ai.autoAcceptEdits': false,
        'ai.maxOutputTokens': 0
      },
      false
    )
  })

  afterEach(async () => {
    document.body.replaceChildren()
    await settings.whenSaved()
    Reflect.deleteProperty(window, 'electronAPI')
  })

  it('discards a model list from the previous endpoint', async () => {
    let resolve!: (models: string[]) => void
    fetchModels.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    const element = await mount()
    element.shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="Fetch models"]')!.click()
    await settle(element)
    const endpoint = element.shadowRoot!.querySelector<HTMLInputElement>('[aria-label="Endpoint"]')!
    endpoint.value = 'https://second.test/v1'
    endpoint.dispatchEvent(new Event('change'))
    resolve(['old-provider-model'])
    await settle(element)
    expect(settings.get('ai.cachedModels', [])).toEqual([])
    expect(settings.get('ai.model', '')).toBe('configured-model')
    expect(
      element.shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="Fetch models"]')!.disabled
    ).toBe(false)
  })

  it('toggles automatic acceptance and reflects saved changes', async () => {
    const element = await mount()
    const toggle = element.shadowRoot!.querySelector<HTMLButtonElement>(
      '[aria-label="Automatically accept AI edits"]'
    )!
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    toggle.click()
    await settle(element)
    expect(settings.get('ai.autoAcceptEdits', false)).toBe(true)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    settings.set('ai.autoAcceptEdits', false)
    await settle(element)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('selects the output allowance without invalidating the model catalogue', async () => {
    const element = await mount()
    const select = element.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      '[aria-label="Output limit"]'
    )!
    expect(select.value).toBe('0')
    select.value = '65536'
    select.dispatchEvent(new Event('change'))
    await settle(element)
    expect(settings.get('ai.maxOutputTokens', 0)).toBe(65536)
    expect(fetchModels).not.toHaveBeenCalled()
  })

  it('opens the personal skills folder and shows refreshed commands', async () => {
    listSkills.mockResolvedValueOnce({
      folder: 'C:/vault/Skills',
      skills: [],
      warnings: []
    })
    const element = await mount()
    listSkills.mockResolvedValueOnce({
      folder: 'C:/vault/Skills',
      skills: [{ name: 'proofread', description: 'Keep my voice' }],
      warnings: []
    })
    const buttons = Array.from(element.shadowRoot!.querySelectorAll<HTMLButtonElement>('button'))
    buttons.find((button) => button.textContent?.includes('Open skills folder'))!.click()
    await settle(element)
    expect(openSkillsFolder).toHaveBeenCalledOnce()
    expect(element.shadowRoot!.textContent).toContain('/proofread')
    expect(element.shadowRoot!.textContent).toContain('Keep my voice')
    expect(element.shadowRoot!.textContent).toContain('C:/vault/Skills')
    const instructions = element.shadowRoot!.querySelectorAll('.setting-desc code')
    expect(Array.from(instructions, (code) => code.textContent)).toEqual(
      expect.arrayContaining(['Skills', 'proofread.md', 'proofread/SKILL.md', '/proofread'])
    )
    openSkillsFolder.mockRejectedValueOnce(new Error('Folder unavailable'))
    buttons.find((button) => button.textContent?.includes('Open skills folder'))!.click()
    await settle(element)
    expect(element.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not open the Skills folder. Open Skills in your vault, or try again.'
    )
    expect(element.shadowRoot!.textContent).not.toContain('Folder unavailable')
  })

  it('shows restart guidance instead of a raw missing skills folder handler error', async () => {
    const element = await mount()
    openSkillsFolder.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'ai:open-skills-folder': Error: No handler registered for 'ai:open-skills-folder'"
      )
    )
    const open = Array.from(element.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('Open skills folder')
    )!
    open.click()
    await settle(element)
    expect(element.shadowRoot!.querySelector('[role="alert"]')?.textContent).toBe(
      'Restart WriteMd to finish enabling skills, then try again.'
    )
    expect(element.shadowRoot!.textContent).not.toContain('No handler registered')
    expect(element.shadowRoot!.textContent).not.toContain('ai:open-skills-folder')
  })

  it('sanitizes missing list handlers and general skill discovery failures', async () => {
    listSkills.mockRejectedValueOnce(new Error("No handler registered for 'ai:list-skills'"))
    const element = await mount()
    expect(element.shadowRoot!.querySelector('[role="alert"]')?.textContent).toBe(
      'Restart WriteMd to finish enabling skills, then try again.'
    )
    listSkills.mockRejectedValueOnce(new Error('EACCES: internal filesystem details'))
    const refresh = Array.from(
      element.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')
    ).find((button) => button.textContent?.includes('Refresh skills'))!
    refresh.click()
    await settle(element)
    expect(element.shadowRoot!.querySelector('[role="alert"]')?.textContent).toBe(
      'Could not read skills. Try Refresh skills again.'
    )
    expect(element.shadowRoot!.textContent).not.toContain('EACCES')
  })

  it('ignores a failed discovery after the settings page closes', async () => {
    let reject!: (error: Error) => void
    fetchModels.mockReturnValue(
      new Promise((_resolve, failed) => {
        reject = failed
      })
    )
    const element = await mount()
    element.shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="Fetch models"]')!.click()
    element.remove()
    reject(new Error('Stale endpoint failure'))
    await settle(element)
    expect(element.shadowRoot!.textContent).not.toContain('Stale endpoint failure')
    expect(settings.get('ai.cachedModels', [])).toEqual([])
  })
})
