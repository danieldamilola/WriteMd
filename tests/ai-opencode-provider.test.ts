import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { OpenCodeCatalog, openCodeRoutes } from '../src/main/ai/providers/opencode'
import { chatgptAdapter } from '../src/main/ai/providers/chatgpt'
import { adapterFor, PRESETS } from '../src/main/ai/providers'
import { EMPTY_OPENCODE_AUTH, type OpenCodeAuthView } from '../src/shared/ai/opencode'
import type { StreamEvent } from '../src/shared/ai/types'
import type { StreamRequest } from '../src/main/ai/providers/types'

vi.mock('electron', () => ({ app: {}, safeStorage: {}, shell: {} }))
afterEach(() => {
  vi.unstubAllGlobals()
})
const signal = (): AbortSignal => new AbortController().signal
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status })
const sse = (frames: unknown[]): Response =>
  new Response(
    frames
      .map((frame) => `data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`)
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } }
  )
const config = {
  providers: {
    console: {
      name: 'Workspace',
      package: 'aisdk:@ai-sdk/openai-compatible',
      settings: { baseURL: 'https://opencode.ai/inference/openai/v1' },
      models: {
        kimi: { name: 'Kimi', modelID: 'kimi-k2.6' },
        gpt: { name: 'GPT', package: 'aisdk:@ai-sdk/openai', modelID: 'gpt-5.5' },
        claude: {
          name: 'Claude',
          package: 'aisdk:@ai-sdk/anthropic',
          settings: { baseURL: 'https://opencode.ai/inference/anthropic/v1' },
          modelID: 'claude-sonnet-4-6'
        },
        gemini: {
          name: 'Gemini',
          package: 'aisdk:@ai-sdk/google',
          settings: { baseURL: 'https://opencode.ai/inference/google/v1beta' },
          modelID: 'gemini-3.1-pro'
        }
      }
    }
  }
}
function request(model = 'console/kimi'): StreamRequest {
  return {
    baseUrl: 'https://evil.test',
    apiKey: 'unrelated-saved-key',
    model,
    messages: [{ role: 'user', content: 'Review this note' }],
    system: 'Write clearly',
    temperature: 0.4,
    signal: signal(),
    sessionId: 'conversation-1'
  }
}
async function collect(stream: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}
function fixture(frames: unknown[]): {
  state: OpenCodeAuthView
  account: { state: () => OpenCodeAuthView; accessToken: Mock<() => Promise<string>> }
  fetcher: Mock<typeof fetch>
  catalog: OpenCodeCatalog
} {
  const state: OpenCodeAuthView = {
    ...EMPTY_OPENCODE_AUTH,
    connected: true,
    workspaceId: 'org_test',
    connectionId: 'connection-1'
  }
  const account = {
    state: () => state,
    accessToken: vi.fn<() => Promise<string>>().mockResolvedValue('console-secret')
  }
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith('/config') ? json(config) : sse(frames)
  )
  vi.stubGlobal('fetch', fetcher)
  const catalog = new OpenCodeCatalog(() => account)
  return { state, account, fetcher, catalog }
}

