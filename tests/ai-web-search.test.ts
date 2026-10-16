import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseSearchResults, searchWeb } from '../src/main/ai/web-search'

afterEach(() => vi.unstubAllGlobals())

const markup = `<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fcar&amp;rut=tracking">A <b>car</b> &amp; transport</a>
<a class="result__snippet">Cars move <b>people</b>.</a>`

describe('public web search', () => {
  it('decodes source URLs, strips markup, and keeps source snippets together', () => {
    expect(parseSearchResults(markup)).toEqual([
      { title: 'A car & transport', url: 'https://example.org/car', snippet: 'Cars move people.' }
    ])
  })

  it('rejects unsafe URLs, drops duplicates, and limits search context', () => {
    const unsafe = '<a class="result__a" href="javascript:alert(1)">bad</a>'
    const many = Array.from(
      { length: 20 },
      (_, i) =>
        `<a class="result__a" href="https://example.org/${i}">Title ${i}</a><span class="result__snippet">${'x'.repeat(1500)}</span>`
    ).join('')
    expect(parseSearchResults(unsafe)).toEqual([])
    expect(parseSearchResults(markup + markup)).toHaveLength(1)
    const results = parseSearchResults(many)
    expect(results).toHaveLength(6)
    expect(results[0].snippet).toHaveLength(1200)
  })

  it('sends only a query to the fixed search endpoint and does not fetch result pages', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(markup))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    expect(await searchWeb('car', controller.signal)).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    const url = fetch.mock.calls[0][0] as URL
    expect(url.origin).toBe('https://html.duckduckgo.com')
    expect(url.searchParams.get('q')).toBe('car')
  })

  it('reports challenge pages instead of pretending it found no sources', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<form id="challenge-form"></form>'))
    )
    await expect(searchWeb('car', new AbortController().signal)).rejects.toThrow('blocked')
  })

  it('reports HTTP failures and rejects excessive query or response sizes', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 429 }))
    )
    await expect(searchWeb('car', controller.signal)).rejects.toThrow('429')
    await expect(searchWeb('x'.repeat(301), controller.signal)).rejects.toThrow('300')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x'.repeat(512001)))
    )
    await expect(searchWeb('car', controller.signal)).rejects.toThrow('too large')
  })

  it('accepts a real no-results response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<div class="result--no-result">No results found</div>'))
    )
    expect(await searchWeb('a query', new AbortController().signal)).toEqual([])
  })
})
