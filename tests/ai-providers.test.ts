import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StreamEvent, ToolCall } from '../src/shared/ai/types'
import { anthropicAdapter } from '../src/main/ai/providers/anthropic'
import { geminiAdapter } from '../src/main/ai/providers/gemini'
import { openaiAdapter } from '../src/main/ai/providers/openai'
import { PRESETS } from '../src/main/ai/providers/index'
import type { ProviderAdapter, StreamRequest } from '../src/main/ai/providers/types'
import { NATIVE_TOOL_MARKUP_ERROR } from '../src/main/ai/providers/native-tool-markup'

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

describe('compatible cloud providers', () => {
  it.each(['test-model', 'gpt-5-mini', 'deepseek-flash'])(
    'omits the output cap for %s in Automatic mode',
    async (model) => {
      stubFetch()
      fetchMock.mockResolvedValue(sseResponse('data: [DONE]\n\n'))
      await collect(openaiAdapter, { model, maxTokens: undefined })
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>
      expect(body).not.toHaveProperty('max_tokens')
      expect(body).not.toHaveProperty('max_completion_tokens')
    }
  )
  it.each(['openrouter', 'deepseek', 'groq', 'mistral', 'xai'])(
    'streams text and complete tool calls from %s',
    async (providerId) => {
      stubFetch()
      const preset = PRESETS.find((entry) => entry.id === providerId)!
      const frames =
        [
          { choices: [{ delta: { content: 'Searching.' } }] },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'search-1',
                      function: { name: 'web_search', arguments: '{"query":' }
                    }
                  ]
                }
              }
            ]
          },
          {
            choices: [
              {
                delta: { tool_calls: [{ index: 0, function: { arguments: '"Rust"}' } }] },
                finish_reason: 'tool_calls'
              }
            ]
          },
          { usage: { prompt_tokens: 15, completion_tokens: 8 } }
        ]
          .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
          .join('') + 'data: [DONE]\n\n'
      fetchMock.mockResolvedValue(sseResponse(frames, 7))
      const events = await collect(openaiAdapter, {
        baseUrl: preset.defaultBaseUrl,
        model: preset.defaultModel
      })
      expect(textOf(events)).toBe('Searching.')
      expect(callsOf(events)).toEqual([
        { id: 'search-1', name: 'web_search', arguments: { query: 'Rust' } }
      ])
      expect(doneOf(events)).toMatchObject({
        stopReason: 'tool_calls',
        usage: { inputTokens: 15, outputTokens: 8 }
      })
      expect(fetchMock.mock.calls[0][0]).toBe(`${preset.defaultBaseUrl}/chat/completions`)
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>
      expect(body.model).toBe(preset.defaultModel)
      expect(body.stream_options).toEqual(
        providerId === 'mistral' ? undefined : { include_usage: true }
      )
    }
  )

  it('replays signed calls and hidden reasoning exactly when returning tool results', async () => {
    stubFetch()
    const extraContent = { google: { thought_signature: 'opaque-signature' } }
    const details = [
      { type: 'reasoning.text', text: 'First ', index: 0, signature: null },
      { type: 'reasoning.text', text: 'second', index: 0, signature: 'signed' },
      { type: 'reasoning.encrypted', data: 'opaque', index: 1 }
    ]
    const frames =
      [
        {
          choices: [
            {
              delta: {
                reasoning_content: 'Hidden ',
                reasoning: 'Private ',
                reasoning_details: [details[0]],
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-a',
                    extra_content: extraContent,
                    function: { name: 'web_search', arguments: '{"query":"Rust"' }
                  }
                ]
              }
            }
          ]
        },
        {
          choices: [
            {
              delta: {
                reasoning_content: 'thought',
                reasoning: 'analysis',
                reasoning_details: details.slice(1),
                tool_calls: [{ index: 0, function: { arguments: '}' } }]
              },
              finish_reason: 'tool_calls'
            }
          ]
        }
      ]
        .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
        .join('') + 'data: [DONE]\n\n'
    fetchMock.mockResolvedValueOnce(sseResponse(frames, 9))
    const events = await collect(openaiAdapter)
    expect(textOf(events)).toBe('')
    expect(callsOf(events)[0].extraContent).toEqual(extraContent)
    expect(doneOf(events).providerMetadata?.openai).toEqual({
      reasoningContent: 'Hidden thought',
      reasoning: 'Private analysis',
      reasoningDetails: details
    })
    fetchMock.mockResolvedValueOnce(sseResponse('data: [DONE]\n\n'))
    await collect(openaiAdapter, {
      messages: [
        {
          role: 'assistant',
          content: '',
          toolCalls: callsOf(events),
          providerMetadata: doneOf(events).providerMetadata
        },
        { role: 'tool', content: 'Results', toolCallId: 'call-a', name: 'web_search' }
      ]
    })
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as { messages: unknown[] }
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: null,
      reasoning_content: 'Hidden thought',
      reasoning: 'Private analysis',
      reasoning_details: details,
      tool_calls: [
        {
          id: 'call-a',
          type: 'function',
          extra_content: extraContent,
          function: { name: 'web_search', arguments: '{"query":"Rust"}' }
        }
      ]
    })
  })
})

