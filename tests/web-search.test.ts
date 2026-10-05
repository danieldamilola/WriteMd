import { describe, expect, it } from 'vitest'
import { formatSearchContext, parseDuckHtml } from '../src/main/web-search'

// Markup modeled on a real html.duckduckgo.com response: redirect hrefs,
// <b> highlighting, and &#x27; entities.
const FIXTURE = `
<div class="result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fopencode.ai%2Fdocs%2Fcli%2F&amp;rut=abc123">CLI | OpenCode</a>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fopencode.ai%2Fdocs%2Fcli%2F&amp;rut=abc123"><b>OpenCode</b> <b>CLI</b> options. If you&#x27;re stuck, read on.</a>
</div>
<div class="result">
  <a rel="nofollow" class="result__a" href="https://example.com/direct">Direct Link</a>
  <a class="result__snippet" href="https://example.com/direct">A direct URL with no snippet markup.</a>
</div>
<div class="result">
  <a rel="nofollow" class="result__a" href="/internal/nope">No target</a>
</div>
`

describe('parseDuckHtml', () => {
  it('extracts titles, decoded URLs, and clean snippets', () => {
    const results = parseDuckHtml(FIXTURE)
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      title: 'CLI | OpenCode',
      url: 'https://opencode.ai/docs/cli/',
      snippet: "OpenCode CLI options. If you're stuck, read on."
    })
    expect(results[1]).toEqual({
      title: 'Direct Link',
      url: 'https://example.com/direct',
      snippet: 'A direct URL with no snippet markup.'
    })
  })

  it('returns nothing for a consent/empty page', () => {
    expect(parseDuckHtml('<html><body>anomaly</body></html>')).toEqual([])
  })
})

describe('formatSearchContext', () => {
  it('renders citable sources', () => {
    const out = formatSearchContext('q', [{ title: 'T', url: 'https://example.com', snippet: 'S' }])
    expect(out).toContain('https://example.com')
    expect(out).toContain('1. T - S')
  })

  it('says so when empty', () => {
    expect(formatSearchContext('q', [])).toContain('no results')
  })
})
