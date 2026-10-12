import { afterEach, describe, expect, it, vi } from 'vitest'
import { anthropicAdapter } from '../src/main/ai/providers/anthropic'
import { geminiAdapter } from '../src/main/ai/providers/gemini'
import { openaiAdapter } from '../src/main/ai/providers/openai'
import { ADAPTERS, adapterFor, matchPresetByBaseUrl, PRESETS } from '../src/main/ai/providers/index'

/**
 * Model listing, the preset registry, and the endpoint gate.
 *
 * The reason `listModels` rejects rather than resolving `[]` on a bad key is the
 * whole point of most of what follows: an empty model list and an expired key
 * look identical in the picker, and telling a user "no models available" about
 * a key that stopped working last night is the kind of message that costs an
 * afternoon.
 */

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function stubFetch(): void {
  vi.stubGlobal('fetch', fetchMock)
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/** Route by URL substring, so a fallback request can answer differently. */
function route(routes: [matcher: string, respond: () => Response][]): void {
  fetchMock.mockImplementation((url: string) => {
    for (const [matcher, respond] of routes) {
      if (url.includes(matcher)) return Promise.resolve(respond())
    }
    return Promise.resolve(jsonResponse({ error: { message: 'no route' } }, 404))
  })
}

const signal = new AbortController().signal

describe('openai model listing', () => {
  it('parses, sorts and dedupes data[].id', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(
      jsonResponse({
        object: 'list',
        data: [
          { id: 'gpt-4o-mini' },
          { id: 'gpt-4o' },
          { id: 'gpt-4o' },
          { id: 'o4-mini' },
          { id: 'gpt-3.5-turbo' }
        ]
      })
    )

    await expect(
      openaiAdapter.listModels({ baseUrl: 'https://api.example.test/v1' }, signal)
    ).resolves.toEqual(['gpt-3.5-turbo', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'])
  })

  it('rejects on a 401 rather than reporting no models', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { message: 'Incorrect API key provided' } }, 401)
    )

    const listing = openaiAdapter.listModels(
      { baseUrl: 'https://api.example.test/v1', apiKey: 'sk-bad' },
      signal
    )

    await expect(listing).rejects.toThrow(/api key/i)
    await expect(listing).rejects.toThrow(/401/)
  })

  it('rejects on a 403', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'no access' } }, 403))

    await expect(
      openaiAdapter.listModels({ baseUrl: 'https://api.example.test/v1', apiKey: 'k' }, signal)
    ).rejects.toThrow(/not allowed/i)
  })

  it('asks for the list with a bearer key', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }))

    await openaiAdapter
      .listModels({ baseUrl: 'https://api.example.test/v1/', apiKey: 'sk-test' }, signal)
      .catch(() => undefined)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.test/v1/models')
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
  })

  it('does not send an auth header when no key is set', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'local-model' }] }))

    await openaiAdapter.listModels({ baseUrl: 'http://localhost:1234/v1' }, signal)

    expect(
      (fetchMock.mock.calls[0][1]?.headers as Record<string, string>).authorization
    ).toBeUndefined()
  })

  it('rejects rather than listing when the endpoint would leak the key', async () => {
    stubFetch()

    await expect(
      openaiAdapter.listModels(
        { baseUrl: 'http://proxy.example.test/v1', apiKey: 'sk-test' },
        signal
      )
    ).rejects.toThrow(/unencrypted/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects on an unparseable endpoint without calling fetch', async () => {
    stubFetch()

    await expect(openaiAdapter.listModels({ baseUrl: 'not a url' }, signal)).rejects.toThrow(/URL/i)
    await expect(openaiAdapter.listModels({ baseUrl: '   ' }, signal)).rejects.toThrow(
      /not configured/i
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an aborted listing before dispatch', async () => {
    stubFetch()
    const controller = new AbortController()
    controller.abort()

    await expect(
      openaiAdapter.listModels({ baseUrl: 'https://api.example.test/v1' }, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces an AbortError when the request is cancelled in flight', async () => {
    const controller = new AbortController()
    stubFetch()
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('aborted')
              error.name = 'AbortError'
              reject(error)
            },
            { once: true }
          )
        })
    )

    const listing = openaiAdapter.listModels(
      { baseUrl: 'https://api.example.test/v1' },
      controller.signal
    )
    controller.abort()

    await expect(listing).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('ollama model listing', () => {
  it('prefers the OpenAI-compatible list when it has models', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'llama3.2' }, { id: 'qwen2.5' }] }))

    await expect(
      openaiAdapter.listModels({ baseUrl: 'http://localhost:11434/v1' }, signal)
    ).resolves.toEqual(['llama3.2', 'qwen2.5'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to /api/tags when the compatible list is empty', async () => {
    stubFetch()
    route([
      [
        '/api/tags',
        () => jsonResponse({ models: [{ name: 'nomic-embed-text' }, { name: 'llama3.2' }] })
      ],
      ['/models', () => jsonResponse({ data: [] })]
    ])

    await expect(
      openaiAdapter.listModels({ baseUrl: 'http://localhost:11434/v1' }, signal)
    ).resolves.toEqual(['llama3.2', 'nomic-embed-text'])
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'http://localhost:11434/v1/models',
      'http://localhost:11434/api/tags'
    ])
  })

  it('tolerates a trailing slash on the local base URL', async () => {
    stubFetch()
    route([
      ['/api/tags', () => jsonResponse({ models: [{ name: 'llama3.2' }] })],
      ['/models', () => jsonResponse({ object: 'list', data: [] })]
    ])

    await expect(
      openaiAdapter.listModels({ baseUrl: 'http://localhost:11434/v1/' }, signal)
    ).resolves.toEqual(['llama3.2'])
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:11434/api/tags')
  })

  it('still rejects on a 401 instead of quietly falling through', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'bad key' } }, 401))

    await expect(
      openaiAdapter.listModels({ baseUrl: 'https://api.example.test/v1', apiKey: 'sk-bad' }, signal)
    ).rejects.toThrow(/api key/i)
    // One call, not two: a refusal is a refusal, not an empty result to retry.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('resolves to an empty list when neither endpoint has models', async () => {
    stubFetch()
    route([
      ['/api/tags', () => jsonResponse({ models: [] })],
      ['/models', () => jsonResponse({ data: [] })]
    ])

    await expect(
      openaiAdapter.listModels({ baseUrl: 'http://localhost:11434/v1' }, signal)
    ).resolves.toEqual([])
  })
})

