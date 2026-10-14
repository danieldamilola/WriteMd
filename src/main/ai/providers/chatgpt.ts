import type { ChatMessage, ProviderMetadata, StreamEvent } from '../../../shared/ai/types'
import type { ProviderAdapter, ProviderDescriptor, ProviderConfig } from './types'
import {
  asArray,
  asRecord,
  asString,
  parsePayload,
  requestJson,
  streamSse,
  redactSecrets
} from './http'
import { CHATGPT_API_BASE } from '../chatgpt-auth'
import type { ChatgptModelView } from '../../../shared/ai/chatgpt'

export const chatgptDescriptor: ProviderDescriptor = {
  id: 'chatgpt',
  label: 'ChatGPT account',
  kind: 'responses',
  defaultBaseUrl: CHATGPT_API_BASE,
  defaultModel: '',
  keyRequired: false,
  keyHint: 'Continue with ChatGPT to use your plan',
  selectableByUrl: false
}

function headers(config: ProviderConfig): Record<string, string> {
  if (config.baseUrl.replace(/\/$/, '') !== CHATGPT_API_BASE)
    throw new Error('ChatGPT account access uses the official OpenAI endpoint.')
  if (!config.apiKey) throw new Error('Continue with ChatGPT in AI Settings.')
  return { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' }
}

export async function chatgptModels(
  config: ProviderConfig,
  signal: AbortSignal
): Promise<ChatgptModelView[]> {
  const result = asRecord(
    await requestJson(`${CHATGPT_API_BASE}/models`, {
      method: 'GET',
      headers: headers(config),
      signal
    })
  )
  const models: ChatgptModelView[] = []
  for (const value of asArray(result?.models)) {
    const item = asRecord(value)
    if (
      item?.visibility !== 'list' ||
      typeof item.slug !== 'string' ||
      !item.slug.trim() ||
      models.some((model) => model.id === item.slug)
    )
      continue
    models.push({ id: item.slug, label: asString(item.display_name) || item.slug })
  }
  return models
}

function inputItems(messages: ChatMessage[]): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = []
  for (const message of messages) {
    if (message.role === 'tool') {
      items.push({
        type: 'function_call_output',
        call_id: message.toolCallId,
        output:
          typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
      })
      continue
    }
    if (message.providerMetadata?.responses) items.push(...message.providerMetadata.responses)
    if (typeof message.content === 'string') {
      if (message.content) items.push({ role: message.role, content: message.content })
    } else {
      items.push({
        role: message.role,
        content: message.content.map((block) =>
          block.type === 'text'
            ? { type: 'input_text', text: block.text }
            : { type: 'input_image', image_url: `data:${block.mimeType};base64,${block.data}` }
        )
      })
    }
    for (const call of message.toolCalls ?? []) {
      items.push({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.arguments)
      })
    }
  }
  return items
}

function errorMessage(error: unknown): string {
  const value = asRecord(error)
  const code = asString(value?.code)
  if (code === 'subscription_sharing_usage_limit_exceeded')
    return 'ChatGPT plan or app usage limit reached. Manage usage in ChatGPT Settings.'
  if (code === 'subscription_sharing_usage_unavailable')
    return 'ChatGPT usage availability could not be checked. Try again later.'
  const message = asString(value?.message) ?? 'ChatGPT could not complete this response.'
  return code ? `${message} (${code})` : message
}

export const chatgptAdapter: ProviderAdapter = {
  descriptor: chatgptDescriptor,
  async listModels(config, signal) {
    return (await chatgptModels(config, signal)).map((model) => model.id)
  },
  async *stream(request): AsyncGenerator<StreamEvent> {
    const authorization = headers(request)
    const metadata: ProviderMetadata = { responses: [] }
    let completed = false
    let calls = 0
    try {
      for await (const raw of streamSse({
        url: `${CHATGPT_API_BASE}/responses`,
        headers: authorization,
        body: JSON.stringify({
          model: request.model,
          instructions: request.system,
          input: inputItems(request.messages),
          stream: true,
          store: false,
          include: ['reasoning.encrypted_content'],
          max_output_tokens: request.maxTokens,
          ...(request.tools?.length
            ? {
                tools: request.tools.map((tool) => ({
                  type: 'function',
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters
                }))
              }
            : {})
        }),
        signal: request.signal
      })) {
        const frame = parsePayload(raw)
        if (!frame) continue
        if (
          frame.type === 'response.output_text.delta' ||
          frame.type === 'response.refusal.delta'
        ) {
          if (typeof frame.delta === 'string') yield { type: 'text', delta: frame.delta }
        } else if (frame.type === 'response.output_item.done') {
          const item = asRecord(frame.item)
          if (item?.type === 'reasoning') metadata.responses!.push(item)
          if (item?.type === 'function_call') {
            let arguments_: Record<string, unknown> | null = null
            try {
              arguments_ = asRecord(JSON.parse(String(item.arguments)) as unknown)
            } catch {
              /* invalid call */
            }
            if (!arguments_ || typeof item.call_id !== 'string' || typeof item.name !== 'string')
              throw new Error('ChatGPT returned an invalid tool call.')
            calls++
            yield {
              type: 'tool-call',
              call: { id: item.call_id, name: item.name, arguments: arguments_ }
            }
          }
        } else if (frame.type === 'response.completed') {
          const response = asRecord(frame.response)
          const usage = asRecord(response?.usage)
          completed = true
          yield {
            type: 'done',
            stopReason: calls ? 'tool_calls' : 'end_turn',
            providerMetadata: metadata,
            ...(usage &&
            typeof usage.input_tokens === 'number' &&
            typeof usage.output_tokens === 'number'
              ? {
                  usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }
                }
              : {})
          }
          break
        } else if (frame.type === 'response.incomplete') {
          const details = asRecord(asRecord(frame.response)?.incomplete_details)
          yield {
            type: 'done',
            stopReason: details?.reason === 'max_output_tokens' ? 'max_tokens' : 'error'
          }
          return
        } else if (frame.type === 'response.failed' || frame.type === 'error') {
          throw new Error(errorMessage(asRecord(frame.response)?.error ?? frame.error ?? frame))
        }
      }
      if (!completed)
        throw new Error(
          'ChatGPT stopped before response completion. No edits were applied. Try again.'
        )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ChatGPT request failed.'
      throw new Error(
        redactSecrets(
          message.replace(
            'The API key was rejected. Check it in Settings.',
            'ChatGPT authorization was rejected. Sign in again in AI Settings.'
          ),
          authorization
        ),
        { cause: error }
      )
    }
  }
}
