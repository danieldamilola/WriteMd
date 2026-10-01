import { describe, it, expect } from 'vitest'
import {
  createChatMarkdownIt,
  createDocumentMarkdownIt,
  createMarkdownIt
} from '../src/renderer/src/utils/markdown'

/**
 * Every markdown-it instance in the app renders untrusted text into either
 * `innerHTML` or Lit's `unsafeHTML`. `html: false` is the only thing standing
 * between a note containing `<img onerror=...>` and script execution, so it is
 * asserted here rather than left to a code review.
 */
describe('markdown configuration', () => {
  const factories = [
    ['createMarkdownIt', () => createMarkdownIt()],
    ['createChatMarkdownIt', () => createChatMarkdownIt()],
    ['createDocumentMarkdownIt', () => createDocumentMarkdownIt()],
    [
      'createDocumentMarkdownIt with typographer',
      () => createDocumentMarkdownIt({ typographer: true })
    ]
  ] as const

  it.each(factories)('%s disables raw HTML', (_name, make) => {
    const html = make().render('<img src=x onerror="alert(1)">')
    // The tag is escaped, so the markup survives only as text. Checking for the
    // bare substring `onerror` would be wrong: it legitimately appears inside
    // the escaped text.
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
    expect(html).toContain('onerror')
  })

  it('neutralizes a script tag', () => {
    for (const [, make] of factories) {
      const html = make().render('<script>alert(1)</script>')
      expect(html).not.toContain('<script')
      expect(html).toContain('&lt;script')
    }
  })

  it('keeps linkify on so bare urls become links', () => {
    for (const [, make] of factories) {
      expect(make().render('see https://example.com')).toContain('<a href="https://example.com"')
    }
  })

  it('only the chat factory treats a single newline as a break', () => {
    const source = 'line one\nline two'
    expect(createChatMarkdownIt().render(source)).toContain('<br>')
    expect(createDocumentMarkdownIt().render(source)).not.toContain('<br>')
    expect(createMarkdownIt().render(source)).not.toContain('<br>')
  })

  it('only the typographer rewrites quotes and dashes', () => {
    expect(createDocumentMarkdownIt({ typographer: true }).render('"quoted"')).toContain('“quoted”')
    expect(createDocumentMarkdownIt().render('"quoted"')).not.toContain('“')
  })
})
