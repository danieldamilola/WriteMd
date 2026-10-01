import type { ChatMessage } from './electron-api'

/**
 * Pure AI provider adapters. No Electron imports - `ipc.ts` executes the
 * requests they describe, and unit tests can exercise them without mocking.
 */

export interface AiRequestContext {
  model: string
  apiKey: string
  messages: ChatMessage[]
  systemPrompt?: string
}

export interface AiRequest {
  url: string
  headers: Record<string, string>
  body: unknown
}

export interface AiProviderAdapter {
  id: string
  buildChatRequest(ctx: AiRequestContext): AiRequest
  extractChatText(data: unknown): string
  /** Returns null when the provider has no discoverable model list. */
  buildModelsRequest(apiKey: string): AiRequest | null
  extractModelIds(data: unknown): string[]
  staticModels?: string[]
}

/** Thrown when a provider response does not contain the expected shape. */
export class AiResponseError extends Error {}

function expectText(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AiResponseError(`Unexpected response from provider: missing ${what}`)
  }
  return value
}

interface ContentPart {
  type?: string
  text?: string
}
interface OpenAIChoice {
  message?: {
    content?: string | ContentPart[] | null
    reasoning?: string
    reasoning_content?: string
  }
  finish_reason?: string | null
}
interface OpenAIChatResponse {
  choices?: OpenAIChoice[]
  /** OpenRouter and friends answer 200 with an error object on some failures. */
  error?: { message?: string; code?: number | string }
}

const FINISH_REASONS: Record<string, string> = {
  length: 'the model hit the output limit before finishing',
  content_filter: 'the provider filtered the response',
  'tool-calls': 'the model asked for a tool call, which this editor does not send'
}

/**
 * Pull the assistant text out of an OpenAI-shaped message.
 *
 * `content` is a string in the common case, but not always:
 *
 *   - reasoning models (OpenRouter's Nemotron and DeepSeek R1, OpenAI's o-series)
 *     can return `content: null` and put the text in `reasoning`, which is what
 *     produced "missing choices[0].message.content" for a correctly working key
 *   - some gateways return `content` as an array of typed parts
 *   - the field can be an empty string when the answer was cut off
 *
 * Returns '' when there is genuinely no text, so the caller can decide how to
 * report it with the finish reason to hand.
 */
function messageText(choice: OpenAIChoice): string {
  const message = choice.message
  if (!message) return ''

  const content = message.content
  if (typeof content === 'string' && content.trim()) return content
  if (Array.isArray(content)) {
    const joined = content
      .filter((p) => p?.type === 'text' || typeof p?.text === 'string')
      .map((p) => p.text ?? '')
      .join('')
      .trim()
    if (joined) return joined
  }

  // Reasoning models put the answer here when content is null.
  const reasoning = message.reasoning ?? message.reasoning_content
  if (typeof reasoning === 'string' && reasoning.trim()) return reasoning

  return ''
}

/** The provider's own error, when it answered 200 with one. */
function providerError(data: unknown): string | null {
  const res = data as OpenAIChatResponse
  const err = res?.error
  if (!err) return null
  const code = err.code !== undefined ? ` (${String(err.code)})` : ''
  return typeof err.message === 'string' && err.message ? `${err.message}${code}` : null
}
interface OpenAIModelsResponse {
  data?: { id?: string }[]
}

function openaiCompatible(
  id: string,
  chatUrl: string,
  modelsUrl: string,
  withAuth: boolean
): AiProviderAdapter {
  return {
    id,
    buildChatRequest({ model, apiKey, messages, systemPrompt }) {
      const finalMessages: ChatMessage[] = systemPrompt
        ? [{ role: 'system', content: systemPrompt }, ...messages]
        : messages
      const headers: Record<string, string> = {}
      if (withAuth) headers.Authorization = `Bearer ${apiKey}`
      return {
        url: chatUrl,
        headers,
        body: { model, messages: finalMessages }
      }
    },
    extractChatText(data: unknown): string {
      const err = providerError(data)
      if (err) throw new AiResponseError(`Provider error: ${err}`)
      const choice = (data as OpenAIChatResponse).choices?.[0]
      const text = choice ? messageText(choice) : ''
      if (text) return text
      const finish = choice?.finish_reason
      if (finish && FINISH_REASONS[finish]) {
        throw new AiResponseError(`The model returned no answer: ${FINISH_REASONS[finish]}.`)
      }
      return expectText(text, 'choices[0].message.content')
    },
    buildModelsRequest(apiKey: string): AiRequest {
      const headers: Record<string, string> = {}
      if (withAuth) headers.Authorization = `Bearer ${apiKey}`
      return {
        url: modelsUrl,
        headers,
        body: null
      }
    },
    extractModelIds(data: unknown): string[] {
      const res = data as OpenAIModelsResponse
      return (res.data ?? [])
        .map((m) => m.id ?? '')
        .filter(Boolean)
        .sort()
    }
  }
}

