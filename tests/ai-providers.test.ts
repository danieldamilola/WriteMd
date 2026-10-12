import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StreamEvent, ToolCall } from '../src/shared/ai/types'
import { anthropicAdapter } from '../src/main/ai/providers/anthropic'
import { geminiAdapter } from '../src/main/ai/providers/gemini'
import { openaiAdapter } from '../src/main/ai/providers/openai'
import type { ProviderAdapter, StreamRequest } from '../src/main/ai/providers/types'

/**
 * Streaming behaviour, per adapter.
 *
 * `fetch` is mocked at the byte level rather than at the payload level, because
 * every bug worth catching here lives at a chunk boundary: a text delta split
 * mid-UTF8, a tool call's argument JSON split mid-string, a `[DONE]` sentinel
 * that is not JSON at all. Mocking parsed payloads would test the adapters
 * against input no provider has ever sent.
 */

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function stubFetch(): void {
  vi.stubGlobal('fetch', fetchMock)
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Split a payload into fixed-size byte chunks to force awkward boundaries. */
function byteChunks(text: string, size: number): Uint8Array[] {
  const all = encode(text)
  const out: Uint8Array[] = []
  for (let i = 0; i < all.length; i += size) out.push(all.slice(i, i + size))
  return out
}

function responseOf(chunks: Uint8Array[], init: ResponseInit = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    }
  })
  return new Response(body, { status: 200, ...init })
}

function sseResponse(text: string, chunkSize = text.length): Response {
  return responseOf(byteChunks(text, chunkSize))
}

function jsonResponse(body: unknown, status = 200, statusText = ''): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' }
  })
}

function abortLike(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

/** A stream that stalls after its first chunks, the way a real one does. */
function stalledResponse(chunks: Uint8Array[], signal: AbortSignal): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      // Real fetch errors the body when the request signal aborts; a mock that
      // does not would make cancellation untestable.
      signal.addEventListener('abort', () => controller.error(abortLike()), { once: true })
    }
  })
  return new Response(body, { status: 200 })
}

function request(overrides: Partial<StreamRequest> = {}): StreamRequest {
  return {
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'sk-test-key',
    model: 'test-model',
    messages: [{ role: 'user', content: 'hello' }],
    system: 'be brief',
    maxTokens: 128,
    temperature: 0.2,
    signal: new AbortController().signal,
    ...overrides
  }
}

async function collect(
  adapter: ProviderAdapter,
  overrides: Partial<StreamRequest> = {}
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const event of adapter.stream(request(overrides))) events.push(event)
  return events
}

function textOf(events: StreamEvent[]): string {
  return events
    .filter((event): event is Extract<StreamEvent, { type: 'text' }> => event.type === 'text')
    .map((event) => event.delta)
    .join('')
}

function callsOf(events: StreamEvent[]): ToolCall[] {
  return events
    .filter(
      (event): event is Extract<StreamEvent, { type: 'tool-call' }> => event.type === 'tool-call'
    )
    .map((event) => event.call)
}

function doneOf(events: StreamEvent[]): Extract<StreamEvent, { type: 'done' }> {
  const done = events.find((event) => event.type === 'done')
  if (!done) throw new Error('stream produced no done event')
  return done as Extract<StreamEvent, { type: 'done' }>
}

/* ------------------------------------------------------------------------ */
/* OpenAI                                                                    */
/* ------------------------------------------------------------------------ */

const OPENAI_TEXT_STREAM = [
  'data: {"choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n',
  'data: {"choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n',
  'data: {"choices":[{"index":0,"delta":{"content":", wörld"}}]}\n\n',
  'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
  'data: {"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\n',
  'data: [DONE]\n\n'
].join('')

const OPENAI_TOOL_STREAM = [
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function",',
  '"function":{"name":"edit_file","arguments":"{\\"path\\":\\"notes/a"}}]}}]}\n\n',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"/b.md\\",\\"search\\":\\"old\\""}}]}}]}\n\n',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":",\\"replace\\":\\"new\\"}"}}]}}]}\n\n',
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
  'data: [DONE]\n\n'
].join('')

