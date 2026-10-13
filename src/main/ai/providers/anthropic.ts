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
import { readDataModelIds, ToolCallBuffer } from './tool-call'
import type { ProviderAdapter, ProviderConfig, StreamRequest } from './types'

/**
 * Anthropic Messages API.
 *
 * The stream here is the only one of the three that is explicitly typed: every
 * frame carries `type`, and the same conceptual event (a text delta, a tool
 * argument fragment) arrives under a different key in every provider. Keying off
 * the type rather than sniffing the payload is what keeps `text_delta` from
 * being read as an unknown shape and silently dropped.
 */

export const anthropicDescriptor = {
  id: 'anthropic',
  label: 'Anthropic',
  kind: 'anthropic',
  defaultBaseUrl: 'https://api.anthropic.com/v1',
  defaultModel: 'claude-sonnet-4-5',
  keyRequired: true,
  keyHint: 'Created at console.anthropic.com under API Keys.'
} satisfies ProviderAdapter['descriptor']

const API_VERSION = '2023-06-01'

type AnthropicBlock = Record<string, unknown>

interface AnthropicMessage {
  role: 'user' | 'assistant'
  /** The wire field name, so the JSON is built rather than reshaped later. */
  content: AnthropicBlock[]
}

/**
 * Anthropic requires strictly alternating user/assistant turns and a leading
 * user turn. Several tool results in a row - which is what a parallel tool loop
 * produces - arrive here as consecutive `tool` messages, so they are merged into
 * one user turn rather than sent as a shape the API rejects.
 */
function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const turns: AnthropicMessage[] = []
  const push = (role: 'user' | 'assistant', content: AnthropicBlock[]): void => {
    if (content.length === 0) return
    const previous = turns[turns.length - 1]
    if (previous && previous.role === role) previous.content.push(...content)
    else turns.push({ role, content })
  }

  for (const message of messages) {
    if (message.role === 'tool') {
      push('user', [
        {
          type: 'tool_result',
          tool_use_id: message.toolCallId ?? '',
          name: message.name,
          content: flattenText(message.content)
        }
      ])
      continue
    }
    const assistant = message.role === 'assistant'
    const blocks: AnthropicBlock[] = []
    if (assistant) {
      const toolCalls = message.toolCalls ?? []
      // An assistant turn with no prose and no tool calls would be an empty
      // content array, which the API rejects.
      for (const block of toAnthropicBlocks(message.content)) blocks.push(block)
      for (const call of toolCalls) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments })
      }
    } else {
      blocks.push(...toAnthropicBlocks(message.content))
    }
    push(assistant ? 'assistant' : 'user', blocks)
  }

  // Anthropic refuses a conversation that opens on the assistant.
  if (turns.length > 0 && turns[0].role === 'assistant') {
    turns.unshift({ role: 'user', content: [{ type: 'text', text: '(continue)' }] })
  }
  return turns
}

function toAnthropicBlocks(content: string | MessageContent[]): AnthropicBlock[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  return content.map((block) =>
    block.type === 'text'
      ? { type: 'text', text: block.text }
      : { type: 'image', source: { type: 'base64', media_type: block.mimeType, data: block.data } }
  )
}

function flattenText(content: string | MessageContent[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((block): block is Extract<MessageContent, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

function toAnthropicTools(tools: ToolSpec[]): unknown[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  }))
}

function mapStopReason(reason: string): StopReason {
  if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') return 'max_tokens'
  if (reason === 'tool_use') return 'tool_calls'
  if (reason === 'stop_sequence') return 'stop_sequence'
  if (reason === 'end_turn' || reason === 'refusal') return 'end_turn'
  return 'error'
}

function headers(apiKey: string | undefined, accept: string): Record<string, string> {
  const out: Record<string, string> = {
    'anthropic-version': API_VERSION,
    'content-type': 'application/json',
    accept
  }
  if (apiKey) out['x-api-key'] = apiKey
  return out
}

