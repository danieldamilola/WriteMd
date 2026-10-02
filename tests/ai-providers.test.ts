import { describe, it, expect } from 'vitest'
import { AI_PROVIDERS, getAiProvider, AiResponseError } from '../src/shared/ai-providers'

const ctx = (
  overrides: Record<string, unknown> = {}
): {
  model: string
  apiKey: string
  messages: { role: 'user'; content: string }[]
  [key: string]: unknown
} => ({
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
    const req = AI_PROVIDERS.OpenAI.buildChatRequest(ctx({ systemPrompt: 'be brief' }))
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(req.headers.Authorization).toBe('Bearer sk-key')
    const body = req.body as { messages: { role: string; content?: string }[]; model: string }
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

  it('reads the answer off a reasoning model that leaves content null', () => {
    // This is the shape that produced "missing choices[0].message.content" for
    // OpenRouter's Nemotron and DeepSeek R1: the answer is in `reasoning`.
    expect(
      AI_PROVIDERS.OpenRouter.extractChatText({
        choices: [{ message: { content: null, reasoning: 'The answer is 42.' } }]
      })
    ).toBe('The answer is 42.')

    expect(
      AI_PROVIDERS.OpenRouter.extractChatText({
        choices: [{ message: { content: '', reasoning_content: 'via OpenAI field' } }]
      })
    ).toBe('via OpenAI field')
  })

  it('joins content when a gateway returns typed parts instead of a string', () => {
    expect(
      AI_PROVIDERS.OpenRouter.extractChatText({
        choices: [
          {
            message: {
              content: [
                { type: 'text', text: 'part one ' },
                { type: 'text', text: 'part two' }
              ]
            }
          }
        ]
      })
    ).toBe('part one part two')
  })

  it('prefers real content over reasoning when both are present', () => {
    expect(
      AI_PROVIDERS.OpenRouter.extractChatText({
        choices: [{ message: { content: 'final', reasoning: 'scratchpad' } }]
      })
    ).toBe('final')
  })

  it('surfaces the provider error when it answers 200 with one', () => {
    // OpenRouter does this on free-tier rate limits and upstream failures.
    expect(() =>
      AI_PROVIDERS.OpenRouter.extractChatText({
        error: { message: 'Provider returned error', code: 429 }
      })
    ).toThrow(/Provider error: Provider returned error \(429\)/)
  })

  it('explains an empty answer using the finish reason', () => {
    expect(() =>
      AI_PROVIDERS.OpenRouter.extractChatText({
        choices: [{ message: { content: '' }, finish_reason: 'length' }]
      })
    ).toThrow(/output limit/)
    expect(() =>
      AI_PROVIDERS.OpenRouter.extractChatText({
        choices: [{ message: { content: '' }, finish_reason: 'content_filter' }]
      })
    ).toThrow(/filtered/)
  })

  it('extracts and sorts model ids', () => {
    expect(AI_PROVIDERS.OpenAI.extractModelIds({ data: [{ id: 'b' }, { id: 'a' }] })).toEqual([
      'a',
      'b'
    ])
    expect(AI_PROVIDERS.GoogleGemini.extractModelIds({ models: [{ name: 'models/m-1' }] })).toEqual(
      ['m-1']
    )
    expect(AI_PROVIDERS.Ollama.extractModelIds({ models: [{ name: 'llama3' }] })).toEqual([
      'llama3'
    ])
  })

  it('returns static model lists without network calls', () => {
    expect(AI_PROVIDERS.Anthropic.staticModels?.length).toBeGreaterThan(0)
    expect(AI_PROVIDERS.Anthropic.buildModelsRequest('k')).toBeNull()
  })
})

/**
 * Vision payloads.
 *
 * Every provider spells an attached image differently, and each of these shapes
 * is wrong in a way that fails at the API with a 400 rather than in the app. They
 * are pinned per provider because the spellings are the whole point.
 */
