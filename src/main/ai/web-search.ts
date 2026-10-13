import { Parser } from 'htmlparser2'
import type { ToolSpec } from '../../shared/ai/types'

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

export const WEB_SEARCH_TOOL: ToolSpec = {
  name: 'web_search',
  description:
    'Search the public web for current information. Results contain source URLs and short snippets, not full pages. Use a concise query without private note contents or credentials.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'A short public web search query.' } },
    required: ['query']
  }
}

function sourceUrl(href: string): string | null {
  try {
    const link = new URL(href, 'https://duckduckgo.com')
    const destination = link.hostname === 'duckduckgo.com' ? link.searchParams.get('uddg') : null
    const url = destination ? new URL(destination) : link
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    if (/^(localhost|127\.|0\.|\[|10\.|192\.168\.)/i.test(url.hostname)) return null
    return url.href
  } catch {
    return null
  }
}

/** Parse static search markup as data; no scripts, cookies, images, or result pages run. */
export function parseSearchResults(markup: string): WebSearchResult[] {
  const results: WebSearchResult[] = []
  let current: WebSearchResult | null = null
  let capture: 'title' | 'snippet' | null = null
  let depth = 0
  let captureDepth = 0
  const parser = new Parser({
    onopentag(_tag, attributes) {
      depth++
      const classes = (attributes.class ?? '').split(/\s+/)
      if (classes.includes('result__a')) {
        const url = sourceUrl(attributes.href ?? '')
        current = url && results.length < 6 ? { title: '', url, snippet: '' } : null
        if (current) results.push(current)
        capture = 'title'
        captureDepth = depth
      } else if (classes.includes('result__snippet')) {
        capture = 'snippet'
        captureDepth = depth
      }
    },
    ontext(value) {
      if (capture && current) current[capture] += value
    },
    onclosetag() {
      if (depth === captureDepth) capture = null
      depth--
    }
  })
  parser.end(markup)
  const seen = new Set<string>()
  return results.filter((result) => {
    result.title = result.title.replace(/\s+/g, ' ').trim().slice(0, 240)
    result.snippet = result.snippet.replace(/\s+/g, ' ').trim().slice(0, 1200)
    if (!result.title || seen.has(result.url)) return false
    seen.add(result.url)
    return true
  })
}

/** Search queries go to DuckDuckGo; model-supplied URLs are never fetched. */
export async function searchWeb(query: string, signal: AbortSignal): Promise<WebSearchResult[]> {
  if (!query.trim() || query.length > 300)
    throw new Error('Use a search query between 1 and 300 characters.')
  const url = new URL('https://html.duckduckgo.com/html/')
  url.searchParams.set('q', query.trim())
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    redirect: 'error',
    headers: { Accept: 'text/html', 'User-Agent': 'WriteMd/1.0 (web search)' }
  })
  if (!response.ok)
    throw new Error(`Web search is unavailable (${response.status}). Try again later.`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Web search returned no response.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 512000) throw new Error('The web search response was too large.')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const markup = Buffer.concat(chunks).toString('utf-8')
  if (/anomaly-modal|challenge-form/i.test(markup))
    throw new Error('Web search was blocked by the search service. Try again later.')
  const results = parseSearchResults(markup)
  if (!results.length && !/result--no-result|No results found/i.test(markup)) {
    throw new Error('The search service did not return readable results. Try again later.')
  }
  return results
}
