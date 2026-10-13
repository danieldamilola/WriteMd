import { NativeToolTextGuard, NATIVE_TOOL_MARKUP_ERROR } from './native-tool-markup'
import type {
  ChatMessage,
  MessageContent,
  ProviderMetadata,
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
  INTERRUPTED_STREAM_MESSAGE,
  normalizeModelIds,
  parsePayload,
  ProviderHttpError,
  redactSecrets,
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
  extraContent: Record<string, unknown> | null
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
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        ...(call.extraContent ? { extra_content: call.extraContent } : {})
      }))
      // A message that only calls tools has no text, and OpenAI rejects the
      // empty string where content is expected.
      if (!hasText(message.content)) entry.content = null
    }
    const metadata = assistant ? message.providerMetadata?.openai : undefined
    if (metadata) {
      if (metadata.reasoningContent !== undefined)
        entry.reasoning_content = metadata.reasoningContent
      if (metadata.reasoning !== undefined) entry.reasoning = metadata.reasoning
      if (metadata.reasoningDetails) entry.reasoning_details = metadata.reasoningDetails
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
  if (reason === 'stop') return 'end_turn'
  return 'error'
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
      args: fn ? asString(fn.arguments) : null,
      extraContent: asRecord(record.extra_content)
    })
  }
  return deltas
}

/** Known non-chat families cannot use this adapter's Chat Completions route. */
function isChatModel(id: string): boolean {
  const name = id.replace(/^ft:/, '').split(':')[0].toLowerCase()
  return !(
    /^(?:text-embedding|text-moderation|omni-moderation|tts-|whisper-|dall-e-|gpt-image-|sora(?:-|$)|babbage-|davinci-|computer-use-|codex-mini-)/.test(
      name
    ) ||
    /(?:^|-)(?:realtime|transcribe|tts|embedding|moderation|deep-research|codex)(?:-|$)/.test(
      name
    ) ||
    /^(?:o\d+|gpt-\d+(?:\.\d+)?)-pro(?:-|$)/.test(name) ||
    name.endsWith('-instruct')
  )
}

