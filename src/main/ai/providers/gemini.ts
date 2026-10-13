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
  INTERRUPTED_STREAM_MESSAGE,
  normalizeModelIds,
  parsePayload,
  redactSecrets,
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
    const replay = model ? message.providerMetadata?.gemini : undefined
    if (replay) {
      push('model', [...replay.parts])
      continue
    }
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
  // Every other reason describes a blocked or malformed response.
  return 'error'
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
    const ids: string[] = []
    const cursors = new Set<string>()
    let cursor = ''
    do {
      const url = new URL(joinUrl(baseUrl, '/models'))
      if (cursor) url.searchParams.set('pageToken', cursor)
      const payload = await requestJson(url.toString(), {
        method: 'GET',
        headers: headers(config.apiKey, 'application/json'),
        signal
      })
      const page = asRecord(payload)
      for (const entry of asArray(page?.models)) {
        const model = asRecord(entry)
        const name = asString(model?.name)
        if (!name) continue
        const methods = model?.supportedGenerationMethods
        if (Array.isArray(methods) && !methods.includes('generateContent')) continue
        const id = stripModelsPrefix(name)
        if (id) ids.push(id)
      }
      cursor = asString(page?.nextPageToken) ?? ''
      if (cursor && cursors.has(cursor))
        throw new Error('The provider returned an invalid model page. Try refreshing the models.')
      if (cursor) cursors.add(cursor)
    } while (cursor)
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
    const responseParts: GeminiPart[] = []
    let stopReason: StopReason | null = null
    let usage: Usage | undefined
    let callSeq = 0

    for await (const payload of streamSse({
      // `alt=sse` is what turns this endpoint from a JSON array into an event
      // stream; without it the response arrives whole and the adapter hangs.
      url: `${joinUrl(baseUrl, `/models/${encodeURIComponent(model)}:streamGenerateContent`)}?alt=sse`,
      headers: headers(request.apiKey, 'text/event-stream'),
      body,
      signal: request.signal
    })) {
      const frame = parsePayload(payload)
      if (!frame) continue
      if (frame.error) {
        yield {
          type: 'error',
          message: redactSecrets(
            asString(asRecord(frame.error)?.message) ?? 'Gemini could not complete the response.',
            headers(request.apiKey, 'text/event-stream')
          )
        }
        return
      }
      const blocked = asString(asRecord(frame.promptFeedback)?.blockReason)
      if (blocked && blocked !== 'BLOCK_REASON_UNSPECIFIED') {
        yield {
          type: 'error',
          message: `Gemini blocked this prompt (${blocked}). Rephrase the message and try again.`
        }
        return
      }

      for (const entry of asArray(frame.candidates)) {
        const candidate = asRecord(entry)
        if (!candidate) continue
        const parts = asArray(asRecord(candidate.content)?.parts)
        for (const raw of parts) {
          const part = asRecord(raw)
          if (!part) continue
          // Signatures belong to their original parts, including text and
          // thought parts. Replay them unchanged when returning tool results.
          responseParts.push(part)
          // Thought summaries are separate from the assistant's reply.
          if (part.thought === true) continue
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
        if (finish) {
          stopReason = mapFinishReason(finish)
          if (stopReason === 'error') {
            yield {
              type: 'error',
              message: `Gemini could not finish this response (${finish}). Try rephrasing the message.`
            }
          }
        }
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

    if (stopReason === null) throw new Error(INTERRUPTED_STREAM_MESSAGE)
    const emitted = stopReason === 'error' ? [] : calls.flushAll()
    for (const call of emitted) yield { type: 'tool-call', call }

    yield {
      type: 'done',
      stopReason: emitted.length > 0 ? 'tool_calls' : (stopReason ?? 'end_turn'),
      ...(emitted.length > 0 ? { providerMetadata: { gemini: { parts: responseParts } } } : {}),
      ...(usage ? { usage } : {})
    }
  }
}