describe('OpenCode workspace models', () => {
  it('registers an account provider without changing API-key URL matching', () => {
    expect(PRESETS.find((preset) => preset.id === 'opencode')).toMatchObject({
      keyRequired: false,
      selectableByUrl: false
    })
    expect(adapterFor('opencode')?.descriptor.id).toBe('opencode')
  })
  it('reads provider defaults and per-model API families', () => {
    expect(openCodeRoutes(config).map((route) => [route.id, route.kind, route.model])).toEqual([
      ['console/kimi', 'openai', 'kimi-k2.6'],
      ['console/gpt', 'responses', 'gpt-5.5'],
      ['console/claude', 'anthropic', 'claude-sonnet-4-6'],
      ['console/gemini', 'gemini', 'gemini-3.1-pro']
    ])
  })
  it.each([
    'http://opencode.ai/inference/openai/v1',
    'https://evil.test/inference/openai/v1',
    'https://opencode.ai.evil.test/inference/v1',
    'https://opencode.ai/console',
    'https://opencode.ai/inference/v1?key=x'
  ])('never sends Console credentials to an untrusted gateway: %s', (baseURL) => {
    expect(
      openCodeRoutes({
        providers: {
          bad: { package: '@ai-sdk/openai-compatible', settings: { baseURL }, models: { test: {} } }
        }
      })
    ).toEqual([])
  })
  it('skips disabled and unsupported models and keeps provider/model identity distinct', () => {
    const routes = openCodeRoutes({
      providers: {
        a: {
          package: '@ai-sdk/openai-compatible',
          settings: { baseURL: 'https://opencode.ai/inference/openai/v1' },
          models: {
            'x/y': { name: 'Nested id' },
            disabled: { disabled: true },
            unsupported: { package: 'untrusted-plugin' }
          }
        }
      }
    })
    expect(routes.map((route) => route.id)).toEqual(['a/x%2Fy'])
  })
  it('returns display metadata and supported options without credentials or routes', async () => {
    const { catalog } = fixture([])
    const models = await catalog.models(signal())
    expect(models[0]).toEqual({
      id: 'console/kimi',
      label: 'Kimi · Workspace',
      options: { reasoning: [], serviceTiers: [] }
    })
    expect(models.find((model) => model.id === 'console/gpt')?.options).toEqual({
      reasoning: ['none', 'low', 'medium', 'high', 'xhigh'],
      serviceTiers: []
    })
    expect(JSON.stringify(models)).not.toContain('console-secret')
    expect(JSON.stringify(models)).not.toContain('baseURL')
  })
  it('rejects a late catalogue after signing out', async () => {
    const { catalog, state } = fixture([])
    vi.stubGlobal('fetch', async () => {
      state.connected = false
      state.connectionId = null
      return json(config)
    })
    await expect(catalog.models(signal())).rejects.toThrow('account changed')
  })
})

