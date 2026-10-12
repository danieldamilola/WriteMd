/**
 * Wire types shared by the main process, the preload bridge and the renderer.
 *
 * Deliberately provider-neutral. Every adapter (OpenAI-compatible, Anthropic,
 * Gemini) normalizes into these, so the turn runner never branches on which
 * provider is in use and a new provider is one adapter rather than a rewrite.
 * Nothing here imports from `electron` or `node`, which is what keeps the
 * renderer able to hold a session in memory without pulling in main-only code.
 */

export type MessageRole = 'user' | 'assistant' | 'tool'

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ImageBlock {
  type: 'image'
  mimeType: string
  /** Base64, no data: prefix. Kept out of persisted history. */
  data: string
}

export type MessageContent = TextBlock | ImageBlock

/** A tool the model asked to run. `arguments` is parsed JSON, not a string. */
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ChatMessage {
  role: MessageRole
  content: string | MessageContent[]
  /** Set on a `tool` message: which call this result answers. */
  toolCallId?: string
  /** Tool name, for providers that require it alongside the id. */
  name?: string
  /** Set on an `assistant` message that requested tools. */
  toolCalls?: ToolCall[]
}

/**
 * JSON Schema for a tool's parameters.
 *
 * A subset, not the whole spec: object/array/string/number/boolean/null,
 * `properties`, `required`, `items`, `enum`, `description`. Every provider in
 * the matrix accepts this subset, so an adapter never has to reject a schema the
 * others took. An unsupported keyword means writing the tool wrong, and it is
 * far better to find that out here than in three different API errors.
 */
export interface ToolSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
  description?: string
  properties?: Record<string, ToolSchema>
  required?: string[]
  items?: ToolSchema
  enum?: (string | number | boolean)[]
}

export interface ToolSpec {
  name: string
  description: string
  parameters: ToolSchema
}

/**
 * What the provider said it was doing when it stopped. `tool_calls` is the
 * loop's signal to run tools and send another request; the rest are terminal.
 */
export type StopReason = 'end_turn' | 'max_tokens' | 'tool_calls' | 'stop_sequence' | 'error'

export interface Usage {
  inputTokens?: number
  outputTokens?: number
}

/** Normalized stream event. Adapters emit exactly these. */
export type StreamEvent =
  | { type: 'text'; delta: string }
  /** A tool call arrived whole. Adapters buffer partial JSON to get here. */
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'done'; stopReason: StopReason; usage?: Usage }
  | { type: 'error'; message: string }

export type ProviderKind = 'openai' | 'anthropic' | 'gemini'

/**
 * A configured provider. `id` is user-stable (stored in settings), `baseUrl` is
 * editable so a self-hosted or proxy endpoint works without a new adapter.
 */
export interface AiProviderConfig {
  id: string
  label: string
  kind: ProviderKind
  baseUrl: string
  /** Never leaves the main process, and never reaches the renderer. */
  apiKey?: string
  /** Model ids to offer. `null` means "ask the provider what it has". */
  models?: string[]
}

/**
 * How much the agent may do without asking.
 *
 * The names describe what happens, not how much is allowed, because the
 * boundary that matters is whether a human sees the action before it lands.
 * `read-only` is the default for a reason: a session nobody has switched out of
 * it cannot touch the disk.
 */
export type PermissionMode = 'read-only' | 'ask' | 'auto'

export interface AiSettings {
  providers: AiProviderConfig[]
  activeProviderId: string | null
  model: string | null
  permissionMode: PermissionMode
  /** Where a new session starts when the user has not picked a project. */
  defaultRoot: string | null
  /** Surface where a session keeps its working directory. */
  maxTurnSteps: number
}

/** One step of the agent loop, for the transcript. */
export interface AiToolInvocation {
  id: string
  name: string
  arguments: Record<string, unknown>
  /** Populated once the tool has run. */
  result?: string
  isError?: boolean
  /** Path this touched, relative to the session root. For display. */
  affectedPath?: string
}

/**
 * A conversation. `root` is the "cd": it is fixed for the life of the session
 * and is what every tool call is scoped to.
 */
export interface AiSession {
  id: string
  title: string
  /** The working directory. Immutable once the session has a message. */
  root: string
  providerId: string
  model: string | null
  permissionMode: PermissionMode
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

/** Persisted session, minus the parts that should not outlive the process. */
export type AiSessionSummary = Omit<AiSession, 'messages'>