describe('image attachments', () => {
  const image = { data: 'AAAA', mediaType: 'image/png', name: 'shot.png' }
  const withImage = {
    messages: [
      {
        role: 'user' as const,
        content: 'what is wrong here',
        images: [image]
      }
    ]
  }

  it('sends an OpenAI-shaped message as text plus image_url parts', () => {
    const req = AI_PROVIDERS.OpenAI.buildChatRequest(ctx(withImage))
    const body = req.body as { messages: Record<string, unknown>[] }
    const parts = body.messages[0].content as Record<string, unknown>[]
    expect(parts[0]).toEqual({ type: 'text', text: 'what is wrong here' })
    expect(parts[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAAA' }
    })
  })

  it('sends a Gemini message as inlineData before the text', () => {
    const req = AI_PROVIDERS.GoogleGemini.buildChatRequest(ctx(withImage))
    const body = req.body as { contents: { parts: Record<string, unknown>[] }[] }
    // Order matters to Gemini's payload shape: inlineData carries no `text`,
    // which is exactly why the system prompt below has to find it by shape.
    expect(body.contents[0].parts[0]).toEqual({
      inlineData: { mimeType: 'image/png', data: 'AAAA' }
    })
    expect(body.contents[0].parts[1]).toEqual({ text: 'what is wrong here' })
  })

  it('sends an Anthropic message as image blocks then a text block', () => {
    const req = AI_PROVIDERS.Anthropic.buildChatRequest(ctx(withImage))
    const body = req.body as { messages: { content: Record<string, unknown>[] }[] }
    expect(body.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' }
    })
    expect(body.messages[0].content[1]).toEqual({
      type: 'text',
      text: 'what is wrong here'
    })
  })

  it('does not reshape a text-only message on the OpenAI-shaped providers', () => {
    // Sending a one-part array where a string is expected is accepted by some
    // gateways and rejected by others, so a prompt with no image stays a string.
    for (const id of ['OpenAI', 'Anthropic', 'Ollama']) {
      const body = AI_PROVIDERS[id].buildChatRequest(ctx()).body as {
        messages: Record<string, unknown>[]
      }
      expect(body.messages[0].content).toBe('hi')
      expect(body.messages[0].images).toBeUndefined()
    }
  })

  it('leaves a text-only Gemini message as a single text part', () => {
    // Gemini's payload shape always uses `parts`; that is pre-existing and not
    // something the image support should change.
    const body = AI_PROVIDERS.GoogleGemini.buildChatRequest(ctx()).body as {
      contents: { parts: Record<string, unknown>[] }[]
    }
    expect(body.contents[0].parts).toEqual([{ text: 'hi' }])
  })

  it('never puts an image on an assistant turn', () => {
    // A model echoing an image back is not a shape any of these APIs accept.
    const body = AI_PROVIDERS.OpenAI.buildChatRequest(
      ctx({
        messages: [{ role: 'assistant', content: 'here it is', images: [image] }]
      })
    ).body as { messages: Record<string, unknown>[] }
    expect(body.messages[0].content).toBe('here it is')
    expect(body.messages[0].images).toBeUndefined()
  })

  it('prepends the Gemini system prompt to the text part, not the image', () => {
    // The index-0 assumption held only while every message was text. With an
    // image attached, parts[0] is inlineData and overwriting it would have
    // replaced the picture with prose.
    const body = AI_PROVIDERS.GoogleGemini.buildChatRequest(
      ctx({ ...withImage, systemPrompt: 'be brief' })
    ).body as { contents: { parts: Record<string, unknown>[] }[] }
    const parts = body.contents[0].parts
    expect(parts[0]).toEqual({ inlineData: { mimeType: 'image/png', data: 'AAAA' } })
    expect(parts[1].text).toContain('[SYSTEM INSTRUCTION]')
    expect(parts[1].text).toContain('what is wrong here')
  })

  it('keeps images on a streamed request too', () => {
    const req = AI_PROVIDERS.OpenAI.buildStreamRequest(ctx(withImage))
    expect(req).not.toBeNull()
    const body = req?.body as {
      stream: boolean
      messages: Record<string, unknown>[]
    }
    expect(body.stream).toBe(true)
    expect(Array.isArray(body.messages[0].content)).toBe(true)
  })
})
