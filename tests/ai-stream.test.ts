import { describe, it, expect } from 'vitest'
import { AI_PROVIDERS, AiResponseError } from '../src/shared/ai-providers'
import { SseParser } from '../src/main/sse'

const openai = AI_PROVIDERS.OpenAI

describe('SseParser', () => {
  it('reads a complete frame', () => {
    const parser = new SseParser()
    expect(parser.feed('data: {"a":1}\n\n')).toEqual([{ a: 1 }])
  })

  it('holds an incomplete frame until its blank line arrives', () => {
    const parser = new SseParser()
    // A chunk boundary can land anywhere, including mid-JSON and mid-blank-line.
    expect(parser.feed('data: {"a"')).toEqual([])
    expect(parser.feed(':1}\n')).toEqual([])
    // The second newline completes the frame.
    expect(parser.feed('\n')).toEqual([{ a: 1 }])
  })

  it('reads several frames out of one chunk', () => {
    const parser = new SseParser()
    expect(parser.feed('data: {"a":1}\n\ndata: {"a":2}\n\n')).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('normalizes CRLF line endings', () => {
    const parser = new SseParser()
    expect(parser.feed('data: {"a":1}\r\n\r\n')).toEqual([{ a: 1 }])
  })

  it('drops the terminator and comment lines', () => {
    const parser = new SseParser()
    expect(parser.feed(': keep-alive\n\ndata: {"a":1}\n\ndata: [DONE]\n\n')).toEqual([{ a: 1 }])
  })

  it('skips a frame whose payload is not JSON', () => {
    const parser = new SseParser()
    expect(parser.feed('data: not json\n\ndata: {"a":1}\n\n')).toEqual([{ a: 1 }])
  })

  it('flushes a trailing frame that had no blank line', () => {
    const parser = new SseParser()
    expect(parser.feed('data: {"a":1}\n')).toEqual([])
    expect(parser.flush()).toEqual([{ a: 1 }])
    expect(parser.flush()).toEqual([])
  })

  it('ignores event and id fields', () => {
    const parser = new SseParser()
    expect(parser.feed('event: message\nid: 7\ndata: {"a":1}\n\n')).toEqual([{ a: 1 }])
  })
})

describe('streaming requests', () => {
  it('asks OpenAI-shaped providers for a stream', () => {
    const req = openai.buildStreamRequest({
      model: 'gpt-4o-mini',
      apiKey: 'sk-key',
      messages: [{ role: 'user', content: 'hi' }]
    })
    expect(req?.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(req?.headers.Authorization).toBe('Bearer sk-key')
    expect((req?.body as { stream?: boolean }).stream).toBe(true)
  })

  it('keeps the system prompt and messages intact when adding stream', () => {
    const body = openai.buildStreamRequest({
      model: 'm',
      apiKey: 'k',
      messages: [{ role: 'user', content: 'hi' }],
      systemPrompt: 'be brief'
    })?.body as { messages: { role: string; content: string }[] }
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be brief' })
  })

  it('switches Gemini to its SSE endpoint', () => {
    const req = AI_PROVIDERS.GoogleGemini.buildStreamRequest({
      model: 'gemini-2.0-flash',
      apiKey: 'k',
      messages: [{ role: 'user', content: 'hi' }]
    })
    expect(req?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse'
    )
    expect(req?.headers['x-goog-api-key']).toBe('k')
  })

  it('turns on stream for Anthropic', () => {
    const body = AI_PROVIDERS.Anthropic.buildStreamRequest({
      model: 'claude-3-5-sonnet-20240620',
      apiKey: 'k',
      messages: [{ role: 'user', content: 'hi' }]
    })?.body as { stream?: boolean }
    expect(body.stream).toBe(true)
  })

  it('sends no auth header to a local Ollama', () => {
    const req = AI_PROVIDERS.Ollama.buildStreamRequest({
      model: 'llama3',
      apiKey: '',
      messages: [{ role: 'user', content: 'hi' }]
    })
    expect(req?.url).toBe('http://localhost:11434/v1/chat/completions')
    expect(req?.headers.Authorization).toBeUndefined()
  })
})

describe('stream chunk extraction', () => {
  it('reads the delta text from an OpenAI frame', () => {
    expect(openai.extractStreamChunk({ choices: [{ delta: { content: 'Hel' } }] })).toBe('Hel')
  })

  it('joins typed content parts', () => {
    expect(
      openai.extractStreamChunk({
        choices: [
          {
            delta: {
              content: [
                { type: 'text', text: 'a' },
                { type: 'text', text: 'b' }
              ]
            }
          }
        ]
      })
    ).toBe('ab')
  })

  it('returns empty text for a role-only or final frame', () => {
    expect(openai.extractStreamChunk({ choices: [{ delta: { role: 'assistant' } }] })).toBe('')
    expect(openai.extractStreamChunk({ choices: [{ delta: {}, finish_reason: 'stop' }] })).toBe('')
    expect(openai.extractStreamChunk({})).toBe('')
  })

  it('surfaces a mid-stream provider error', () => {
    expect(() =>
      openai.extractStreamChunk({ error: { message: 'rate limited', code: 429 } })
    ).toThrow(AiResponseError)
  })

  it('reads Gemini candidate text', () => {
    expect(
      AI_PROVIDERS.GoogleGemini.extractStreamChunk({
        candidates: [{ content: { parts: [{ text: 'Hi' }] } }]
      })
    ).toBe('Hi')
  })

  it('returns empty text for a Gemini frame with no candidates', () => {
    expect(AI_PROVIDERS.GoogleGemini.extractStreamChunk({})).toBe('')
  })

  it('reads only Anthropic text deltas', () => {
    const anthropic = AI_PROVIDERS.Anthropic
    expect(
      anthropic.extractStreamChunk({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hi' }
      })
    ).toBe('Hi')
    expect(anthropic.extractStreamChunk({ type: 'message_start' })).toBe('')
    expect(anthropic.extractStreamChunk({ type: 'ping' })).toBe('')
    expect(
      anthropic.extractStreamChunk({
        type: 'content_block_delta',
        delta: { type: 'input_json_delta' }
      })
    ).toBe('')
  })

  it('surfaces an Anthropic stream error frame', () => {
    expect(() =>
      AI_PROVIDERS.Anthropic.extractStreamChunk({
        type: 'error',
        error: { message: 'overloaded' }
      })
    ).toThrow(/overloaded/)
  })

  it('assembles a whole answer from a real OpenAI stream', () => {
    const parser = new SseParser()
    const wire = [
      'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}',
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]'
    ].join('\n\n')
    let text = ''
    for (const frame of parser.feed(wire)) text += openai.extractStreamChunk(frame)
    expect(text).toBe('Hello')
  })

  it('isolates multi-session stream cancellation', () => {
    const activeStreams = new Map<string, AbortController>()
    const cancelChat = (senderId: number, sessionId?: string): void => {
      if (sessionId) {
        const key = `${senderId}:${sessionId}`
        activeStreams.get(key)?.abort()
        activeStreams.delete(key)
      } else {
        const prefix = `${senderId}:`
        for (const [key, controller] of activeStreams.entries()) {
          if (key === `${senderId}` || key.startsWith(prefix)) {
            controller.abort()
            activeStreams.delete(key)
          }
        }
      }
    }

    const c1 = new AbortController()
    const c2 = new AbortController()
    activeStreams.set('1:session-a', c1)
    activeStreams.set('1:session-b', c2)

    cancelChat(1, 'session-a')
    expect(c1.signal.aborted).toBe(true)
    expect(c2.signal.aborted).toBe(false)
    expect(activeStreams.has('1:session-a')).toBe(false)
    expect(activeStreams.has('1:session-b')).toBe(true)

    cancelChat(1)
    expect(c2.signal.aborted).toBe(true)
    expect(activeStreams.size).toBe(0)
  })
})