describe('anthropic model listing', () => {
  it('parses, sorts and dedupes data[].id', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          { id: 'claude-sonnet-4-5' },
          { id: 'claude-opus-4-1' },
          { id: 'claude-opus-4-1' },
          { id: 'claude-3-5-haiku-20241022' }
        ]
      })
    )

    await expect(
      anthropicAdapter.listModels({ baseUrl: 'https://api.example.test/v1', apiKey: 'k' }, signal)
    ).resolves.toEqual(['claude-3-5-haiku-20241022', 'claude-opus-4-1', 'claude-sonnet-4-5'])
  })

  it('rejects on a 401', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'invalid x-api-key' } }, 401))

    await expect(
      anthropicAdapter.listModels({ baseUrl: 'https://api.example.test/v1', apiKey: 'bad' }, signal)
    ).rejects.toThrow(/api key/i)
  })

  it('sends x-api-key and the version header', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }))

    await anthropicAdapter
      .listModels({ baseUrl: 'https://api.example.test/v1', apiKey: 'sk-ant' }, signal)
      .catch(() => undefined)

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers.authorization).toBeUndefined()
  })

  it('resolves to an empty list when the provider returns no data array', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ has_more: false }))

    await expect(
      anthropicAdapter.listModels({ baseUrl: 'https://api.example.test/v1', apiKey: 'k' }, signal)
    ).resolves.toEqual([])
  })
})

describe('gemini model listing', () => {
  it('strips the models/ prefix and sorts', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(
      jsonResponse({
        models: [
          { name: 'models/gemini-2.5-flash' },
          { name: 'models/gemini-2.5-pro' },
          { name: 'models/gemini-2.5-flash' },
          { name: 'models/gemini-1.5-flash' }
        ]
      })
    )

    await expect(
      geminiAdapter.listModels({ baseUrl: 'https://api.example.test/v1beta', apiKey: 'k' }, signal)
    ).resolves.toEqual(['gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'])
  })

  it('leaves an already-bare name alone', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ models: [{ name: 'gemini-2.5-flash' }] }))

    await expect(
      geminiAdapter.listModels({ baseUrl: 'https://api.example.test/v1beta', apiKey: 'k' }, signal)
    ).resolves.toEqual(['gemini-2.5-flash'])
  })

  it('ignores entries with no name rather than offering an empty id', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(
      jsonResponse({ models: [{ name: 'models/b' }, { displayName: 'x' }, null] })
    )

    await expect(
      geminiAdapter.listModels({ baseUrl: 'https://api.example.test/v1beta', apiKey: 'k' }, signal)
    ).resolves.toEqual(['b'])
  })

  it('rejects on a 401', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'API key not valid' } }, 401))

    await expect(
      geminiAdapter.listModels(
        { baseUrl: 'https://api.example.test/v1beta', apiKey: 'bad' },
        signal
      )
    ).rejects.toThrow(/api key/i)
  })

  it('sends x-goog-api-key rather than a bearer token', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ models: [] }))

    await geminiAdapter
      .listModels({ baseUrl: 'https://api.example.test/v1beta', apiKey: 'goog-key' }, signal)
      .catch(() => undefined)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.test/v1beta/models')
    const headers = init?.headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe('goog-key')
    expect(headers.authorization).toBeUndefined()
  })

  it('resolves to an empty list when there is no models array', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 404 } }))

    await expect(
      geminiAdapter.listModels({ baseUrl: 'https://api.example.test/v1beta', apiKey: 'k' }, signal)
    ).resolves.toEqual([])
  })
})

