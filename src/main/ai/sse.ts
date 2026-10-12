/**
 * Server-sent-event reader.
 *
 * The renderer cannot fetch - its CSP has no `connect-src`, so it inherits
 * `default-src 'self'` - which means every provider call is made from main and
 * every API key stays there. That constraint is also why this exists as a
 * shared utility rather than living inside one adapter: Anthropic, Gemini and
 * the OpenAI family all stream SSE, all with slightly different framing, and
 * the framing is fiddly enough that getting it subtly wrong produces a silent
 * truncation rather than an error.
 */

export interface SseRequest {
  url: string
  headers: Record<string, string>
  body: string
  signal: AbortSignal
}

/**
 * Incremental SSE framer.
 *
 * Split out from the fetch so it can be tested directly. Framing bugs here are
 * the worst kind: a chunk boundary in the wrong place does not throw, it
 * silently drops the last event of a stream, so the turn ends without a `done`
 * and the transcript just stops mid-sentence. Exercising this through a real
 * `Response` would mean constructing byte-level chunk boundaries to hit each
 * case, which is exactly the part that is hard to get right.
 *
 * Yields payload strings rather than frames: every consumer wants the payload,
 * and an event with no `data:` line has nothing to hand back.
 */
export function createSseFramer(): {
  push(chunk: string): string[]
  end(): string[]
} {
  let buffer = ''
  let dataLines: string[] = []

  const takePayload = (): string | null => {
    if (dataLines.length === 0) return null
    const data = dataLines.join('\n')
    dataLines = []
    // Providers end an OpenAI-compatible stream with a literal sentinel that is
    // not JSON. Treating it as a payload hands the adapter a parse error on a
    // stream that completed successfully.
    if (data === '[DONE]') return null
    return data
  }

  const drain = (final: boolean): string[] => {
    const frames: string[] = []
    for (;;) {
      const newline = findLineEnd(buffer)
      if (!newline) break
      const line = buffer.slice(0, newline.index)
      buffer = buffer.slice(newline.index + newline.length)

      if (line === '') {
        const payload = takePayload()
        if (payload !== null) frames.push(payload)
        continue
      }
      if (line.startsWith(':')) continue
      if (line.startsWith('data:')) {
        // A single space after the colon is framing, not payload.
        dataLines.push(line.slice(5).replace(/^ /, ''))
      }
      // `event:`, `id:` and `retry:` carry nothing the adapters need; they key
      // off payload shape, which all three providers keep stable.
    }
    if (final) {
      // A stream that ends without a trailing blank line still has a payload.
      const payload = takePayload()
      if (payload !== null) frames.push(payload)
    }
    return frames
  }

  return {
    push: (chunk: string): string[] => {
      buffer += chunk
      return drain(false)
    },
    end: (): string[] => drain(true)
  }
}

/** Returns the index and length of the next line terminator, or null. */
function findLineEnd(buffer: string): { index: number; length: number } | null {
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i]
    if (ch === '\n') return { index: i, length: 1 }
    if (ch === '\r') {
      // A lone \r terminates a line; \r\n is one terminator, not two.
      return { index: i, length: buffer[i + 1] === '\n' ? 2 : 1 }
    }
  }
  return null
}

/** Read an SSE response body, yielding one payload per event. */
export async function readSse(request: SseRequest, onData: (data: string) => void): Promise<void> {
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal: request.signal
  })

  if (!response.ok) throw new Error(await describeHttpFailure(response))
  if (!response.body) throw new Error('Provider returned an empty response body')

  const framer = createSseFramer()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  const emit = (payloads: string[]): void => {
    for (const payload of payloads) onData(payload)
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      // The framer owns the partial-line buffer; handing it whole decoded
      // chunks is the point. A chunk boundary can fall mid-line, mid-UTF8, or
      // mid-JSON, and the framer is where that gets resolved.
      emit(framer.push(decoder.decode(value, { stream: true })))
    }
    // Flush a trailing partial character before ending the stream.
    emit(framer.push(decoder.decode()))
    emit(framer.end())
  } finally {
    reader.releaseLock()
  }
}

/**
 * Turn a non-2xx response into something worth showing a user.
 *
 * Provider error bodies are usually JSON with a `message`, and surfacing
 * "401" alone loses the difference between a wrong key, a wrong model name and
 * an exhausted quota, all of which the user can actually act on.
 */
async function describeHttpFailure(response: Response): Promise<string> {
  const status = `${response.status} ${response.statusText}`.trim()
  let detail = ''
  try {
    const raw = await response.text()
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as {
          error?: { message?: string } | string
          message?: string
        }
        const nested = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message
        detail = nested ?? parsed.message ?? raw.slice(0, 300)
      } catch {
        detail = raw.slice(0, 300)
      }
    }
  } catch {
    // Body already consumed or unreadable; the status alone is still useful.
  }
  return detail ? `${status}: ${detail}` : status
}

/** Join a base URL and a path without doubling or dropping the separator. */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}
