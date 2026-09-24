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

interface OpenAIChatResponse {
  choices?: { message?: { content?: string } }[]
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
      const res = data as OpenAIChatResponse
      return expectText(res.choices?.[0]?.message?.content, 'choices[0].message.content')
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
