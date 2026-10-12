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
 * How a change reached the file. Everything lands automatically; the journal is
 * what makes that recoverable. Kept as an explicit type because the transcript
 * renders it, and "the assistant rewrote this" reads very differently from
 * "the assistant created this".
 */
export type ChangeKind = 'created' | 'modified'

/**
 * One undoable change.
 *
 * `before` is null when the file did not exist, which is what makes undo of a
 * creation a delete rather than a write of empty content. `after` is kept
 * alongside so undo can refuse when the file has been changed since by someone
 * or something else - restoring `before` over a newer edit would destroy work
 * the user did after the fact, which is a worse failure than declining to undo.
 */
export interface JournalEntry {
  id: string
  sessionId: string
  /** Canonical absolute path, so a symlinked write reverts the real file. */
  path: string
  kind: ChangeKind
  before: string | null
  after: string
  createdAt: number
  revertedAt: number | null
}

/**
 * A conversation. Saved, named, and reopenable - which is the whole of its
 * persistence requirement. There is no working directory: the assistant is
 * pointed at files, not dropped into a project.
 */
export interface AiSession {
  id: string
  title: string
  providerId: string
  model: string | null
  messages: ChatMessage[]
  /**
   * Where the conversation started, for grouping sessions by note. Not a
   * boundary - the assistant can be sent to any file - just a label, and null
   * once a session has drifted across notes.
   */
  contextFile: string | null
  createdAt: number
  updatedAt: number
}

/** Persisted session. Messages carry no image data, so this is storable. */
export type AiSessionSummary = Omit<AiSession, 'messages'>

/** Settings that describe how the assistant reaches a model. */
export interface AiSettings {
  providers: AiProviderConfig[]
  activeProviderId: string | null
  model: string | null
}
