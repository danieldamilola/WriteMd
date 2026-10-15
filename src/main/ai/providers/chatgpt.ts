import { streamResponses } from './responses'
import type { StreamEvent } from '../../../shared/ai/types'
import type { ProviderAdapter, ProviderDescriptor, ProviderConfig } from './types'
import { asArray, asRecord, asString, requestJson } from './http'
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
    yield* streamResponses(request, authorization, 'ChatGPT', errorMessage)
  }
}