describe('openai adapter', () => {
  it('accumulates text deltas into the full string', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(OPENAI_TEXT_STREAM))

    const events = await collect(openaiAdapter)

    expect(textOf(events)).toBe('Hello, wörld')
    expect(doneOf(events).stopReason).toBe('end_turn')
    expect(doneOf(events).usage).toEqual({ inputTokens: 10, outputTokens: 4 })
  })

  it('survives a stream fed one byte at a time', async () => {
    // The 'ö' is two bytes. Split between them, the naive decoder emits U+FFFD
    // and the transcript shows a replacement character mid-sentence.
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(OPENAI_TEXT_STREAM, 1))

    expect(textOf(await collect(openaiAdapter))).toBe('Hello, wörld')
  })

  it('produces identical events at every chunk size', async () => {
    const sizes = [1, 3, 7, 64, 4096]
    const outputs: string[] = []
    for (const size of sizes) {
      stubFetch()
      fetchMock.mockReset()
      fetchMock.mockResolvedValue(sseResponse(OPENAI_TEXT_STREAM, size))
      outputs.push(textOf(await collect(openaiAdapter)))
    }
    expect(new Set(outputs).size).toBe(1)
  })

  it('ends on the [DONE] sentinel without trying to parse it', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(OPENAI_TEXT_STREAM))

    const events = await collect(openaiAdapter)

    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(events[events.length - 1].type).toBe('done')
  })

  it('terminates cleanly on a stream that is nothing but the sentinel', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse('data: [DONE]\n\n'))

    const events = await collect(openaiAdapter)

    expect(events).toEqual([{ type: 'done', stopReason: 'end_turn' }])
  })

  it('skips one malformed frame instead of ending the turn', async () => {
    // A proxy that injects a keep-alive the framer cannot parse should cost one
    // delta, not the whole response.
    stubFetch()
    fetchMock.mockResolvedValue(
      sseResponse(
        [
          'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
          'data: {this is not json}\n\n',
          'data: {"choices":[{"delta":{"content":"b"}},{"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n'
        ].join('')
      )
    )

    const events = await collect(openaiAdapter)

    expect(textOf(events)).toBe('ab')
    expect(doneOf(events).stopReason).toBe('end_turn')
  })

  it('emits a partially streamed tool call whole and parsed', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(OPENAI_TOOL_STREAM))

    const events = await collect(openaiAdapter)
    const calls = callsOf(events)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      id: 'call_1',
      name: 'edit_file',
      arguments: { path: 'notes/a/b.md', search: 'old', replace: 'new' }
    })
    // The arguments only exist because three separate frames were concatenated.
    expect(doneOf(events).stopReason).toBe('tool_calls')
  })

  it('assembles a tool call split across single-byte chunks', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(OPENAI_TOOL_STREAM, 1))

    expect(callsOf(await collect(openaiAdapter))).toEqual([
      {
        id: 'call_1',
        name: 'edit_file',
        arguments: { path: 'notes/a/b.md', search: 'old', replace: 'new' }
      }
    ])
  })

  it('keeps the turn when a completed tool call carries unparseable arguments', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(
      sseResponse(
        [
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"edit_file","arguments":"{not json"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
          'data: [DONE]\n\n'
        ].join('')
      )
    )

    const events = await collect(openaiAdapter)
    const calls = callsOf(events)

    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('edit_file')
    expect(calls[0].arguments.__invalid_arguments).toMatch(/not valid JSON/i)
    expect(doneOf(events).stopReason).toBe('tool_calls')
  })

  it('sends stream:true and a bearer key', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(OPENAI_TEXT_STREAM))

    await collect(openaiAdapter, { baseUrl: 'https://api.example.test/v1/' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.test/v1/chat/completions')
    const headers = init?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-test-key')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body.stream).toBe(true)
    expect(body.model).toBe('test-model')
    expect(body.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hello' }
    ])
  })

  it('omits the auth header entirely when there is no key', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(OPENAI_TEXT_STREAM))

    await collect(openaiAdapter, { apiKey: undefined })

    const [, init] = fetchMock.mock.calls[0]
    expect((init?.headers as Record<string, string>).authorization).toBeUndefined()
  })

  it('turns a 401 into an actionable message', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { message: 'Incorrect API key provided: sk-test' } },
        401,
        'Unauthorized'
      )
    )

    await expect(collect(openaiAdapter)).rejects.toThrow(/api key/i)
    await expect(collect(openaiAdapter)).rejects.toThrow(/401/)
  })

  it('includes a truncated body snippet in the failure message', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(new Response('x'.repeat(900), { status: 500 }))

    const error = await collect(openaiAdapter).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/unavailable/i)
    expect((error as Error).message).toMatch(/\.\.\./)
    expect((error as Error).message.length).toBeLessThan(600)
  })

  it('names the mistake for a 404, which is almost always a wrong base URL', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ error: 'model not found' }, 404, 'Not Found'))

    await expect(collect(openaiAdapter)).rejects.toThrow(/base url/i)
  })

  it('says rate limited for a 429', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ error: 'quota exceeded' }, 429, 'Too Many Requests'))

    await expect(collect(openaiAdapter)).rejects.toThrow(/rate limit|quota/i)
  })

  it('says the provider is at fault for a 5xx', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(new Response('upstream exploded', { status: 503 }))

    await expect(collect(openaiAdapter)).rejects.toThrow(/unavailable/i)
  })

  it('throws an AbortError without dispatching an already-cancelled request', async () => {
    stubFetch()
    const controller = new AbortController()
    controller.abort()

    const events = collect(openaiAdapter, { signal: controller.signal })

    await expect(events).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws an AbortError when cancelled part way through a stream', async () => {
    const controller = new AbortController()
    stubFetch()
    fetchMock.mockResolvedValue(
      stalledResponse(
        [encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')],
        controller.signal
      )
    )

    const iterator = openaiAdapter.stream(request({ signal: controller.signal }))
    const first = await iterator.next()
    expect(first.value).toEqual({ type: 'text', delta: 'partial' })

    controller.abort()
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('refuses to send a key over plain http to a remote host', async () => {
    stubFetch()

    await expect(
      collect(openaiAdapter, { baseUrl: 'http://api.example.test/v1', apiKey: 'sk-test-key' })
    ).rejects.toThrow(/unencrypted/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows a keyless request over plain http to a loopback host', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(OPENAI_TEXT_STREAM))

    const events = await collect(openaiAdapter, {
      baseUrl: 'http://localhost:11434/v1',
      apiKey: undefined
    })

    expect(textOf(events)).toBe('Hello, wörld')
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions')
  })
})

/* ------------------------------------------------------------------------ */
/* Anthropic                                                                 */
/* ------------------------------------------------------------------------ */

const ANTHROPIC_TEXT_STREAM = [
  'event: message_start\n',
  'data: {"type":"message_start","message":{"usage":{"input_tokens":11}}}\n\n',
  'event: content_block_start\n',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  'event: content_block_delta\n',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
  'event: content_block_delta\n',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":", wörld"}}\n\n',
  'event: content_block_stop\n',
  'data: {"type":"content_block_stop","index":0}\n\n',
  'event: message_delta\n',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
  'event: message_stop\n',
  'data: {"type":"message_stop"}\n\n'
].join('')

const ANTHROPIC_TOOL_STREAM = [
  'event: content_block_start\n',
  'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"edit_file","input":{}}}\n\n',
  'event: content_block_delta\n',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"notes/a"}}\n\n',
  'event: content_block_delta\n',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"/b.md\\",\\"search\\":\\"old\\""}}\n\n',
  'event: content_block_delta\n',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":",\\"replace\\":\\"new\\"}"}}\n\n',
  'event: content_block_stop\n',
  'data: {"type":"content_block_stop","index":1}\n\n',
  'event: message_delta\n',
  'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}\n\n',
  'event: message_stop\n',
  'data: {"type":"message_stop"}\n\n'
].join('')

