import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiComposer } from '../src/renderer/src/components/ai/Composer'
import { SettingsStore } from '../src/renderer/src/state/settings'
import { ChatgptState } from '../src/renderer/src/state/chatgpt'
import type { ChatgptAuthView, ChatgptModelView } from '../src/shared/ai/chatgpt'

vi.mock('@awesome.me/webawesome/dist/components/select/select.js', () => ({}))
const settings = SettingsStore.getInstance()
const accountState = (): ChatgptAuthView => ({
  connected: true,
  pending: false,
  activeId: 'first',
  accounts: [
    { id: 'first', label: 'First account' },
    { id: 'second', label: 'Second account' }
  ],
  error: null,
  sessionOnly: false,
  needsWelcome: false
})
let state = accountState()
const select = vi.fn<(id: string) => Promise<ChatgptAuthView>>()
const models = vi.fn<() => Promise<ChatgptModelView[]>>()
async function settle(element: AiComposer): Promise<void> {
  await element.updateComplete
  await new Promise((resolve) => setTimeout(resolve, 0))
  await element.updateComplete
}
async function mount(): Promise<AiComposer> {
  const element = new AiComposer()
  document.body.append(element)
  await settle(element)
  return element
}
function choose(element: AiComposer): void {
  element.shadowRoot!.querySelector<HTMLButtonElement>('[data-account-id="second"]')!.click()
}
beforeEach(() => {
  state = accountState()
  select.mockReset().mockImplementation(async (id) => ({ ...state, activeId: id }))
  models.mockReset().mockResolvedValue([{ id: 'second-model', label: 'Second model' }])
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      settings: { set: vi.fn().mockResolvedValue(undefined) },
      ai: {
        chatgpt: { state: async () => state, select, models, onChanged: () => () => undefined }
      }
    }
  })
  settings.setMany(
    {
      'ai.enabled': true,
      'ai.providerId': 'chatgpt',
      'ai.model': 'first-model',
      'ai.cachedModels': ['first-model']
    },
    false
  )
})
afterEach(async () => {
  document.body.replaceChildren()
  await settings.whenSaved()
  Reflect.deleteProperty(window, 'electronAPI')
})

describe('ChatGPT accounts in the composer', () => {
  it('switches accounts and selects an available model without losing the draft', async () => {
    const element = await mount()
    element.setPrompt('Keep this draft')
    choose(element)
    await settle(element)
    expect(select).toHaveBeenCalledWith('second')
    expect(ChatgptState.getInstance().state().activeId).toBe('second')
    expect(settings.get('ai.model', '')).toBe('second-model')
    expect(settings.get('ai.cachedModels', [])).toEqual(['second-model'])
    expect(element.shadowRoot!.querySelector('textarea')!.value).toBe('Keep this draft')
  })

  it('does not send or switch again while account models are loading', async () => {
    let complete: (value: ChatgptModelView[]) => void = () => undefined
    models.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    const element = await mount()
    element.setPrompt('Unsent')
    const sent = vi.fn()
    element.addEventListener('composer-send', sent)
    choose(element)
    await settle(element)
    element
      .shadowRoot!.querySelector('textarea')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      )
    choose(element)
    expect(sent).not.toHaveBeenCalled()
    expect(select).toHaveBeenCalledTimes(1)
    complete([{ id: 'second-model', label: 'Second model' }])
    await settle(element)
    expect(element.shadowRoot!.querySelector('textarea')!.value).toBe('Unsent')
  })

  it('ignores late account models after the provider changes', async () => {
    let complete: (value: ChatgptModelView[]) => void = () => undefined
    models.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    const element = await mount()
    choose(element)
    await settle(element)
    settings.setMany(
      {
        'ai.providerId': 'opencode',
        'ai.model': 'workspace/model',
        'ai.cachedModels': ['workspace/model']
      },
      false
    )
    await settle(element)
    // The provider-change notification clears the previous account's cache.
    // A subsequent discovery for the new provider must survive the old reply.
    settings.set('ai.cachedModels', ['workspace/model'])
    complete([{ id: 'second-model', label: 'Second model' }])
    await settle(element)
    expect(settings.get('ai.model', '')).toBe('workspace/model')
    expect(settings.get('ai.cachedModels', [])).toEqual(['workspace/model'])
  })

  it('shows a switching error and preserves the current account and draft', async () => {
    select.mockRejectedValue(new Error('Account unavailable'))
    const element = await mount()
    element.setPrompt('Draft')
    choose(element)
    await settle(element)
    expect(element.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(
      'Account unavailable'
    )
    expect(ChatgptState.getInstance().state().activeId).toBe('first')
    expect(element.shadowRoot!.querySelector('textarea')!.value).toBe('Draft')
  })
})
