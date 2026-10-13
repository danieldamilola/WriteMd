import type { Usage } from '../../../shared/ai/types'
import { checkEndpoint } from '../endpoint'
import { createSseFramer } from '../sse'

/**
 * HTTP plumbing shared by all three adapters.
 *
 * The three providers differ in URL layout, headers and payload shape, and
 * agree completely on everything else: how a refusal is worded, how a tool call
 * is assembled, how a stream is framed, and that a cancelled request throws an
 * AbortError rather than whatever the socket happened to say. Keeping that in
 * one place is the difference between "the key is wrong" being explained the
 * same way whichever provider the user picked, and it being explained three
 * slightly different ways.
 */

const SNIPPET_LIMIT = 300

/**
 * `checkEndpoint` validates a model alongside the endpoint. Model listing has no
 * model yet - that is what it is asking for - so it checks against this
 * placeholder rather than growing a second, near-identical validator.
 */
const LISTING_PROBE_MODEL = 'list-models-probe'

export const INTERRUPTED_STREAM_MESSAGE =
  'The provider response ended before it was complete. Try sending the message again.'

/** An error shaped like a DOMException 'AbortError', which is what callers check. */
export function abortError(message = 'The request was cancelled.'): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
}

/**
 * The one gate in front of every request.
 *
 * Checked here rather than trusted from the renderer because the renderer is not
 * a trust boundary: settings are user-editable and a base URL can be pasted from
 * anywhere. Returns the trimmed URL, since `joinUrl` would otherwise keep the
 * whitespace that `checkEndpoint` only tolerated for validation.
 */
export function assertEndpoint(baseUrl: string, model: string, apiKey?: string): string {
  const check = checkEndpoint(baseUrl, model, apiKey)
  if (!check.ok) throw new Error(check.message ?? 'The AI endpoint is not usable.')
  return baseUrl.trim()
}

export function assertListingEndpoint(baseUrl: string, apiKey?: string): string {
  return assertEndpoint(baseUrl, LISTING_PROBE_MODEL, apiKey)
}

export interface JsonRequest {
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
  signal: AbortSignal
}

export class ProviderHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'ProviderHttpError'
  }
}

/** GET/POST JSON with non-2xx turned into something a user can act on. */
export async function requestJson(url: string, init: JsonRequest): Promise<unknown> {
  throwIfAborted(init.signal)
  const response = await send(url, init)
  if (!response.ok)
    throw new ProviderHttpError(response.status, await httpFailure(response, init.headers))
  const text = await readText(response, init.signal)
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(
      `The provider returned a response that is not JSON: ${snippet(redactSecrets(text, init.headers))}`
    )
  }
}

export interface SseStreamOptions {
  url: string
  headers: Record<string, string>
  body: string
  signal: AbortSignal
  /** A terminal provider frame arrived; drain buffered usage, then close. */
  isComplete?: () => boolean
}

/**
 * Read an SSE body, yielding one payload string per event.
 *
 * Framing is delegated to the tested `createSseFramer`, but the fetch and the
 * failure handling are not: `readSse` in `../sse` describes a refusal with a
 * bare status, and the status alone is the part the user cannot act on.
 */
export async function* streamSse(options: SseStreamOptions): AsyncGenerator<string> {
  const { signal } = options
  // Checked before the fetch rather than left to it: a fetch against an
  // already-aborted signal still reaches the network stack, and a turn the user
  // cancelled should not cost a request.
  throwIfAborted(signal)
  const response = await send(options.url, {
    method: 'POST',
    headers: options.headers,
    body: options.body,
    signal
  })
  if (!response.ok) throw new Error(await httpFailure(response, options.headers))
  if (!response.body) throw new Error('The provider returned an empty response body.')

  const framer = createSseFramer({ includeDone: true })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  try {
    for (;;) {
      const { done, value } = await readChunk(reader, signal, options.isComplete?.() === true)
      if (done) break
      // A chunk boundary can land mid-line, mid-UTF8 or mid-JSON; the framer owns
      // the partial line and the streaming decoder owns the partial character.
      for (const payload of framer.push(decoder.decode(value, { stream: true }))) {
        throwIfAborted(signal)
        yield payload
      }
    }
    for (const payload of framer.push(decoder.decode())) yield payload
    for (const payload of framer.end()) yield payload
  } finally {
    // An abandoned generator never reaches the end of the loop, and without this
    // the socket to the provider stays open until the process exits.
    try {
      await reader.cancel()
    } catch {
      // Cancelling an already-closed or errored stream is not a failure here.
    }
    reader.releaseLock()
  }
}

async function send(url: string, init: JsonRequest): Promise<Response> {
  try {
    return await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: init.signal
    })
  } catch (error) {
    // A cancelled fetch surfaces as a generic TypeError from Node's undici, so
    // the signal is the only reliable signal. Cancellation is a normal outcome
    // (the user hit stop), not a fault worth surfacing as one.
    if (init.signal.aborted || isAbortError(error)) throw abortError()
    throw new Error(
      redactSecrets(`Could not reach ${hostOf(url)}: ${messageOf(error)}`, init.headers),
      { cause: error }
    )
  }
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  complete = false
): Promise<{ done: boolean; value?: Uint8Array }> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    throwIfAborted(signal)
    const chunk = await Promise.race([
      reader.read(),
      ...(complete
        ? [
            new Promise<{ done: true; value: undefined }>((resolve) => {
              timeout = setTimeout(() => resolve({ done: true, value: undefined }), 0)
            })
          ]
        : [])
    ])
    throwIfAborted(signal)
    return { done: chunk.done, value: chunk.value }
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw abortError()
    // A provider can close its socket after the terminal frame but before a
    // trailing usage frame. The completed response is still usable.
    if (complete) return { done: true }
    throw new Error(
      'The provider connection ended before the response was complete. No edits were applied. Try again.',
      { cause: error }
    )
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

