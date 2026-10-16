import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  modelCapabilities,
  modelPreference,
  modelPreferenceKey,
  supportedModelOptions,
  validModelPreferences
} from '../src/shared/ai/model-options'
import { openaiAdapter } from '../src/main/ai/providers/openai'
import { anthropicAdapter } from '../src/main/ai/providers/anthropic'
import { geminiAdapter } from '../src/main/ai/providers/gemini'
import type { ProviderAdapter, StreamRequest } from '../src/main/ai/providers/types'
import { SettingsStore } from '../src/renderer/src/state/settings'
import { AiModelOptions } from '../src/renderer/src/components/ai/ModelOptions'
import { updateReleaseNotes } from '../src/shared/release-notes'
import { validatePatch } from '../src/shared/settings-schema'

afterEach(async () => {
  document.body.replaceChildren()
  await SettingsStore.getInstance().whenSaved()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'electronAPI')
})
const choices = { reasoning: 'high', serviceTier: 'priority' } as const

describe('model capabilities and preferences', () => {
  it('rejects invalid model choices at the settings bridge', () => {
    const key = modelPreferenceKey('openai', 'gpt-6.1-sol')
    expect(validatePatch({ ai: { modelPreferences: { [key]: choices } } }).problems).toEqual([])
    const invalid = validatePatch({
      ai: { modelPreferences: { [key]: { ...choices, serviceTier: 'unlimited' } } }
    })
    expect(invalid.problems).toHaveLength(1)
    expect(invalid.clean).toEqual({})
  })
  it('keeps providers and model ids separate without treating dots or slashes as settings paths', () => {
    const key = modelPreferenceKey('openai', 'gpt-6.1-sol')
    const preferences = { [key]: choices }
    expect(validModelPreferences(preferences)).toBe(true)
    expect(modelPreference(preferences, 'openai', 'gpt-6.1-sol')).toEqual(choices)
    expect(modelPreference(preferences, 'chatgpt', 'gpt-6.1-sol').reasoning).toBe('auto')
    expect(validModelPreferences({ __proto__: choices, bad: choices })).toBe(false)
    expect(validModelPreferences({ [key]: { ...choices, reasoning: 'ultra' } })).toBe(false)
    expect(validModelPreferences({ [key]: { ...choices, token: 'secret' } })).toBe(false)
  })
  it('only offers API efforts accepted by the selected model', () => {
    expect(modelCapabilities('openai', 'gpt-6.1-sol').reasoning).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max'
    ])
    expect(modelCapabilities('openai', 'gpt-5.1').reasoning).not.toContain('xhigh')
    expect(modelCapabilities('anthropic', 'claude-opus-4-5').reasoning).not.toContain('max')
    expect(modelCapabilities('gemini', 'gemini-3.8-flash').reasoning).not.toContain('minimal')
    expect(modelCapabilities('gemini', 'gemini-3.1-pro').reasoning).toEqual(['low', 'high'])
    expect(modelCapabilities('deepseek', 'deepseek-flash').reasoning).toEqual([
      'none',
      'low',
      'high',
      'max'
    ])
    expect(supportedModelOptions(choices, modelCapabilities('custom', 'gpt-6.1-sol'))).toEqual({})
  })
  it('bounds updater notes and accepts staged release entries', () => {
    expect(updateReleaseNotes([{ version: '2', note: 'Fixed notes' }, { note: null }])).toBe(
      'Fixed notes'
    )
    expect(updateReleaseNotes('x'.repeat(80_000))).toHaveLength(65_536)
    expect(updateReleaseNotes({ note: 'bad shape' })).toBe('')
  })
})