interface GeminiChatResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
}
interface GeminiModelsResponse {
  models?: { name?: string }[]
}
interface AnthropicChatResponse {
  content?: { text?: string }[]
}
interface OllamaModelsResponse {
  models?: { name?: string }[]
}

const gemini: AiProviderAdapter = {
  id: 'GoogleGemini',
  buildChatRequest({ model, apiKey, messages, systemPrompt }) {
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))
    // Gemini has no top-level system role in this payload shape, so prepend it
    // to the first user message (pre-existing behavior, kept for parity).
    if (systemPrompt && contents.length > 0 && contents[0].parts[0]) {
      contents[0].parts[0].text = `[SYSTEM INSTRUCTION]\n${systemPrompt}\n\n[USER MESSAGE]\n${contents[0].parts[0].text}`
    }
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      // Key goes in a header, never in the URL query string.
      headers: { 'x-goog-api-key': apiKey },
      body: { contents }
    }
  },
  extractChatText(data: unknown): string {
    const res = data as GeminiChatResponse
    return expectText(res.candidates?.[0]?.content?.parts?.[0]?.text, 'candidates[0].content')
  },
  buildModelsRequest(apiKey: string): AiRequest {
    return {
      url: 'https://generativelanguage.googleapis.com/v1beta/models',
      headers: { 'x-goog-api-key': apiKey },
      body: null
    }
  },
  extractModelIds(data: unknown): string[] {
    const res = data as GeminiModelsResponse
    return (res.models ?? [])
      .map((m) => (m.name ?? '').replace('models/', ''))
      .filter(Boolean)
      .sort()
  }
}

const anthropic: AiProviderAdapter = {
  id: 'Anthropic',
  staticModels: ['claude-3-5-sonnet-20240620', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
  buildChatRequest({ model, apiKey, messages, systemPrompt }) {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: {
        model,
        max_tokens: 1024,
        ...(systemPrompt && { system: systemPrompt }),
        messages
      }
    }
  },
  extractChatText(data: unknown): string {
    const res = data as AnthropicChatResponse
    return expectText(res.content?.[0]?.text, 'content[0].text')
  },
  buildModelsRequest(): null {
    return null
  },
  extractModelIds(): string[] {
    return []
  }
}

const ollama: AiProviderAdapter = {
  ...openaiCompatible('Ollama', 'http://localhost:11434/v1/chat/completions', '', false),
  buildModelsRequest(): AiRequest {
    return { url: 'http://localhost:11434/api/tags', headers: {}, body: null }
  },
  extractModelIds(data: unknown): string[] {
    const res = data as OllamaModelsResponse
    return (res.models ?? [])
      .map((m) => m.name ?? '')
      .filter(Boolean)
      .sort()
  }
}

export const AI_PROVIDERS: Record<string, AiProviderAdapter> = {
  OpenAI: openaiCompatible(
    'OpenAI',
    'https://api.openai.com/v1/chat/completions',
    'https://api.openai.com/v1/models',
    true
  ),
  Groq: openaiCompatible(
    'Groq',
    'https://api.groq.com/openai/v1/chat/completions',
    'https://api.groq.com/openai/v1/models',
    true
  ),
  Mistral: openaiCompatible(
    'Mistral',
    'https://api.mistral.ai/v1/chat/completions',
    'https://api.mistral.ai/v1/models',
    true
  ),
  DeepSeek: openaiCompatible(
    'DeepSeek',
    'https://api.deepseek.com/chat/completions',
    'https://api.deepseek.com/models',
    true
  ),
  xAI: openaiCompatible(
    'xAI',
    'https://api.x.ai/v1/chat/completions',
    'https://api.x.ai/v1/models',
    true
  ),
  OpenRouter: openaiCompatible(
    'OpenRouter',
    'https://openrouter.ai/api/v1/chat/completions',
    'https://openrouter.ai/api/v1/models',
    true
  ),
  GoogleGemini: gemini,
  Anthropic: anthropic,
  Ollama: ollama
}

export function getAiProvider(provider: string): AiProviderAdapter | undefined {
  return AI_PROVIDERS[provider]
}
