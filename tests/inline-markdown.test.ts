import { describe, it, expect } from 'vitest'
import { renderInlineMarkdown } from '../src/renderer/src/components/widgets/TableWidget'

/**
 * Table cells come from a file on disk and are assigned to innerHTML, so the
 * cell renderer is a trust boundary. These cases are the payloads that made
 * the previous hand-rolled regex parser unsafe.
 */
describe('table cell inline markdown', () => {
  it('escapes raw HTML instead of emitting it live', () => {
    const out = renderInlineMarkdown(
      "<img src=x onerror=\"window.electronAPI.file.write('C:/pwn.js','x')\">"
    )
    // The tag itself is inert text. `onerror=` survives as visible characters,
    // which is correct: escaping means no element is created, not that the
    // words disappear.
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
    expect(out).toContain('onerror=')
  })

  it('escapes a script tag', () => {
    const out = renderInlineMarkdown('<script>window.electronAPI.settings.set({})</script>')
    expect(out).not.toContain('<script')
    expect(out).toContain('&lt;script')
  })

  it('escapes an injected iframe', () => {
    const out = renderInlineMarkdown('<iframe src="https://evil.test"></iframe>')
    expect(out).not.toContain('<iframe')
  })

  it('escapes a form, since form-action is not covered by the CSP', () => {
    const out = renderInlineMarkdown('<form action="https://evil.test"><input name="x"></form>')
    expect(out).not.toContain('<form')
    expect(out).not.toContain('<input')
  })

  it('still renders the inline formatting it is supposed to', () => {
    expect(renderInlineMarkdown('**bold**')).toContain('<strong>bold</strong>')
    expect(renderInlineMarkdown('*em*')).toContain('<em>em</em>')
    // markdown-it emits <s> for strikethrough, not <del>.
    expect(renderInlineMarkdown('~~gone~~')).toContain('<s>gone</s>')
    expect(renderInlineMarkdown('`code`')).toContain('<code>code</code>')
  })

  it('renders a markdown link as a real anchor', () => {
    const out = renderInlineMarkdown('[docs](https://example.com)')
    expect(out).toContain('href="https://example.com"')
  })

  it('does not emit a javascript: href', () => {
    // markdown-it's own validateLink drops the dangerous scheme, so the cell
    // renders as text instead of a live link.
    const out = renderInlineMarkdown('[click](javascript:alert(1))')
    expect(out).not.toContain('href="javascript:')
  })

  it('leaves plain text untouched', () => {
    expect(renderInlineMarkdown('just words')).toBe('just words')
  })

  it('escapes angle brackets that arrive without a full tag', () => {
    const out = renderInlineMarkdown('5 < 7 and 9 > 3')
    expect(out).not.toContain('<')
    expect(out).toContain('&lt;')
  })
})
