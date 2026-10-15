import type { ChatMessage, StreamEvent, ToolSpec } from '../../../shared/ai/types'
import type { ModelOptions } from '../../../shared/ai/model-options'

/**
 * The provider contract.
 *
 * Three adapters serve the whole matrix, and Ollama and LM Studio are presets
 * over the OpenAI one rather than adapters of their own: they speak the
 * OpenAI-compatible `/v1` shape, and a second adapter for them would be a
 * second copy of the same request builder that drifts out of step with the
 * first.
 *
 * A descriptor is the thing a preset is made of - it is what Settings renders,
 * what gets persisted per provider, and what decides which adapter a configured
 * base URL routes to.
 */

export interface ProviderDescriptor {
  id: string
  label: string
  kind: 'openai' | 'anthropic' | 'gemini' | 'responses'
  defaultBaseUrl: string
  defaultModel: string
  /** Local servers need no key. */
  keyRequired: boolean
  keyHint: string
  /**
   * Whether `matchPresetByBaseUrl` should return this preset for its
   * `defaultBaseUrl`. Defaults to true.
   *
   * An account-based provider shares a host with the API-key preset for the
   * same upstream, so matching its URL would take over a configuration the user
   * set up with a key. Such a provider is still chosen by id in Settings; it is
   * only excluded from inferring a provider from an address.
   */
  selectableByUrl?: false
}

/** Everything a non-streaming call needs to identify where it is going. */
export interface ProviderConfig {
  baseUrl: string
  apiKey?: string
  providerId?: string
}

export interface StreamRequest {
  providerId?: string
  modelOptions?: ModelOptions
  gatewayHeaders?: Record<string, string>
  sessionId?: string
  baseUrl: string
  apiKey?: string
  model: string
  messages: ChatMessage[]
  system: string
  /** Omit to use the provider's default output allowance. */
  maxTokens?: number
  temperature: number
  signal: AbortSignal
  /**
   * Omitted, no tools are declared and no tool calls can come back. Adapters
   * translate the shared `ToolSchema` subset into whatever their provider calls
   * it, and buffer the streamed arguments back into a whole `ToolCall`.
   */
  tools?: ToolSpec[]
  /** Plain-response recovery after a provider emits unusable tool markup. */
  disableThinking?: boolean
}

export interface ProviderAdapter {
  descriptor: ProviderDescriptor
  /**
   * Model ids this key can reach.
   *
   * Rejects rather than resolving `[]` when the key is wrong: an empty list and
   * a bad key look identical in the model picker, and "no models available" is
   * the wrong thing to tell someone whose key expired this morning.
   */
  listModels(config: ProviderConfig, signal: AbortSignal): Promise<string[]>
  stream(request: StreamRequest): AsyncGenerator<StreamEvent>
}
