import type {
  ChatMessage,
  MessageContent,
  StopReason,
  StreamEvent,
  ToolSpec,
  Usage
} from '../../../shared/ai/types'
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
import { joinUrl } from '../sse'
import { readDataModelIds, ToolCallBuffer } from './tool-call'
import type { ProviderAdapter, ProviderConfig, StreamRequest } from './types'

/**
 * OpenAI Chat Completions.
 *
 * Also the adapter behind the Ollama and LM Studio presets. Both speak the
 * OpenAI-compatible `/v1` shape, so they are a base URL and a model name rather
 * than a fourth and fifth copy of this request builder.
 */

export const openaiDescriptor = {
  id: 'openai',
  label: 'OpenAI',
  kind: 'openai',
  defaultBaseUrl: 'https://api.openai.com/v1',
  defaultModel: 'gpt-4o-mini',
  keyRequired: true,
  keyHint: 'Created at platform.openai.com under API keys.'
} satisfies ProviderAdapter['descriptor']

interface OpenAiToolCallDelta {
  id: string | null
  index: number | null
  name: string | null
  args: string | null
}

function toOpenAiMessages(messages: ChatMessage[], system: string): unknown[] {
  const out: unknown[] = []
  if (system.trim()) out.push({ role: 'system', content: system })
  for (const message of messages) {
    if (message.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: message.toolCallId ?? '',
        name: message.name,
        content: flattenText(message.content)
      })
      continue
    }
    const assistant = message.role === 'assistant'
    const entry: Record<string, unknown> = {
      role: assistant ? 'assistant' : 'user',
      content: toOpenAiContent(message.content)
    }
    if (assistant && message.toolCalls?.length) {
      entry.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) }
      }))
      // A message that only calls tools has no text, and OpenAI rejects the
      // empty string where content is expected.
      if (!hasText(message.content)) entry.content = null
    }
    out.push(entry)
  }
  return out
}

function toOpenAiContent(content: string | MessageContent[]): unknown {
  if (typeof content === 'string') return content
  const hasImage = content.some((block) => block.type === 'image')
  if (!hasImage) return content.map((block) => (block.type === 'text' ? block.text : '')).join('')
  const parts = content.map((block) =>
    block.type === 'text'
      ? { type: 'text', text: block.text }
      : { type: 'image_url', image_url: { url: `data:${block.mimeType};base64,${block.data}` } }
  )
  return parts
}

function flattenText(content: string | MessageContent[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((block): block is Extract<MessageContent, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

function hasText(content: string | MessageContent[]): boolean {
  return typeof content === 'string'
    ? content.trim().length > 0
    : flattenText(content).trim().length > 0
}

function toOpenAiTools(tools: ToolSpec[]): unknown[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }))
}

function mapStopReason(reason: string): StopReason {
  if (reason === 'length') return 'max_tokens'
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_calls'
  if (reason === 'stop' || reason === 'content_filter') return 'end_turn'
  return 'end_turn'
}

function authHeaders(apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  // A local server with no key must not see `Authorization: Bearer undefined`.
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  return headers
}

function readToolCallDeltas(delta: Record<string, unknown>): OpenAiToolCallDelta[] {
  const deltas: OpenAiToolCallDelta[] = []
  for (const entry of asArray(delta.tool_calls)) {
    const record = asRecord(entry)
    if (!record) continue
    const fn = asRecord(record.function)
    deltas.push({
      id: asString(record.id),
      index: asNumber(record.index),
      name: fn ? asString(fn.name) : null,
      args: fn ? asString(fn.arguments) : null
    })
  }
  return deltas
}

/**
 * Ollama's OpenAI-compatible `/v1/models` has existed for a while, but an older
 * server (and some proxies in front of one) answers 404. The native endpoint is
 * still there, so an empty OpenAI-shaped list is treated as "ask the native API"
 * rather than as "this key cannot see any models".
 *
 * Contained here on purpose: `/api/tags` is an Ollama shape, and letting it leak
 * into the shared model-list code would put a local-server quirk in front of
 * every provider.
 */