describe('preset registry', () => {
  it('offers the five supported providers', () => {
    expect(PRESETS.map((preset) => preset.id)).toEqual([
      'openai',
      'anthropic',
      'gemini',
      'ollama',
      'lmstudio'
    ])
  })

  it('defaults each provider to a real model', () => {
    const defaults = Object.fromEntries(PRESETS.map((p) => [p.id, p.defaultModel]))
    expect(defaults).toEqual({
      openai: 'gpt-4o-mini',
      anthropic: 'claude-sonnet-4-5',
      gemini: 'gemini-2.5-flash',
      ollama: 'llama3.2',
      lmstudio: 'local-model'
    })
  })

  it('marks only the local servers as keyless', () => {
    expect(PRESETS.filter((preset) => !preset.keyRequired).map((p) => p.id)).toEqual([
      'ollama',
      'lmstudio'
    ])
  })

  it('routes each preset to the adapter that speaks its wire format', () => {
    expect(adapterFor('openai')).toBe(ADAPTERS.openai)
    expect(adapterFor('anthropic')).toBe(ADAPTERS.anthropic)
    expect(adapterFor('gemini')).toBe(ADAPTERS.gemini)
    // Ollama and LM Studio are presets over the OpenAI adapter, not adapters.
    expect(adapterFor('ollama')).toBe(ADAPTERS.openai)
    expect(adapterFor('lmstudio')).toBe(ADAPTERS.openai)
  })

  it('returns null for an id nothing claims', () => {
    expect(adapterFor('llama-cpp')).toBeNull()
    expect(adapterFor('')).toBeNull()
  })

  it('has an adapter for every kind', () => {
    for (const preset of PRESETS) {
      expect(ADAPTERS[preset.kind].descriptor.kind).toBe(preset.kind)
    }
  })
})

describe('matchPresetByBaseUrl', () => {
  it('matches each preset on its default URL', () => {
    expect(matchPresetByBaseUrl('https://api.openai.com/v1')?.id).toBe('openai')
    expect(matchPresetByBaseUrl('https://api.anthropic.com/v1')?.id).toBe('anthropic')
    expect(matchPresetByBaseUrl('https://generativelanguage.googleapis.com/v1beta')?.id).toBe(
      'gemini'
    )
    expect(matchPresetByBaseUrl('http://localhost:11434/v1')?.id).toBe('ollama')
    expect(matchPresetByBaseUrl('http://localhost:1234/v1')?.id).toBe('lmstudio')
  })

  it('tolerates surrounding whitespace', () => {
    expect(matchPresetByBaseUrl('  https://api.openai.com/v1\n')?.id).toBe('openai')
  })

  it('tolerates trailing slashes, however many', () => {
    expect(matchPresetByBaseUrl('https://api.openai.com/v1/')?.id).toBe('openai')
    expect(matchPresetByBaseUrl('https://api.openai.com/v1///')?.id).toBe('openai')
  })

  it('tolerates a copied request URL that goes deeper', () => {
    expect(matchPresetByBaseUrl('https://api.openai.com/v1/chat/completions')?.id).toBe('openai')
  })

  it('ignores case in the host', () => {
    expect(matchPresetByBaseUrl('HTTPS://API.OPENAI.COM/v1')?.id).toBe('openai')
  })

  it('does not match a different provider that shares a host prefix', () => {
    // `/v1beta` starts with `/v1`, and a substring check would call this a match.
    expect(
      matchPresetByBaseUrl('https://generativelanguage.googleapis.com/v1beta-elsewhere')
    ).toBeNull()
    expect(matchPresetByBaseUrl('http://localhost:12345/v1')).toBeNull()
  })

  it('returns null for a proxy, a gateway or nonsense', () => {
    expect(matchPresetByBaseUrl('https://my-gateway.internal/openai/v1')).toBeNull()
    expect(matchPresetByBaseUrl('')).toBeNull()
    expect(matchPresetByBaseUrl('   ')).toBeNull()
    expect(matchPresetByBaseUrl('not a url')).toBeNull()
  })

  it('never throws, whatever it is handed', () => {
    for (const input of ['://///', 'http://', 'ftp://x/y', 'https://[bad', '%%%']) {
      expect(() => matchPresetByBaseUrl(input)).not.toThrow()
    }
  })
})