describe('OpenCode assistant routing', () => {
  it('forwards supported reasoning while leaving Console service tiers to the workspace', async () => {
    const { catalog, fetcher } = fixture([{ type: 'response.completed', response: {} }])
    await collect(
      catalog.stream({
        ...request('console/gpt'),
        modelOptions: { reasoning: 'high', serviceTier: 'priority' }
      })
    )
    const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body)) as Record<string, unknown>
    expect(body).toHaveProperty('reasoning', { effort: 'high' })
    expect(body).not.toHaveProperty('service_tier')
  })
  it.each([
    [
      'kimi',
      '/openai/v1/chat/completions',
      [{ choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] }, '[DONE]']
    ],
    [
      'gpt',
      '/openai/v1/responses',
      [
        { type: 'response.output_text.delta', delta: 'Hello' },
        { type: 'response.completed', response: { usage: { input_tokens: 3, output_tokens: 1 } } }
      ]
    ],
    [
      'claude',
      '/anthropic/v1/messages',
      [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
        { type: 'message_stop' }
      ]
    ],
    [
      'gemini',
      '/google/v1beta/models/gemini-3.1-pro:streamGenerateContent?alt=sse',
      [{ candidates: [{ content: { parts: [{ text: 'Hello' }] }, finishReason: 'STOP' }] }]
    ]
  ] as const)(
    'streams %s through the API family in the workspace config',
    async (id, suffix, frames) => {
      const { catalog, fetcher } = fixture([...frames])
      const events = await collect(catalog.stream(request(`console/${id}`)))
      expect(events).toContainEqual({ type: 'text', delta: 'Hello' })
      expect(events.some((event) => event.type === 'done')).toBe(true)
      const [url, init] = fetcher.mock.calls[1]
      expect(String(url)).toBe(`https://opencode.ai/inference${suffix}`)
      expect(init?.headers).toMatchObject({
        authorization: 'Bearer console-secret',
        'user-agent': 'WriteMd',
        'x-opencode-session': 'conversation-1'
      })
      expect(JSON.stringify(init)).not.toContain('unrelated-saved-key')
      expect(JSON.stringify(init?.headers)).not.toContain('x-api-key')
      expect(init?.redirect).toBe('error')
    }
  )
  it('refuses models absent from the workspace catalogue', async () => {
    const { catalog, fetcher } = fixture([])
    await expect(collect(catalog.stream(request('console/unavailable')))).rejects.toThrow(
      'unavailable'
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each(['claude', 'gemini'])(
    'redacts Console credentials from %s stream errors',
    async (model) => {
      const { catalog } = fixture([
        { type: 'error', error: { message: 'Rejected console-secret' } }
      ])
      const events = await collect(catalog.stream(request(`console/${model}`)))
      expect(events).toContainEqual({ type: 'error', message: 'Rejected [redacted]' })
      expect(JSON.stringify(events)).not.toContain('console-secret')
    }
  )
  it('does not stream a cached model after a workspace change', async () => {
    const { catalog, fetcher, state } = fixture([])
    await catalog.models(signal())
    state.connectionId = 'connection-2'
    state.workspaceId = 'org_other'
    fetcher.mockImplementation(async () => json({ providers: {} }))
    await expect(collect(catalog.stream(request()))).rejects.toThrow('No supported text models')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('explains the free-tier restriction without calling it a bad API key', async () => {
    const { catalog, fetcher } = fixture([])
    fetcher.mockImplementation(async (url) =>
      String(url).endsWith('/config')
        ? json(config)
        : json(
            {
              error: {
                type: 'FreeTierError',
                message: "OpenCode's free tier can only be used from within OpenCode."
              }
            },
            403
          )
    )
    await expect(collect(catalog.stream(request()))).rejects.toThrow(
      'restricted to the OpenCode app'
    )
    try {
      await collect(catalog.stream(request()))
    } catch (error) {
      expect(String(error)).not.toContain('API key')
    }
  })
})

describe('shared Responses streaming', () => {
  it('preserves ChatGPT tool calls, encrypted reasoning, usage and replay', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      sse([
        {
          type: 'response.output_item.done',
          item: { type: 'reasoning', id: 'reason-1', encrypted_content: 'encrypted' }
        },
        {
          type: 'response.output_item.done',
          item: {
            type: 'function_call',
            call_id: 'call-1',
            name: 'web_search',
            arguments: '{"query":"markdown"}'
          }
        },
        { type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 5 } } }
      ])
    )
    vi.stubGlobal('fetch', fetcher)
    const events = await collect(
      chatgptAdapter.stream({
        ...request('gpt-test'),
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'chatgpt-secret',
        messages: [
          {
            role: 'assistant',
            content: '',
            providerMetadata: { responses: [{ type: 'reasoning', encrypted_content: 'prior' }] },
            toolCalls: [{ id: 'prior-call', name: 'web_search', arguments: { query: 'prior' } }]
          },
          { role: 'tool', toolCallId: 'prior-call', content: 'Search result' }
        ]
      })
    )
    expect(events).toContainEqual({
      type: 'tool-call',
      call: { id: 'call-1', name: 'web_search', arguments: { query: 'markdown' } }
    })
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      stopReason: 'tool_calls',
      usage: { inputTokens: 10, outputTokens: 5 },
      providerMetadata: {
        responses: [{ encrypted_content: 'encrypted', id: 'reason-1', type: 'reasoning' }]
      }
    })
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    expect(body.input).toContainEqual({ type: 'reasoning', encrypted_content: 'prior' })
    expect(body.input).toContainEqual({
      type: 'function_call_output',
      call_id: 'prior-call',
      output: 'Search result'
    })
  })
  it('rejects truncated Responses streams', async () => {
    vi.stubGlobal('fetch', async () =>
      sse([{ type: 'response.output_text.delta', delta: 'unfinished' }])
    )
    await expect(
      collect(
        chatgptAdapter.stream({
          ...request(),
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'test'
        })
      )
    ).rejects.toThrow('before response completion')
  })
})