async function wire(
  adapter: ProviderAdapter,
  overrides: Partial<StreamRequest>,
  frames: unknown[] = ['[DONE]']
): Promise<{ url: string; body: Record<string, unknown> }> {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        frames
          .map((frame) => `data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`)
          .join(''),
        { headers: { 'content-type': 'text/event-stream' } }
      )
    )
  vi.stubGlobal('fetch', fetcher)
  for await (const event of adapter.stream({
    baseUrl: 'https://provider.test/v1',
    model: 'test',
    apiKey: 'test-key',
    messages: [{ role: 'user', content: 'Hello' }],
    system: '',
    temperature: 0.4,
    signal: new AbortController().signal,
    modelOptions: choices,
    ...overrides
  })) {
    expect(event.type).not.toBe('error')
  }
  return {
    url: String(fetcher.mock.calls[0][0]),
    body: JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as Record<string, unknown>
  }
}
describe('model options on the wire', () => {
  it('uses Responses with reasoning and service tier for native GPT-6 models', async () => {
    const { url, body } = await wire(
      openaiAdapter,
      { providerId: 'openai', model: 'gpt-6.1-sol' },
      [{ type: 'response.completed', response: {} }]
    )
    expect(url).toBe('https://provider.test/v1/responses')
    expect(body).toMatchObject({ reasoning: { effort: 'high' }, service_tier: 'priority' })
    expect(body).not.toHaveProperty('reasoning_effort')
  })
  it('uses Chat Completions effort for GPT-5 and omits unrecognized gateway options', async () => {
    const { body } = await wire(openaiAdapter, { providerId: 'openai', model: 'gpt-5.2' })
    expect(body).toMatchObject({ reasoning_effort: 'high', service_tier: 'priority' })
    expect(
      (await wire(openaiAdapter, { providerId: 'custom', model: 'gpt-5.2' })).body
    ).not.toHaveProperty('reasoning_effort')
  })
  it('maps DeepSeek Off and preserves the thinking-off recovery override', async () => {
    const off = await wire(openaiAdapter, {
      providerId: 'deepseek',
      model: 'deepseek-flash',
      modelOptions: { reasoning: 'none' }
    })
    expect(off.body).toHaveProperty('thinking', { type: 'disabled' })
    expect(off.body).not.toHaveProperty('reasoning_effort')
    const recovery = await wire(openaiAdapter, {
      providerId: 'deepseek',
      model: 'deepseek-flash',
      disableThinking: true
    })
    expect(recovery.body).toMatchObject({ thinking: { type: 'disabled' }, tool_choice: 'none' })
    expect(recovery.body).not.toHaveProperty('service_tier')
  })
  it('sends Claude effort through output_config without an OpenAI billing tier', async () => {
    const { body } = await wire(
      anthropicAdapter,
      { providerId: 'anthropic', model: 'claude-sonnet-4-6' },
      [{ type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }]
    )
    expect(body).toHaveProperty('output_config', { effort: 'high' })
    expect(body).not.toHaveProperty('service_tier')
  })
  it('sends Gemini thinkingLevel under generationConfig', async () => {
    const { body } = await wire(geminiAdapter, { providerId: 'gemini', model: 'gemini-3.1-pro' }, [
      { candidates: [{ content: { parts: [{ text: 'Done' }] }, finishReason: 'STOP' }] }
    ])
    expect(body).toHaveProperty('generationConfig.thinkingConfig', { thinkingLevel: 'high' })
    expect(body).not.toHaveProperty('service_tier')
  })
})

describe('shared model-options drawer', () => {
  it('persists per-model choices, restores them in Settings and blocks changes while busy', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { settings: { set: vi.fn().mockResolvedValue(undefined) } }
    })
    const store = SettingsStore.getInstance()
    store.setMany(
      { 'ai.providerId': 'openai', 'ai.model': 'gpt-6.1-sol', 'ai.modelPreferences': {} },
      false
    )
    const control = new AiModelOptions()
    document.body.append(control)
    await control.updateComplete
    const open = async (): Promise<void> => {
      control.shadowRoot!.querySelector<HTMLButtonElement>('.trigger')!.click()
      await control.updateComplete
    }
    await open()
    const radio = (label: string): HTMLButtonElement =>
      [...control.shadowRoot!.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
        (item) => item.textContent?.trim() === label
      )!
    radio('High').click()
    radio('Fast').click()
    await control.updateComplete
    expect(radio('High').getAttribute('aria-checked')).toBe('true')
    expect(radio('Fast').getAttribute('aria-checked')).toBe('true')
    store.set('ai.model', 'gpt-5.1')
    await control.updateComplete
    expect(control.shadowRoot!.querySelector('writemd-popover')).toBeNull()
    expect(control.shadowRoot!.querySelector('.trigger')?.textContent).toContain('Default')
    store.set('ai.model', 'gpt-6.1-sol')
    control.settingsMode = true
    await control.updateComplete
    await open()
    expect(radio('High').getAttribute('aria-checked')).toBe('true')
    expect(radio('Fast').getAttribute('aria-checked')).toBe('true')
    control.disabled = true
    await control.updateComplete
    await control.updateComplete
    expect(control.shadowRoot!.querySelector('writemd-popover')).toBeNull()
    expect(control.shadowRoot!.querySelector<HTMLButtonElement>('.trigger')?.disabled).toBe(true)
  })
})