export const anthropicAdapter: ProviderAdapter = {
  descriptor: anthropicDescriptor,

  async listModels(config: ProviderConfig, signal: AbortSignal): Promise<string[]> {
    const baseUrl = assertListingEndpoint(config.baseUrl, config.apiKey)
    const ids: string[] = []
    const cursors = new Set<string>()
    let cursor = ''
    do {
      const url = new URL(joinUrl(baseUrl, '/models'))
      if (cursor) url.searchParams.set('after_id', cursor)
      const payload = await requestJson(url.toString(), {
        method: 'GET',
        headers: headers(config.apiKey, 'application/json'),
        signal
      })
      ids.push(...readDataModelIds(payload))
      const page = asRecord(payload)
      if (page?.has_more !== true) break
      cursor = asString(page.last_id) ?? ''
      if (!cursor || cursors.has(cursor))
        throw new Error('The provider returned an invalid model page. Try refreshing the models.')
      cursors.add(cursor)
    } while (cursor)
    return normalizeModelIds(ids)
  },

  async *stream(request: StreamRequest): AsyncGenerator<StreamEvent> {
    const baseUrl = assertEndpoint(request.baseUrl, request.model, request.apiKey)
    const body = JSON.stringify({
      model: request.model,
      // Anthropic has no `system` message role; it is a top-level string.
      system: request.system,
      // max_tokens is required by this API, unlike the others.
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature,
      messages: toAnthropicMessages(request.messages),
      stream: true,
      ...(request.tools?.length ? { tools: toAnthropicTools(request.tools) } : {})
    })

    const calls = new ToolCallBuffer()
    let stopReason: StopReason | null = null
    let usage: Usage | undefined
    let completed = false

    for await (const payload of streamSse({
      url: joinUrl(baseUrl, '/messages'),
      headers: headers(request.apiKey, 'text/event-stream'),
      body,
      signal: request.signal
    })) {
      const frame = parsePayload(payload)
      if (!frame) continue
      const type = asString(frame.type)
      const index = asNumber(frame.index)

      switch (type) {
        case 'message_start': {
          const reported = asRecord(asRecord(frame.message)?.usage)
          if (reported) {
            usage = usageWith(usage, asNumber(reported.input_tokens), null) ?? usage
          }
          break
        }
        case 'content_block_start': {
          const block = asRecord(frame.content_block)
          if (block && index !== null && asString(block.type) === 'tool_use') {
            calls.add(String(index), { id: asString(block.id), name: asString(block.name) })
          }
          break
        }
        case 'content_block_delta': {
          const delta = asRecord(frame.delta)
          const deltaType = delta ? asString(delta.type) : null
          if (deltaType === 'text_delta') {
            const text = delta ? asString(delta.text) : null
            if (text) yield { type: 'text', delta: text }
          } else if (deltaType === 'input_json_delta' && index !== null) {
            calls.add(String(index), { args: delta ? asString(delta.partial_json) : null })
          }
          break
        }
        case 'content_block_stop': {
          // This is the per-call completion signal: everything after it belongs
          // to the next block, so the call can be finalized now.
          if (index === null) break
          const call = calls.flushKey(String(index))
          if (call) {
            yield { type: 'tool-call', call }
            stopReason = 'tool_calls'
          }
          break
        }
        case 'message_delta': {
          const reason = asString(asRecord(frame.delta)?.stop_reason)
          if (reason) {
            stopReason = mapStopReason(reason)
            if (stopReason === 'error') {
              yield {
                type: 'error',
                message: `Anthropic stopped this response (${reason}). Try sending the message again.`
              }
            }
          }
          const reported = asRecord(frame.usage)
          if (reported) {
            usage =
              usageWith(usage, asNumber(reported.input_tokens), asNumber(reported.output_tokens)) ??
              usage
          }
          break
        }
        case 'error': {
          const reported = asRecord(frame.error)
          const message = reported ? asString(reported.message) : null
          stopReason = 'error'
          yield {
            type: 'error',
            message: redactSecrets(
              message ?? 'Anthropic reported an error part way through the stream.',
              headers(request.apiKey, 'text/event-stream')
            )
          }
          return
        }
        case 'message_stop': {
          completed = true
          break
        }
        default:
          // message_stop, ping and anything added later carry nothing to emit.
          break
      }
    }

    if (!completed) throw new Error(INTERRUPTED_STREAM_MESSAGE)
    for (const call of calls.flushAll()) {
      yield { type: 'tool-call', call }
      stopReason = 'tool_calls'
    }

    yield {
      type: 'done',
      stopReason: stopReason ?? 'end_turn',
      ...(usage ? { usage } : {})
    }
  }
}