describe('anthropic adapter', () => {
  it('accumulates text deltas into the full string', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(ANTHROPIC_TEXT_STREAM))

    const events = await collect(anthropicAdapter)

    expect(textOf(events)).toBe('Hello, wörld')
    expect(doneOf(events).stopReason).toBe('end_turn')
    expect(doneOf(events).usage).toEqual({ inputTokens: 11, outputTokens: 5 })
  })

  it('survives a stream fed one byte at a time', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(ANTHROPIC_TEXT_STREAM, 1))

    expect(textOf(await collect(anthropicAdapter))).toBe('Hello, wörld')
  })

  it('dispatches on the event type rather than the payload shape', async () => {
    // A text delta that arrives under a content_block_delta type carrying an
    // unknown delta kind must not be mistaken for a tool argument fragment.
    stubFetch()
    fetchMock.mockResolvedValue(
      sseResponse(
        [
          'event: content_block_delta\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}\n\n',
          'event: content_block_delta\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n',
          'event: message_stop\n',
          'data: {"type":"message_stop"}\n\n'
        ].join('')
      )
    )

    const events = await collect(anthropicAdapter)

    expect(textOf(events)).toBe('ok')
    expect(callsOf(events)).toEqual([])
  })

  it('emits a partially streamed tool call whole and parsed', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(ANTHROPIC_TOOL_STREAM))

    const events = await collect(anthropicAdapter)

    expect(callsOf(events)).toEqual([
      {
        id: 'toolu_1',
        name: 'edit_file',
        arguments: { path: 'notes/a/b.md', search: 'old', replace: 'new' }
      }
    ])
    expect(doneOf(events).stopReason).toBe('tool_calls')
  })

  it('assembles a tool call split across single-byte chunks', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(ANTHROPIC_TOOL_STREAM, 1))

    expect(callsOf(await collect(anthropicAdapter))).toEqual([
      {
        id: 'toolu_1',
        name: 'edit_file',
        arguments: { path: 'notes/a/b.md', search: 'old', replace: 'new' }
      }
    ])
  })

  it('sends the version header and the required max_tokens', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(ANTHROPIC_TEXT_STREAM))

    await collect(anthropicAdapter, { baseUrl: 'https://api.example.test/v1/' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.test/v1/messages')
    const headers = init?.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-test-key')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    // Anthropic has no system message role; the prompt is a top-level field.
    expect(body.system).toBe('be brief')
    expect(body.max_tokens).toBe(128)
    expect(body.stream).toBe(true)
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }])
  })

  it('merges consecutive tool results into one user turn', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(ANTHROPIC_TEXT_STREAM))

    await collect(anthropicAdapter, {
      messages: [
        { role: 'user', content: 'edit two files' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'call_1', name: 'edit_file', arguments: { path: 'a.md' } },
            { id: 'call_2', name: 'edit_file', arguments: { path: 'b.md' } }
          ]
        },
        { role: 'tool', toolCallId: 'call_1', name: 'edit_file', content: 'done a' },
        { role: 'tool', toolCallId: 'call_2', name: 'edit_file', content: 'done b' }
      ]
    })

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      messages: { role: string; content: { type: string }[] }[]
    }

    // Anthropic refuses non-alternating roles, and a parallel tool loop produces
    // exactly that unless the results are merged.
    expect(body.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
    expect(body.messages[2].content).toHaveLength(2)
  })

  it('turns a 401 into an actionable message', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401)
    )

    await expect(collect(anthropicAdapter)).rejects.toThrow(/api key/i)
  })

  it('throws an AbortError without dispatching an already-cancelled request', async () => {
    stubFetch()
    const controller = new AbortController()
    controller.abort()

    await expect(collect(anthropicAdapter, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws an AbortError when cancelled part way through a stream', async () => {
    const controller = new AbortController()
    stubFetch()
    fetchMock.mockResolvedValue(
      stalledResponse(
        [
          encode(
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"part"}}\n\n'
          )
        ],
        controller.signal
      )
    )

    const iterator = anthropicAdapter.stream(request({ signal: controller.signal }))
    expect((await iterator.next()).value).toEqual({ type: 'text', delta: 'part' })
    controller.abort()
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('refuses to send a key over plain http to a remote host', async () => {
    stubFetch()

    await expect(
      collect(anthropicAdapter, { baseUrl: 'http://api.anthropic.test/v1', apiKey: 'sk-x' })
    ).rejects.toThrow(/unencrypted/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------------ */
/* Gemini                                                                    */
/* ------------------------------------------------------------------------ */

const GEMINI_TEXT_STREAM = [
  'data: {"candidates":[{"index":0,"content":{"parts":[{"text":"Hello"}],"role":"model"}}]}\n\n',
  'data: {"candidates":[{"index":0,"content":{"parts":[{"text":", wörld"}],"role":"model"}}]}\n\n',
  'data: {"candidates":[{"index":0,"content":{"parts":[]},"role":"model","finishReason":"STOP"}],',
  '"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":3}}\n\n'
].join('')

const GEMINI_TOOL_STREAM =
  'data: {"candidates":[{"index":0,"content":{"parts":[{"functionCall":{"id":"fc1",' +
  '"name":"edit_file","args":{"path":"notes/a/b.md","search":"old","replace":"new"}}}],"role":"model"},' +
  '"finishReason":"STOP"}]}\n\n'

describe('gemini adapter', () => {
  it('accumulates text deltas into the full string', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(GEMINI_TEXT_STREAM))

    const events = await collect(geminiAdapter)

    expect(textOf(events)).toBe('Hello, wörld')
    expect(doneOf(events).stopReason).toBe('end_turn')
    expect(doneOf(events).usage).toEqual({ inputTokens: 7, outputTokens: 3 })
  })

  it('survives a stream fed one byte at a time', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(GEMINI_TEXT_STREAM, 1))

    expect(textOf(await collect(geminiAdapter))).toBe('Hello, wörld')
  })

  it('emits a function call as a whole tool call', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(GEMINI_TOOL_STREAM, 1))

    const events = await collect(geminiAdapter)

    expect(callsOf(events)).toEqual([
      {
        id: 'fc1',
        name: 'edit_file',
        arguments: { path: 'notes/a/b.md', search: 'old', replace: 'new' }
      }
    ])
    expect(doneOf(events).stopReason).toBe('tool_calls')
  })

  it('keeps two identical function calls apart instead of merging them', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(
      sseResponse(
        'data: {"candidates":[{"index":0,"content":{"parts":[' +
          '{"functionCall":{"name":"read_file","args":{"path":"a.md"}}},' +
          '{"functionCall":{"name":"read_file","args":{"path":"b.md"}}}' +
          '],"role":"model"},"finishReason":"STOP"}]}\n\n'
      )
    )

    const calls = callsOf(await collect(geminiAdapter))

    expect(calls).toHaveLength(2)
    expect(calls.map((call) => call.arguments.path)).toEqual(['a.md', 'b.md'])
  })

  it('maps a safety stop to an error reason rather than a clean end', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(
      sseResponse(
        'data: {"candidates":[{"index":0,"content":{"parts":[]},"finishReason":"SAFETY"}]}\n\n'
      )
    )

    expect(doneOf(await collect(geminiAdapter)).stopReason).toBe('error')
  })

  it('puts the model in the path and asks for an SSE stream', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(GEMINI_TEXT_STREAM))

    await collect(geminiAdapter, { model: 'gemini-2.5-flash' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://api.example.test/v1/models/gemini-2.5-flash:streamGenerateContent?alt=sse'
    )
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('sk-test-key')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }])
    expect(body.systemInstruction).toEqual({ role: 'user', parts: [{ text: 'be brief' }] })
  })

  it('accepts a model id that still carries the models/ prefix', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(GEMINI_TEXT_STREAM))

    await collect(geminiAdapter, { model: 'models/gemini-2.5-flash' })

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/models/gemini-2.5-flash:streamGenerateContent'
    )
  })

  it('turns a 400 key error into an actionable message', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { message: 'API key not valid. Please pass a valid API key.' } }, 400)
    )

    await expect(collect(geminiAdapter)).rejects.toThrow(/rejected the request/i)
  })

  it('turns a 403 into an actionable message', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'permission denied' } }, 403))

    await expect(collect(geminiAdapter)).rejects.toThrow(/not allowed/i)
  })

  it('throws an AbortError without dispatching an already-cancelled request', async () => {
    stubFetch()
    const controller = new AbortController()
    controller.abort()

    await expect(collect(geminiAdapter, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws an AbortError when cancelled part way through a stream', async () => {
    const controller = new AbortController()
    stubFetch()
    fetchMock.mockResolvedValue(
      stalledResponse(
        [encode('data: {"candidates":[{"index":0,"content":{"parts":[{"text":"part"}]}}]}\n\n')],
        controller.signal
      )
    )

    const iterator = geminiAdapter.stream(request({ signal: controller.signal }))
    expect((await iterator.next()).value).toEqual({ type: 'text', delta: 'part' })
    controller.abort()
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('refuses to send a key over plain http to a remote host', async () => {
    stubFetch()

    await expect(
      collect(geminiAdapter, { baseUrl: 'http://generativelanguage.test/v1beta', apiKey: 'k' })
    ).rejects.toThrow(/unencrypted/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
