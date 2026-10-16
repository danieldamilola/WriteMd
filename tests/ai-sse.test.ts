import { describe, it, expect } from 'vitest'
import { createSseFramer, joinUrl } from '../src/main/ai/sse'

/**
 * The framer is fed byte-at-a-time in the worst cases on purpose.
 *
 * A framing bug here does not throw. It drops the last event of a stream, so
 * the turn ends with no `done`, and the transcript stops mid-sentence with
 * nothing in the log to explain why. Feeding whole strings would pass against
 * an implementation that is broken at exactly the boundary that matters.
 */

function collect(chunks: string[]): string[] {
  const framer = createSseFramer()
  const out: string[] = []
  for (const chunk of chunks) out.push(...framer.push(chunk))
  out.push(...framer.end())
  return out
}

/** Split a string into `size`-character pieces, to force awkward boundaries. */
function slice(text: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}

describe('SSE framing', () => {
  it('emits one payload per blank-line-terminated event', () => {
    expect(collect(['data: a\n\ndata: b\n\n'])).toEqual(['a', 'b'])
  })

  it('joins multi-line data payloads with newlines', () => {
    // JSON is commonly pretty-printed across several data: lines.
    expect(collect(['data: {"a":\ndata:  1}\n\n'])).toEqual(['{"a":\n 1}'])
  })

  it('strips exactly one space after the colon', () => {
    expect(collect(['data:  padded\n\n'])).toEqual([' padded'])
  })

  it('ignores comment lines', () => {
    // OpenAI sends `: OPENROUTER PROCESSING` heartbeats on long requests.
    expect(collect([': keep-alive\ndata: real\n\n'])).toEqual(['real'])
  })

  it('ignores event, id and retry fields', () => {
    expect(collect(['event: ping\nid: 7\nretry: 100\ndata: real\n\n'])).toEqual(['real'])
  })

  it('drops the [DONE] sentinel', () => {
    // Handing a sentinel to the adapter as a payload produces a JSON parse
    // error on a stream that actually completed successfully.
    expect(collect(['data: a\n\ndata: [DONE]\n\n'])).toEqual(['a'])
  })

  it('handles CRLF terminators as one break', () => {
    expect(collect(['data: a\r\n\r\ndata: b\r\n\r\n'])).toEqual(['a', 'b'])
  })

  it('keeps multiline events intact when a chunk ends between CR and LF', () => {
    const stream = 'data: {"a":\r\ndata: 1}\r\n\r\n'
    for (const size of [1, 2, 3, 5]) {
      expect(collect(slice(stream, size))).toEqual(['{"a":\n1}'])
    }
  })

  it('flushes a final data line with no line terminator', () => {
    expect(collect(['data: a\n\ndata: b'])).toEqual(['a', 'b'])
  })

  it('can retain the completion sentinel for adapters that check completion', () => {
    const framer = createSseFramer({ includeDone: true })
    expect(framer.push('data: [DONE]\n\n')).toEqual(['[DONE]'])
  })

  it('handles a lone CR terminator', () => {
    expect(collect(['data: a\r\rdata: b\r\r'])).toEqual(['a', 'b'])
  })

  it('reassembles an event split across chunks', () => {
    expect(collect(['data: {"ch', 'oices":[{"id":', '"1"}]}\n', '\n'])).toEqual([
      '{"choices":[{"id":"1"}]}'
    ])
  })

  it('produces identical output at every chunk size', () => {
    const stream =
      'data: {"n":1}\n\n: heartbeat\n\ndata: {"n":2}\n\ndata: [DONE]\n\ndata: {"n":3}\n\n'
    const expected = ['{"n":1}', '{"n":2}', '{"n":3}']
    for (const size of [1, 2, 3, 5, 7, 11, 13, 64, 4096]) {
      expect(collect(slice(stream, size)), `chunk size ${size}`).toEqual(expected)
    }
  })

  it('emits a trailing payload that never got its blank line', () => {
    // A stream closed right after the last event must not lose it.
    expect(collect(['data: a\n\ndata: b\n'])).toEqual(['a', 'b'])
  })

  it('emits nothing for a stream that carried only heartbeats', () => {
    expect(collect([': a\n\n: b\n\n'])).toEqual([])
  })

  it('emits nothing for an empty stream', () => {
    expect(collect([])).toEqual([])
  })

  it('does not treat a blank line with no data as an event', () => {
    expect(collect(['\n\n\n\ndata: a\n\n'])).toEqual(['a'])
  })

  it('handles an event field carrying no data line', () => {
    expect(collect(['event: done\n\ndata: a\n\n'])).toEqual(['a'])
  })
})

describe('joinUrl', () => {
  it('joins without doubling the separator', () => {
    expect(joinUrl('https://api.openai.com/v1', '/chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions'
    )
  })

  it('tolerates a trailing slash on the base', () => {
    expect(joinUrl('https://api.openai.com/v1/', '/chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions'
    )
  })

  it('tolerates a missing leading slash on the path', () => {
    expect(joinUrl('https://api.openai.com/v1', 'chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions'
    )
  })

  it('keeps a base URL that is only a host', () => {
    expect(joinUrl('http://localhost:11434', '/v1/chat/completions')).toBe(
      'http://localhost:11434/v1/chat/completions'
    )
  })
})
