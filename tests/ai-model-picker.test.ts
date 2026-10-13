import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiModelPicker } from '../src/renderer/src/components/ai/ModelPicker'
import '../src/renderer/src/components/ai/ModelPicker'
import { SettingsStore } from '../src/renderer/src/state/settings'

const settings = SettingsStore.getInstance()
const fetchModels = vi.fn<() => Promise<string[]>>()

async function settle(element: AiModelPicker): Promise<void> {
  await element.updateComplete
  await new Promise((resolve) => setTimeout(resolve, 0))
  await element.updateComplete
}

async function mount(): Promise<AiModelPicker> {
  const element = document.createElement('writemd-ai-model-picker')
  document.body.append(element)
  await settle(element)
  return element
}

function button(element: AiModelPicker, label: string): HTMLButtonElement {
  return element.shadowRoot!.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
}

describe('chat model picker', () => {
  beforeEach(() => {
    fetchModels.mockReset().mockResolvedValue(['model-b', 'model-a'])
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        ai: { fetchModels },
        settings: { set: vi.fn().mockResolvedValue(undefined) }
      }
    })
    settings.setMany(
      {
        'ai.providerId': 'openai',
        'ai.baseUrl': 'https://provider.test/v1',
        'ai.apiKeySet': true,
        'ai.model': 'configured-model',
        'ai.cachedModels': []
      },
      false
    )
  })

  afterEach(async () => {
    document.body.replaceChildren()
    await settings.whenSaved()
    Reflect.deleteProperty(window, 'electronAPI')
  })

  it('discovers models using the stored key and persists a choice', async () => {
    const element = await mount()
    button(element, 'Choose AI model').click()
    await settle(element)
    expect(fetchModels).toHaveBeenCalledWith('openai', 'https://provider.test/v1', '')
    const options = [...element.shadowRoot!.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      'configured-model',
      'model-a',
      'model-b'
    ])
    options[2].click()
    await settle(element)
    expect(settings.get('ai.model', '')).toBe('model-b')
    expect(element.shadowRoot!.querySelector('[role="dialog"]')).toBeNull()
    expect(element.shadowRoot!.activeElement).toBe(button(element, 'Choose AI model'))
  })

  it('keeps the current model when discovery fails and retries', async () => {
    fetchModels.mockRejectedValueOnce(new Error('Key rejected'))
    const element = await mount()
    button(element, 'Choose AI model').click()
    await settle(element)
    expect(element.shadowRoot!.querySelector('[role="alert"]')?.textContent).toBe('Key rejected')
    expect(settings.get('ai.model', '')).toBe('configured-model')
    element.shadowRoot!.querySelector<HTMLButtonElement>('.retry')!.click()
    await settle(element)
    expect(element.shadowRoot!.querySelector('[role="alert"]')).toBeNull()
    expect(settings.get('ai.cachedModels', [])).toEqual(['model-a', 'model-b'])
  })

  it('ignores a late result from the previous provider', async () => {
    let resolve!: (models: string[]) => void
    fetchModels.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const element = await mount()
    button(element, 'Choose AI model').click()
    await settle(element)
    settings.setMany({ 'ai.providerId': 'gemini', 'ai.cachedModels': [] }, false)
    resolve(['wrong-provider-model'])
    await settle(element)
    expect(settings.get('ai.cachedModels', [])).toEqual([])
  })

  it('filters, navigates with arrows, and restores focus with Escape', async () => {
    const element = await mount()
    button(element, 'Choose AI model').click()
    await settle(element)
    const input = element.shadowRoot!.querySelector('input')!
    input.value = 'model-b'
    input.dispatchEvent(new Event('input'))
    await settle(element)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(element.shadowRoot!.activeElement?.getAttribute('role')).toBe('option')
    element.shadowRoot!.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
    await settle(element)
    expect(element.shadowRoot!.activeElement).toBe(button(element, 'Choose AI model'))
  })

  it('does not open or change models while busy', async () => {
    const element = await mount()
    element.disabled = true
    await settle(element)
    button(element, 'Choose AI model').click()
    await settle(element)
    expect(fetchModels).not.toHaveBeenCalled()
    expect(element.shadowRoot!.querySelector('[role="dialog"]')).toBeNull()
  })

  it('refreshes a cached list when reopened after a key changes', async () => {
    settings.set('ai.cachedModels', ['old-key-model'])
    const element = await mount()
    button(element, 'Choose AI model').click()
    await settle(element)
    expect(fetchModels).toHaveBeenCalledTimes(1)
    expect(settings.get('ai.cachedModels', [])).toEqual(['model-a', 'model-b'])
    button(element, 'Choose AI model').click()
    fetchModels.mockResolvedValueOnce(['new-key-model'])
    button(element, 'Choose AI model').click()
    await settle(element)
    expect(fetchModels).toHaveBeenCalledTimes(2)
    expect(settings.get('ai.cachedModels', [])).toEqual(['new-key-model'])
  })

  it('clears the previous provider cache before discovery returns', async () => {
    settings.set('ai.cachedModels', ['openai-model'])
    const element = await mount()
    settings.set('ai.providerId', 'gemini')
    expect(settings.get('ai.cachedModels', [])).toEqual([])
    let resolve!: (models: string[]) => void
    fetchModels.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    button(element, 'Choose AI model').click()
    await settle(element)
    expect(element.shadowRoot!.textContent).not.toContain('openai-model')
    resolve(['gemini-model'])
    await settle(element)
  })

  it('focuses the last model with ArrowUp from search and supports Home and End', async () => {
    const element = await mount()
    button(element, 'Choose AI model').click()
    await settle(element)
    const input = element.shadowRoot!.querySelector('input')!
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    const options = [...element.shadowRoot!.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    expect(element.shadowRoot!.activeElement).toBe(options[2])
    options[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(element.shadowRoot!.activeElement).toBe(options[0])
    options[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(element.shadowRoot!.activeElement).toBe(options[2])
  })

  it('keeps the menu within a narrow viewport and limits its available height', async () => {
    const element = await mount()
    vi.spyOn(button(element, 'Choose AI model'), 'getBoundingClientRect').mockReturnValue({
      left: window.innerWidth - 20,
      right: window.innerWidth,
      top: 150,
      bottom: 178,
      width: 20,
      height: 28,
      x: window.innerWidth - 20,
      y: 150,
      toJSON: () => ({})
    })
    button(element, 'Choose AI model').click()
    await settle(element)
    const menu = element.shadowRoot!.querySelector<HTMLElement>('.menu')!
    expect(parseFloat(menu.style.left) + parseFloat(menu.style.width)).toBeLessThanOrEqual(
      window.innerWidth - 8
    )
    expect(parseFloat(menu.style.top) + parseFloat(menu.style.maxHeight)).toBeLessThanOrEqual(
      window.innerHeight - 8
    )
    expect(menu.getAttribute('popover')).toBe('manual')
  })

  it('closes an open picker when a response starts and stays closed afterward', async () => {
    const element = await mount()
    button(element, 'Choose AI model').click()
    await settle(element)
    element.disabled = true
    await settle(element)
    element.disabled = false
    await settle(element)
    expect(element.shadowRoot!.querySelector('[role="dialog"]')).toBeNull()
  })
})