describe('interrupted provider streams', () => {
  it.each([true, false])('handles a socket failure with a terminal frame=%s', async (complete) => {
    stubFetch()
    let reads = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (reads++ === 0) {
          controller.enqueue(
            encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: 'Response' }, ...(complete ? { finish_reason: 'stop' } : {}) }] })}\n\n`
            )
          )
        } else {
          controller.error(new Error('terminated'))
        }
      }
    })
    fetchMock.mockResolvedValue(new Response(stream))
    if (complete) {
      const events = await collect(openaiAdapter)
      expect(textOf(events)).toBe('Response')
      expect(doneOf(events).stopReason).toBe('end_turn')
    } else {
      await expect(collect(openaiAdapter)).rejects.toThrow('No edits were applied. Try again.')
    }
  })
  it.each([
    [openaiAdapter, 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'],
    [
      anthropicAdapter,
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}\n\n'
    ],
    [geminiAdapter, 'data: {"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}\n\n']
  ] as const)('rejects an incomplete response from $descriptor.id', async (adapter, partial) => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(partial))
    await expect(collect(adapter)).rejects.toThrow(/ended before it was complete/)
  })
})

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
  it.each(['<|DSML|tool_calls>', '<｜DSML｜function_calls>'])(
    'rejects fragmented native markup %s after prose without leaking it',
    async (marker) => {
      stubFetch()
      const pieces = ['Checking the note.\n', ...marker, 'raw tool instructions']
      fetchMock.mockResolvedValue(
        sseResponse(
          pieces
            .map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
            .join('') + 'data: [DONE]\n\n'
        )
      )
      const events: StreamEvent[] = []
      await expect(
        (async () => {
          for await (const event of openaiAdapter.stream(request())) events.push(event)
        })()
      ).rejects.toThrow(NATIVE_TOOL_MARKUP_ERROR)
      expect(textOf(events)).toBe('Checking the note.\n')
      expect(callsOf(events)).toEqual([])
    }
  )

  it('disables DeepSeek thinking and tool choice only for the recovery request', async () => {
    stubFetch()
    fetchMock.mockImplementation(async () => sseResponse('data: [DONE]\n\n'))
    await collect(openaiAdapter, {
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      disableThinking: true
    })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.tool_choice).toBe('none')
    expect(body.tools).toBeUndefined()
    await collect(openaiAdapter, { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro' })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).not.toHaveProperty('thinking')
    await collect(openaiAdapter, { disableThinking: true })
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).not.toHaveProperty('thinking')
  })
  it('does not report filtered output as a completed response', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(
      sseResponse(
        'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\ndata: [DONE]\n\n'
      )
    )
    const events = await collect(openaiAdapter)
    expect(events.some((event) => event.type === 'error')).toBe(true)
    expect(doneOf(events).stopReason).toBe('error')
  })
  it('renders refusal deltas as part of the reply', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(
      sseResponse(
        'data: {"choices":[{"delta":{"refusal":"Cannot help."},"finish_reason":"stop"}]}\n\n'
      )
    )
    expect(textOf(await collect(openaiAdapter))).toBe('Cannot help.')
  })

  it('stops at the completion sentinel even when the server keeps the socket open', async () => {
    stubFetch()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encode('data: [DONE]\n\n'))
      }
    })
    fetchMock.mockResolvedValue(new Response(body))
    expect(await collect(openaiAdapter)).toEqual([{ type: 'done', stopReason: 'end_turn' }])
  })

  it('does not emit buffered text after cancellation', async () => {
    stubFetch()
    const controller = new AbortController()
    fetchMock.mockResolvedValue(sseResponse(OPENAI_TEXT_STREAM))
    const iterator = openaiAdapter.stream(request({ signal: controller.signal }))
    expect((await iterator.next()).value?.type).toBe('text')
    controller.abort()
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('redacts a key echoed by the provider in HTTP and stream errors', async () => {
    stubFetch()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: 'Rejected sk-test-key' } }, 401)
    )
    const error = await collect(openaiAdapter).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('[redacted]')
    expect((error as Error).message).not.toContain('sk-test-key')
    fetchMock.mockResolvedValueOnce(
      sseResponse('data: {"error":{"message":"Rejected sk-test-key"}}\n\n')
    )
    expect(await collect(openaiAdapter)).toEqual([
      { type: 'error', message: 'Rejected [redacted]' }
    ])
  })
  it.each(['o3', 'o4-mini', 'gpt-5', 'gpt-5.4', 'gpt-6-astra', 'ft:gpt-5:org:model'])(
    'uses compatible generation parameters for %s',
    async (model) => {
      stubFetch()
      fetchMock.mockResolvedValue(sseResponse('data: [DONE]\n\n'))
      await collect(openaiAdapter, { model })
      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as Record<string, unknown>
      expect(body.max_completion_tokens).toBe(128)
      expect(body).not.toHaveProperty('max_tokens')
      expect(body).not.toHaveProperty('temperature')
    }
  )

  it('surfaces a provider error delivered inside a successful SSE response', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse('data: {"error":{"message":"Quota exceeded"}}\n\n'))
    expect(await collect(openaiAdapter)).toEqual([{ type: 'error', message: 'Quota exceeded' }])
  })
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
  it.each([undefined, 65536])('supplies the required output limit for %s', async (limit) => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(ANTHROPIC_TEXT_STREAM))
    await collect(anthropicAdapter, { maxTokens: limit })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>
    expect(body.max_tokens).toBe(limit ?? 4096)
  })
  it('reports a context-window limit as truncated output', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(
      sseResponse(
        'data: {"type":"message_delta","delta":{"stop_reason":"model_context_window_exceeded"}}\n\n' +
          'data: {"type":"message_stop"}\n\n'
      )
    )
    expect(doneOf(await collect(anthropicAdapter)).stopReason).toBe('max_tokens')
  })
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
  it.each([undefined, 65536])('uses automatic or explicit output limit %s', async (limit) => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse(GEMINI_TEXT_STREAM))
    await collect(geminiAdapter, { maxTokens: limit })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      generationConfig: Record<string, unknown>
    }
    if (limit === undefined) expect(body.generationConfig).not.toHaveProperty('maxOutputTokens')
    else expect(body.generationConfig.maxOutputTokens).toBe(limit)
  })
  it.each(['LANGUAGE', 'OTHER', 'UNEXPECTED_TOOL_CALL', 'MALFORMED_RESPONSE'])(
    'reports %s as a failed response',
    async (finishReason) => {
      stubFetch()
      fetchMock.mockResolvedValue(
        sseResponse(`data: ${JSON.stringify({ candidates: [{ finishReason }] })}\n\n`)
      )
      const events = await collect(geminiAdapter)
      expect(events.some((event) => event.type === 'error')).toBe(true)
      expect(doneOf(events).stopReason).toBe('error')
    }
  )
  it('reports a provider error sent inside a successful event stream', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(sseResponse('data: {"error":{"message":"Quota exceeded"}}\n\n'))
    expect(await collect(geminiAdapter)).toEqual([{ type: 'error', message: 'Quota exceeded' }])
  })

  it('reports a blocked prompt instead of an empty successful reply', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(
      sseResponse('data: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n')
    )
    expect(await collect(geminiAdapter)).toEqual([
      {
        type: 'error',
        message: 'Gemini blocked this prompt (SAFETY). Rephrase the message and try again.'
      }
    ])
  })

  it('keeps thought summaries out of the assistant reply', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(
      sseResponse(
        'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"Thinking"},{"text":"Answer"}]},"finishReason":"STOP"}]}\n\n'
      )
    )
    expect(textOf(await collect(geminiAdapter))).toBe('Answer')
  })
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
