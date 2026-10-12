import type {
  ChatMessage,
  MessageContent,
  StopReason,
  StreamEvent,
  ToolSpec,
  Usage
} from '../../../shared/ai/types'
import { joinUrl } from '../sse'
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  assertEndpoint,
  assertListingEndpoint,
  normalizeModelIds,
  parsePayload,
  requestJson,
  streamSse,
  usageWith
} from './http'
import { ToolCallBuffer } from './tool-call'
import type { ProviderAdapter, ProviderConfig, StreamRequest } from './types'

/**
 * Google Gemini.
 *
 * The API differs from the other two in ways that all end up in the same three
 * places: the model is part of the URL rather than the body, auth is a header
 * rather than a bearer token, and a turn is a list of `parts` where a function
 * call is a part like any other.
 */

export const geminiDescriptor = {
  id: 'gemini',
  label: 'Gemini',
  kind: 'gemini',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  defaultModel: 'gemini-2.5-flash',
  keyRequired: true,
  keyHint: 'Created at aistudio.google.com under Get API key.'
} satisfies ProviderAdapter['descriptor']

type GeminiPart = Record<string, unknown>

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

function toGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = []
  const push = (role: 'user' | 'model', parts: GeminiPart[]): void => {
    if (parts.length === 0) return
    const previous = contents[contents.length - 1]
    // Gemini is stricter than it looks about role alternation, and two tool
    // results in a row are one user turn.
    if (previous && previous.role === role) previous.parts.push(...parts)
    else contents.push({ role, parts })
  }

  for (const message of messages) {
    if (message.role === 'tool') {
      push('user', [
        {
          functionResponse: {
            name: message.name ?? message.toolCallId ?? 'tool',
            response: { result: flattenText(message.content) }
          }
        }
      ])
      continue
    }
    const model = message.role === 'assistant'
    const parts: GeminiPart[] = [...toGeminiParts(message.content)]
    for (const call of message.toolCalls ?? []) {
      parts.push({ functionCall: { id: call.id, name: call.name, args: call.arguments } })
    }
    push(model ? 'model' : 'user', parts)
  }

  if (contents.length > 0 && contents[0].role === 'model') {
    contents.unshift({ role: 'user', parts: [{ text: '(continue)' }] })
  }
  return contents
}

function toGeminiParts(content: string | MessageContent[]): GeminiPart[] {
  if (typeof content === 'string') return content ? [{ text: content }] : []
  return content.map((block) =>
    block.type === 'text'
      ? { text: block.text }
      : { inlineData: { mimeType: block.mimeType, data: block.data } }
  )
}

function flattenText(content: string | MessageContent[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((block): block is Extract<MessageContent, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

function toGeminiTools(tools: ToolSpec[]): unknown[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }))
    }
  ]
}

function mapFinishReason(reason: string): StopReason {
  if (reason === 'MAX_TOKENS') return 'max_tokens'
  if (reason === 'STOP' || reason === 'STOP_SEQUENCE') return 'end_turn'
  // The safety family stops generation without producing anything runnable.
  if (reason === 'SAFETY' || reason === 'RECITATION' || reason === 'BLOCKLIST') return 'error'
  if (reason === 'PROHIBITED_CONTENT' || reason === 'SPII') return 'error'
  if (reason === 'MALFORMED_FUNCTION_CALL') return 'error'
  return 'end_turn'
}

function headers(apiKey: string | undefined, accept: string): Record<string, string> {
  const out: Record<string, string> = { 'content-type': 'application/json', accept }
  if (apiKey) out['x-goog-api-key'] = apiKey
  return out
}

/** The model list reports `models/<id>`; the request path needs only `<id>`. */
export function stripModelsPrefix(name: string): string {
  const trimmed = name.trim()
  return trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed
}

export const geminiAdapter: ProviderAdapter = {
  descriptor: geminiDescriptor,

  async listModels(config: ProviderConfig, signal: AbortSignal): Promise<string[]> {
    const baseUrl = assertListingEndpoint(config.baseUrl, config.apiKey)
    const payload = await requestJson(joinUrl(baseUrl, '/models'), {
      method: 'GET',
      headers: headers(config.apiKey, 'application/json'),
      signal
    })
    const models = asRecord(payload)?.models
    if (!Array.isArray(models)) return []
    const ids: string[] = []
    for (const entry of models) {
      const name = asRecord(entry)?.name
      if (typeof name !== 'string') continue
      const id = stripModelsPrefix(name)
      if (id) ids.push(id)
    }
    return normalizeModelIds(ids)
  },

  async *stream(request: StreamRequest): AsyncGenerator<StreamEvent> {
    const baseUrl = assertEndpoint(request.baseUrl, request.model, request.apiKey)
    const model = stripModelsPrefix(request.model)
    const body = JSON.stringify({
      contents: toGeminiContents(request.messages),
      ...(request.system.trim()
        ? { systemInstruction: { role: 'user', parts: [{ text: request.system }] } }
        : {}),
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        temperature: request.temperature
      },
      ...(request.tools?.length ? { tools: toGeminiTools(request.tools) } : {})
    })

    const calls = new ToolCallBuffer()
    let stopReason: StopReason | null = null
    let usage: Usage | undefined
    let callSeq = 0

    for await (const payload of streamSse({
      // `alt=sse` is what turns this endpoint from a JSON array into an event
      // stream; without it the response arrives whole and the adapter hangs.
      url: `${joinUrl(baseUrl, `/models/${model}:streamGenerateContent`)}?alt=sse`,
      headers: headers(request.apiKey, 'text/event-stream'),
      body,
      signal: request.signal
    })) {
      const frame = parsePayload(payload)
      if (!frame) continue

      for (const entry of asArray(frame.candidates)) {
        const candidate = asRecord(entry)
        if (!candidate) continue
        const parts = asArray(asRecord(candidate.content)?.parts)
        for (const raw of parts) {
          const part = asRecord(raw)
          if (!part) continue
          const text = asString(part.text)
          if (text) {
            yield { type: 'text', delta: text }
            continue
          }
          const call = asRecord(part.functionCall)
          if (!call) continue
          // Gemini normally delivers a function call whole, but the part is
          // buffered anyway: a split one would otherwise reach the runner as two
          // calls with the same name and half an argument each.
          const id = asString(call.id) ?? `gemini_call_${++callSeq}`
          const args = asRecord(call.args)
          calls.add(id, {
            id,
            name: asString(call.name),
            args: args ? JSON.stringify(args) : '{}'
          })
        }
        const finish = asString(candidate.finishReason)
        if (finish) stopReason = mapFinishReason(finish)
      }

      const reported = asRecord(frame.usageMetadata)
      if (reported) {
        usage =
          usageWith(
            usage,
            asNumber(reported.promptTokenCount),
            asNumber(reported.candidatesTokenCount)
          ) ?? usage
      }
    }

    const emitted = calls.flushAll()
    for (const call of emitted) yield { type: 'tool-call', call }

    yield {
      type: 'done',
      stopReason: emitted.length > 0 ? 'tool_calls' : (stopReason ?? 'end_turn'),
      ...(usage ? { usage } : {})
    }
  }
}