async function ollamaTagFallback(
  baseUrl: string,
  apiKey: string | undefined,
  signal: AbortSignal
): Promise<string[]> {
  const base = baseUrl.replace(/\/+$/, '')
  const origin = base.replace(/\/v\d+[a-z]*$/i, '')
  if (!origin) return []
  const payload = await requestJson(`${origin}/api/tags`, {
    method: 'GET',
    headers: authHeaders(apiKey),
    signal
  })
  const models = asRecord(payload)?.models
  if (!Array.isArray(models)) return []
  const names: string[] = []
  for (const entry of models) {
    const name = asRecord(entry)?.name
    if (typeof name === 'string') names.push(name)
  }
  return normalizeModelIds(names)
}

export const openaiAdapter: ProviderAdapter = {
  descriptor: openaiDescriptor,

  async listModels(config: ProviderConfig, signal: AbortSignal): Promise<string[]> {
    const baseUrl = assertListingEndpoint(config.baseUrl, config.apiKey)
    const payload = await requestJson(joinUrl(baseUrl, '/models'), {
      method: 'GET',
      headers: authHeaders(config.apiKey),
      signal
    })
    const ids = readDataModelIds(payload)
    if (ids.length > 0) return ids
    return ollamaTagFallback(baseUrl, config.apiKey, signal)
  },

  async *stream(request: StreamRequest): AsyncGenerator<StreamEvent> {
    const baseUrl = assertEndpoint(request.baseUrl, request.model, request.apiKey)
    const headers = authHeaders(request.apiKey)
    headers.accept = 'text/event-stream'

    const body = JSON.stringify({
      model: request.model,
      messages: toOpenAiMessages(request.messages, request.system),
      stream: true,
      // Without this the stream carries no usage at all, and the session cost
      // readout silently reports zero for every provider in this family.
      stream_options: { include_usage: true },
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      ...(request.tools?.length ? { tools: toOpenAiTools(request.tools) } : {})
    })

    const calls = new ToolCallBuffer()
    let stopReason: StopReason | null = null
    let usage: Usage | undefined

    for await (const payload of streamSse({
      url: joinUrl(baseUrl, '/chat/completions'),
      headers,
      body,
      signal: request.signal
    })) {
      const frame = parsePayload(payload)
      if (!frame) continue

      for (const choice of asArray(frame.choices)) {
        const record = asRecord(choice)
        if (!record) continue
        const delta = asRecord(record.delta)
        if (delta) {
          const content = asString(delta.content)
          if (content) yield { type: 'text', delta: content }
          for (const call of readToolCallDeltas(delta)) {
            // `index` is the only key that is stable across fragments: `id` and
            // `name` arrive once, on the first fragment of the call.
            calls.add(String(call.index ?? calls.size), {
              id: call.id,
              name: call.name,
              args: call.args
            })
          }
        }
        const finish = asString(record.finish_reason)
        if (finish) stopReason = mapStopReason(finish)
      }

      const reported = asRecord(frame.usage)
      if (reported) {
        usage = usageWith(
          usage,
          asNumber(reported.prompt_tokens),
          asNumber(reported.completion_tokens)
        )
      }
    }

    // The stream closing is the completion signal for tool calls: OpenAI sends
    // the whole fragmented argument string and then a finish reason, with no
    // per-call "that one is done" event to flush against.
    const emitted = calls.flushAll()
    for (const call of emitted) yield { type: 'tool-call', call }

    // A tool call that actually arrived is the truth about why the model
    // stopped, whatever finish_reason claimed.
    yield {
      type: 'done',
      stopReason: emitted.length > 0 ? 'tool_calls' : (stopReason ?? 'end_turn'),
      ...(usage ? { usage } : {})
    }
  }
}
