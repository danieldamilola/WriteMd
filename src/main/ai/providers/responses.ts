import type { ChatMessage, ProviderMetadata, StreamEvent } from '../../../shared/ai/types'
import type { StreamRequest } from './types'
import { modelCapabilities, supportedModelOptions } from '../../../shared/ai/model-options'
import { asRecord, asString, parsePayload, streamSse, redactSecrets } from './http'

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

export async function* streamResponses(
  request: StreamRequest,
  authorization: Record<string, string>,
  label: string,
  describeError: (error: unknown) => string = (error) =>
    asString(asRecord(error)?.message) ?? `${label} could not complete this response.`
): AsyncGenerator<StreamEvent> {
  const metadata: ProviderMetadata = { responses: [] }
  const options = supportedModelOptions(
    request.modelOptions ?? {},
    modelCapabilities(request.providerId ?? 'openai', request.model)
  )
  let completed = false
  let calls = 0
  try {
    for await (const raw of streamSse({
      url: `${request.baseUrl.replace(/\/$/, '')}/responses`,
      headers: authorization,
      body: JSON.stringify({
        model: request.model,
        instructions: request.system,
        input: inputItems(request.messages),
        stream: true,
        store: false,
        include: ['reasoning.encrypted_content'],
        max_output_tokens: request.maxTokens,
        ...(options.reasoning ? { reasoning: { effort: options.reasoning } } : {}),
        ...(options.serviceTier ? { service_tier: options.serviceTier } : {}),
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
      if (frame.type === 'response.output_text.delta' || frame.type === 'response.refusal.delta') {
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
            throw new Error(`${label} returned an invalid tool call.`)
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
        throw new Error(describeError(asRecord(frame.response)?.error ?? frame.error ?? frame))
      }
    }
    if (!completed)
      throw new Error(
        `${label} stopped before response completion. No edits were applied. Try again.`
      )
  } catch (error) {
    const message = error instanceof Error ? error.message : `${label} request failed.`
    throw new Error(
      redactSecrets(
        message.replace(
          'The API key was rejected. Check it in Settings.',
          label === 'OpenAI'
            ? 'The API key was rejected. Check it in Settings.'
            : `${label} authorization was rejected. Sign in again in AI Settings.`
        ),
        authorization
      ),
      { cause: error }
    )
  }
}