async function httpFailure(response: Response, headers: Record<string, string>): Promise<string> {
  const detail = await readDetail(response, headers)
  return httpFailureMessage(response.status, response.statusText, detail)
}

/**
 * Turn a non-2xx into a sentence about what to do about it.
 *
 * "401" is the status; "your key is wrong" is the information. Provider error
 * bodies are usually JSON with a `message`, so the status-derived sentence leads
 * and the body trails as corroborating detail.
 */
export function httpFailureMessage(status: number, statusText: string, detail: string): string {
  const label = statusText ? ` ${status} ${statusText}` : ` ${status}`
  const headline = headlineFor(status)
  return detail ? `${headline} (${label.trim()}) ${detail}` : `${headline} (${label.trim()})`
}

function headlineFor(status: number): string {
  if (status === 400) return 'The provider rejected the request.'
  if (status === 401) return 'The API key was rejected. Check it in Settings.'
  if (status === 403) {
    return 'The API key is not allowed to use this endpoint or model. Check the account permissions.'
  }
  if (status === 404) return 'Endpoint not found. Check the base URL in Settings.'
  if (status === 408) return 'The provider timed out before responding.'
  if (status === 413) return 'The request was too large. Shorten the conversation or the document.'
  if (status === 422) return 'The provider could not process the request.'
  if (status === 429)
    return 'Rate limited or out of quota. Wait a moment, or check the account quota.'
  if (status >= 500) return 'The provider is unavailable. This is on their side, try again shortly.'
  return 'The provider request failed.'
}

async function readDetail(response: Response, headers: Record<string, string>): Promise<string> {
  let raw: string
  try {
    raw = await response.text()
  } catch {
    // Body already consumed or unreadable; the status-derived sentence stands.
    return ''
  }
  if (!raw.trim()) return ''
  const trimmed = raw.trim()
  try {
    const parsed = asRecord(JSON.parse(trimmed) as unknown)
    if (parsed) {
      const error = parsed.error
      const nested = typeof error === 'string' ? error : asRecord(error)?.message
      const message = firstString(nested, parsed.message)
      if (message) return `(${snippet(redactSecrets(message, headers))})`
    }
  } catch {
    // Not JSON. The raw text is more useful than a parse failure.
  }
  return `(${snippet(redactSecrets(trimmed, headers))})`
}

async function readText(response: Response, signal: AbortSignal): Promise<string> {
  try {
    throwIfAborted(signal)
    const text = await response.text()
    throwIfAborted(signal)
    return text
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw abortError()
    throw new Error(`The provider response could not be read: ${messageOf(error)}`, {
      cause: error
    })
  }
}

/** Provider errors can echo credentials. Keep them out of renderer errors. */
export function redactSecrets(message: string, headers: Record<string, string>): string {
  let redacted = message
  for (const [name, value] of Object.entries(headers)) {
    if (!/^(authorization|x-api-key|x-goog-api-key)$/i.test(name)) continue
    const secret = name.toLowerCase() === 'authorization' ? value.replace(/^Bearer\s+/i, '') : value
    if (secret) redacted = redacted.split(secret).join('[redacted]')
  }
  return redacted
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > SNIPPET_LIMIT ? `${flat.slice(0, SNIPPET_LIMIT)}...` : flat
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error)
}

/* Readers for untrusted JSON. Narrowing helpers, because a provider payload is
   not a typed value until it has been checked, and one `as` at the top of a
   200-line parse is how a `null` becomes an unexplained crash. */

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/** Parse an SSE payload, tolerating the sentinels providers put on the wire. */
export function parsePayload(payload: string): Record<string, unknown> | null {
  const trimmed = payload.trim()
  // OpenAI ends a completed stream with a literal sentinel that is not JSON.
  if (!trimmed || trimmed === '[DONE]') return null
  try {
    return asRecord(JSON.parse(trimmed) as unknown)
  } catch {
    // A single malformed frame should not end a turn that is otherwise going.
    return null
  }
}

/** Sort and dedupe a model list so the picker is stable between refreshes. */
export function normalizeModelIds(ids: string[]): string[] {
  const seen = new Set<string>()
  for (const id of ids) {
    const trimmed = id.trim()
    if (trimmed) seen.add(trimmed)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/**
 * Fold a usage reading into the running one.
 *
 * No provider reports token counts in one frame. OpenAI sends them last,
 * Anthropic splits input counts at `message_start` from output counts at
 * `message_delta`, and a later reading must not erase a field an earlier one
 * supplied. Returns undefined rather than `{}` so a stream that never reported
 * usage emits no `usage` key at all instead of one full of nulls.
 */
export function usageWith(
  current: Usage | undefined,
  inputTokens: number | null,
  outputTokens: number | null
): Usage | undefined {
  const input = inputTokens ?? current?.inputTokens
  const output = outputTokens ?? current?.outputTokens
  if (input === undefined && output === undefined) return undefined
  return {
    ...(input === undefined ? {} : { inputTokens: input }),
    ...(output === undefined ? {} : { outputTokens: output })
  }
}
