import { net } from 'electron'

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

interface DuckTopic {
  Text?: string
  FirstURL?: string
  Topics?: DuckTopic[]
}

function flattenTopics(topics: DuckTopic[] | undefined, out: WebSearchResult[]): void {
  for (const t of topics ?? []) {
    if (t.Topics?.length) {
      flattenTopics(t.Topics, out)
      continue
    }
    if (t.FirstURL && t.Text) {
      const dash = t.Text.indexOf(' - ')
      out.push({
        title: dash > 0 ? t.Text.slice(0, dash) : t.Text.slice(0, 120),
        url: t.FirstURL,
        snippet: dash > 0 ? t.Text.slice(dash + 3) : t.Text
      })
    }
  }
}

/**
 * Keyless web search for grounding AI answers. Two layers, no key needed:
 *
 * 1. The HTML results page - real links + snippets for any query. Parsed
 *    with regexes (no DOM on the main side); tolerant of layout drift
 *    because every field has a fallback.
 * 2. The instant-answer API - factual blurbs for queries with a
 *    Wikipedia-style answer. Thin for fresh or long-tail topics, so it is
 *    the fallback, not the source (it used to be the only source, which is
 *    why most searches came back "no results").
 */
export async function webSearch(query: string, maxResults = 6): Promise<WebSearchResult[]> {
  const q = query.trim().slice(0, 400)
  if (!q) return []
  const limit = Math.max(1, Math.min(10, maxResults))
  try {
    const html = await duckHtmlSearch(q)
    if (html.length > 0) return html.slice(0, limit)
  } catch (e) {
    console.error('HTML web search failed, trying instant answers:', e)
  }
  return (await duckInstantSearch(q)).slice(0, limit)
}

/** Browser UA: the HTML endpoint serves bots a consent/empty page. */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function duckHtmlSearch(query: string): Promise<WebSearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await net.fetch(url, { headers: { 'User-Agent': BROWSER_UA } })
  if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`)
  return parseDuckHtml(await res.text())
}

/**
 * Links + snippets out of DuckDuckGo's HTML results. Result anchors look
 * like `<a rel="nofollow" class="result__a"
 * href="//duckduckgo.com/l/?uddg=<urlencoded-target>&amp;…">Title</a>` with
 * the snippet in a sibling `result__snippet` anchor. Pure for testing.
 */
export function parseDuckHtml(html: string): WebSearchResult[] {
  const out: WebSearchResult[] = []
  const anchorRe =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>|<a[^>]*href="([^"]+)"[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/gi
  const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a\s*>/i
  for (const m of html.matchAll(anchorRe)) {
    const href = m[1] ?? m[3] ?? ''
    const title = cleanText(m[2] ?? m[4] ?? '')
    const url = unwrapDuckHref(href)
    if (!url || !title) continue
    // The snippet anchor follows its result anchor in document order.
    const rest = html.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 4000)
    const snippet = cleanText(snippetRe.exec(rest)?.[1] ?? '')
    out.push({ title, url, snippet })
    if (out.length >= 10) break
  }
  return out
}

/** `//duckduckgo.com/l/?uddg=<target>&…` → the target; direct URLs pass through. */
function unwrapDuckHref(href: string): string | null {
  const unescaped = href.replace(/&amp;/g, '&')
  const uddg = /[?&]uddg=([^&]+)/.exec(unescaped)?.[1]
  if (uddg) {
    try {
      const url = decodeURIComponent(uddg)
      if (/^https?:\/\//i.test(url)) return url
    } catch {
      return null
    }
  }
  if (/^https?:\/\//i.test(unescaped)) return unescaped
  return null
}

function cleanText(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
}

async function duckInstantSearch(query: string): Promise<WebSearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
  const res = await net.fetch(url, { headers: { 'User-Agent': 'WriteMd/1.0' } })
  if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`)
  const data = (await res.json()) as {
    AbstractText?: string
    AbstractSource?: string
    AbstractURL?: string
    RelatedTopics?: DuckTopic[]
    Results?: DuckTopic[]
  }
  const out: WebSearchResult[] = []
  if (data.AbstractText && data.AbstractURL) {
    out.push({
      title: data.AbstractSource || 'Summary',
      url: data.AbstractURL,
      snippet: data.AbstractText
    })
  }
  flattenTopics(data.Results, out)
  flattenTopics(data.RelatedTopics, out)
  return out
}

/** Render results as context the model can cite, with URLs intact. */
export function formatSearchContext(query: string, results: WebSearchResult[]): string {
  if (results.length === 0) {
    return `[Web search for "${query}" returned no results. Say so if asked about current info.]`
  }
  const lines = results.map((r, i) => `${i + 1}. ${r.title} - ${r.snippet}\n   Source: ${r.url}`)
  // The no-meta-talk rule also lives in the default system prompt; repeating
  // it here keeps weaker models honest on the turn that carries results.
  return [
    `[Live web results for "${query}", fetched by WriteMd just now:`,
    ...lines,
    'Answer from these results and cite sources with links.]'
  ].join('\n')
}