/** Cloud catalogues also contain audio, image and embedding-only models. */
function chatModelIds(payload: unknown, config: ProviderConfig): string[] {
  const host = new URL(config.baseUrl).hostname
  const nativeOpenAi = config.providerId === 'openai' || host === 'api.openai.com'
  const openrouter = config.providerId === 'openrouter' || host === 'openrouter.ai'
  const mistral = config.providerId === 'mistral' || host === 'api.mistral.ai'
  const groq = config.providerId === 'groq' || host === 'api.groq.com'
  const xai = config.providerId === 'xai' || host === 'api.x.ai'
  const entries = asArray(asRecord(payload)?.data).filter((entry) => {
    const record = asRecord(entry)
    const id = record ? asString(record.id) : null
    if (!id) return false
    if (nativeOpenAi) return isChatModel(id)
    if (openrouter) {
      const output = asRecord(record?.architecture)?.output_modalities
      return !Array.isArray(output) || output.includes('text')
    }
    if (mistral && asRecord(record?.capabilities)?.completion_chat === false) return false
    if (groq || mistral || xai) {
      return !/(?:^|[/-])(?:whisper|orpheus|prompt-guard|safeguard|embed|embedding|imagine|voxtral)(?:-|$)/i.test(
        id
      )
    }
    return true
  })
  return readDataModelIds({ data: entries })
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
    // A cloud provider with an empty catalogue must not use Ollama's endpoint.
    const ollama =
      config.providerId === 'ollama' || (!config.providerId && new URL(baseUrl).port === '11434')
    try {
      const payload = await requestJson(joinUrl(baseUrl, '/models'), {
        method: 'GET',
        headers: authHeaders(config.apiKey),
        signal
      })
      const ids = chatModelIds(payload, config)
      if (ids.length > 0 || !ollama) return ids
    } catch (error) {
      if (!ollama || !(error instanceof ProviderHttpError) || error.status !== 404) throw error
    }
    return ollamaTagFallback(baseUrl, config.apiKey, signal)
  },

  async *stream(request: StreamRequest): AsyncGenerator<StreamEvent> {
    const baseUrl = assertEndpoint(request.baseUrl, request.model, request.apiKey)
    const headers = authHeaders(request.apiKey)
    headers.accept = 'text/event-stream'
    const reasoningModel = /^(?:ft:)?(?:o\d+(?:[:-]|$)|gpt-(?:[5-9]|\d{2,})(?:[:.-]|$))/.test(
      request.model
    )

    const body = JSON.stringify({
      model: request.model,
      messages: toOpenAiMessages(request.messages, request.system),
      stream: true,
      // Without this the stream carries no usage at all, and the session cost
      // readout silently reports zero for every provider in this family.
      ...(new URL(baseUrl).hostname === 'api.mistral.ai'
        ? {}
        : { stream_options: { include_usage: true } }),
      ...(reasoningModel
        ? { max_completion_tokens: request.maxTokens }
        : { max_tokens: request.maxTokens, temperature: request.temperature }),
      ...(request.tools?.length ? { tools: toOpenAiTools(request.tools) } : {}),
      ...(request.disableThinking && new URL(baseUrl).hostname === 'api.deepseek.com'
        ? { thinking: { type: 'disabled' }, tool_choice: 'none' }
        : {})
    })

    const calls = new ToolCallBuffer()
    let stopReason: StopReason | null = null
    let usage: Usage | undefined
    let completed = false
    const contentGuard = new NativeToolTextGuard()
    const metadata: NonNullable<ProviderMetadata['openai']> = {}

    for await (const payload of streamSse({
      url: joinUrl(baseUrl, '/chat/completions'),
      headers,
      body,
      signal: request.signal,
      isComplete: () => stopReason !== null
    })) {
      if (payload.trim() === '[DONE]') {
        completed = true
        break
      }
      const frame = parsePayload(payload)
      if (!frame) continue
      if (frame.error) {
        const message = asString(asRecord(frame.error)?.message) ?? asString(frame.error)
        yield {
          type: 'error',
          message: redactSecrets(
            message ?? 'The provider could not complete the response.',
            headers
          )
        }
        return
      }

      for (const choice of asArray(frame.choices)) {
        const record = asRecord(choice)
        if (!record) continue
        const delta = asRecord(record.delta)
        if (delta) {
          // Keep these in main for signed tool replay; they are not reply text.
          const reasoningContent = asString(delta.reasoning_content)
          if (reasoningContent !== null) {
            metadata.reasoningContent = (metadata.reasoningContent ?? '') + reasoningContent
          }
          const reasoning = asString(delta.reasoning)
          if (reasoning !== null) metadata.reasoning = (metadata.reasoning ?? '') + reasoning
          for (const detail of asArray(delta.reasoning_details)) {
            const part = asRecord(detail)
            if (part) (metadata.reasoningDetails ??= []).push(part)
          }
          const content = asString(delta.content)
          if (content) {
            const prose = contentGuard.push(content)
            if (prose) yield { type: 'text', delta: prose }
          }
          const refusal = asString(delta.refusal)
          if (refusal) yield { type: 'text', delta: refusal }
          for (const call of readToolCallDeltas(delta)) {
            // `index` is the only key that is stable across fragments: `id` and
            // `name` arrive once, on the first fragment of the call.
            calls.add(String(call.index ?? calls.size), {
              id: call.id,
              name: call.name,
              args: call.args,
              extraContent: call.extraContent
            })
          }
        }
        const finish = asString(record.finish_reason)
        if (finish) {
          stopReason = mapStopReason(finish)
          if (stopReason === 'error') {
            yield {
              type: 'error',
              message: `The provider stopped this response (${finish}). Try rephrasing the message.`
            }
          }
        }
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
    if (!completed && stopReason === null) throw new Error(INTERRUPTED_STREAM_MESSAGE)
    const emitted = stopReason === 'error' ? [] : calls.flushAll()
    if (contentGuard.native && emitted.length === 0) throw new Error(NATIVE_TOOL_MARKUP_ERROR)
    const remaining = contentGuard.finish()
    if (remaining) yield { type: 'text', delta: remaining }
    for (const call of emitted) yield { type: 'tool-call', call }

    // A tool call that actually arrived is the truth about why the model
    // stopped, whatever finish_reason claimed.
    yield {
      type: 'done',
      stopReason: emitted.length > 0 ? 'tool_calls' : (stopReason ?? 'end_turn'),
      ...(usage ? { usage } : {}),
      ...(Object.keys(metadata).length ? { providerMetadata: { openai: metadata } } : {})
    }
  }
}
