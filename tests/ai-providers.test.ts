import { describe, it, expect } from 'vitest'
import {
  AI_PROVIDERS,
  getAiProvider,
  AiResponseError
} from '../src/shared/ai-providers'

const ctx = (overrides: Record<string, unknown> = {}) => ({
  model: 'test-model',
  apiKey: 'sk-key',
  messages: [{ role: 'user' as const, content: 'hi' }],
  ...overrides
})

describe('AI provider adapters', () => {
  it('has an adapter for every provider the settings UI offers', () => {
    for (const id of [
      'OpenAI',
      'Groq',
      'Mistral',
      'DeepSeek',
      'xAI',
      'OpenRouter',
      'GoogleGemini',
      'Anthropic',
      'Ollama'
    ]) {
      expect(getAiProvider(id)).toBeDefined()
    }
    expect(getAiProvider('Nope')).toBeUndefined()
  })

  it('builds OpenAI-compatible chat requests with a bearer token', () => {
    const req = AI_PROVIDERS.OpenAI.buildChatRequest(
      ctx({ systemPrompt: 'be brief' })
    )
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(req.headers.Authorization).toBe('Bearer sk-key')
    const body = req.body as { messages: { role: string }[]; model: string }
    expect(body.model).toBe('test-model')
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toBe('be brief')
  })

  it('sends no auth header for Ollama', () => {
    const req = AI_PROVIDERS.Ollama.buildChatRequest(ctx())
    expect(req.url).toContain('localhost:11434')
    expect(req.headers.Authorization).toBeUndefined()
  })

  it('keeps the Gemini key out of the URL and maps roles', () => {
    const req = AI_PROVIDERS.GoogleGemini.buildChatRequest(
      ctx({ systemPrompt: 'sys', messages: [{ role: 'assistant' as const, content: 'a' }] })
    )
    expect(req.url).not.toContain('sk-key')
    expect(req.headers['x-goog-api-key']).toBe('sk-key')
    const body = req.body as { contents: { role: string; parts: { text: string }[] }[] }
    expect(body.contents[0].role).toBe('model')
    expect(body.contents[0].parts[0].text).toContain('[SYSTEM INSTRUCTION]')
  })

  it('uses the system field for Anthropic', () => {
    const req = AI_PROVIDERS.Anthropic.buildChatRequest(ctx({ systemPrompt: 'sys' }))
    expect(req.headers['x-api-key']).toBe('sk-key')
    expect((req.body as { system?: string }).system).toBe('sys')
  })

  it('extracts chat text from each provider shape', () => {
    expect(
      AI_PROVIDERS.OpenAI.extractChatText({
        choices: [{ message: { content: 'ok' } }]
      })
    ).toBe('ok')
    expect(
      AI_PROVIDERS.GoogleGemini.extractChatText({
        candidates: [{ content: { parts: [{ text: 'gem' }] } }]
      })
    ).toBe('gem')
    expect(AI_PROVIDERS.Anthropic.extractChatText({ content: [{ text: 'a' }] })).toBe('a')
  })

  it('throws a clear error on malformed responses', () => {
    expect(() => AI_PROVIDERS.OpenAI.extractChatText({})).toThrow(AiResponseError)
    expect(() => AI_PROVIDERS.GoogleGemini.extractChatText({ candidates: [] })).toThrow(
      AiResponseError
    )
  })

  it('extracts and sorts model ids', () => {
    expect(
      AI_PROVIDERS.OpenAI.extractModelIds({ data: [{ id: 'b' }, { id: 'a' }] })
    ).toEqual(['a', 'b'])
    expect(
      AI_PROVIDERS.GoogleGemini.extractModelIds({ models: [{ name: 'models/m-1' }] })
    ).toEqual(['m-1'])
    expect(AI_PROVIDERS.Ollama.extractModelIds({ models: [{ name: 'llama3' }] })).toEqual([
      'llama3'
    ])
  })

  it('returns static model lists without network calls', () => {
    expect(AI_PROVIDERS.Anthropic.staticModels?.length).toBeGreaterThan(0)
    expect(AI_PROVIDERS.Anthropic.buildModelsRequest('k')).toBeNull()
  })
})
