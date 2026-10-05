import { describe, it, expect } from 'vitest'
import {
  escapeCellPipes,
  isPlainCellSource,
  renderCell,
  unescapeCellPipes
} from '../src/renderer/src/components/widgets/TableWidget'

/**
 * Table cells come from a file on disk and are assigned to innerHTML, so the
 * cell renderer is a trust boundary. These cases are the payloads that made
 * the previous hand-rolled regex parser unsafe.
 *
 * They run against `renderCell`, which is what the widget actually calls, so the
 * escaped-text fast path is covered alongside the markdown-it path.
 */
describe('table cell inline markdown', () => {
  it('escapes raw HTML instead of emitting it live', () => {
    const out = renderCell("<img src=x onerror=\"window.electronAPI.file.write('C:/pwn.js','x')\">")
    // The tag itself is inert text. `onerror=` survives as visible characters,
    // which is correct: escaping means no element is created, not that the
    // words disappear.
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
    expect(out).toContain('onerror=')
  })

  it('escapes a script tag', () => {
    const out = renderCell('<script>window.electronAPI.settings.set({})</script>')
    expect(out).not.toContain('<script')
    expect(out).toContain('&lt;script')
  })

  it('escapes an injected iframe', () => {
    const out = renderCell('<iframe src="https://evil.test"></iframe>')
    expect(out).not.toContain('<iframe')
  })

  it('escapes a form, since form-action is not covered by the CSP', () => {
    const out = renderCell('<form action="https://evil.test"><input name="x"></form>')
    expect(out).not.toContain('<form')
    expect(out).not.toContain('<input')
  })

  it('still renders the inline formatting it is supposed to', () => {
    expect(renderCell('**bold**')).toContain('<strong>bold</strong>')
    expect(renderCell('*em*')).toContain('<em>em</em>')
    // markdown-it emits <s> for strikethrough, not <del>.
    expect(renderCell('~~gone~~')).toContain('<s>gone</s>')
    expect(renderCell('`code`')).toContain('<code>code</code>')
  })

  it('renders a markdown link as a real anchor', () => {
    const out = renderCell('[docs](https://example.com)')
    expect(out).toContain('href="https://example.com"')
  })

  it('does not emit a javascript: href', () => {
    // markdown-it's own validateLink drops the dangerous scheme, so the cell
    // renders as text instead of a live link.
    const out = renderCell('[click](javascript:alert(1))')
    expect(out).not.toContain('href="javascript:')
  })

  it('leaves plain text untouched', () => {
    expect(renderCell('just words')).toBe('just words')
  })

  it('escapes angle brackets that arrive without a full tag', () => {
    const out = renderCell('5 < 7 and 9 > 3')
    expect(out).not.toContain('<')
    expect(out).toContain('&lt;')
  })

  it('still linkifies a bare URL, which the fast path used to drop', () => {
    // `linkify` is on, so this cell draws as an anchor. Without the URL in the
    // fast-path hint it fell through to escaped text and stopped being a link.
    const out = renderCell('https://example.com')
    expect(out).toContain('<a href="https://example.com">')
  })

  it('linkifies a mailto: address', () => {
    const out = renderCell('mailto:a@b.test')
    expect(out).toContain('href="mailto:a@b.test"')
  })

  it('shows an escaped pipe as a plain pipe, not as its backslash', () => {
    expect(renderCell('a \\| b')).toBe('a | b')
  })

  it('leaves a bare www host as text, which is what markdown-it does with it', () => {
    // Not a link upstream, so it must not become one here either.
    expect(renderCell('www.example.com')).toBe('www.example.com')
  })
})

/**
 * A cell is only safe to edit in place when what it displays is its own source.
 * Anything else renders as HTML, and writing that back flattens the markup.
 */
describe('isPlainCellSource', () => {
  it('accepts plain words, so the common cell stays editable', () => {
    expect(isPlainCellSource('just words')).toBe(true)
  })

  it('accepts text whose only special character round-trips through escaping', () => {
    // `&` is escaped on the way to HTML and decoded back by innerText, so the
    // cell still is its own text.
    expect(isPlainCellSource('R&D')).toBe(true)
  })

  it('accepts an escaped pipe, since it displays as a literal pipe', () => {
    expect(isPlainCellSource('a \\| b')).toBe(true)
  })

  it('rejects emphasis, whose asterisks would be written away', () => {
    expect(isPlainCellSource('**bold**')).toBe(false)
  })

  it('rejects a link, which would lose its URL', () => {
    expect(isPlainCellSource('[docs](https://example.com)')).toBe(false)
  })

  it('rejects inline code and strikethrough', () => {
    expect(isPlainCellSource('`code`')).toBe(false)
    expect(isPlainCellSource('~~gone~~')).toBe(false)
  })

  it('rejects a bare URL, which is drawn as an anchor', () => {
    expect(isPlainCellSource('https://example.com')).toBe(false)
  })
})

describe('cell pipe escaping', () => {
  it('escapes a bare pipe so it cannot add a column', () => {
    expect(escapeCellPipes('a|b')).toBe('a\\|b')
  })

  it('leaves an already escaped pipe alone rather than doubling it', () => {
    expect(escapeCellPipes('a \\| b')).toBe('a \\| b')
  })

  it('treats an escaped backslash as not escaping the pipe after it', () => {
    // `\\` is a literal backslash, so this pipe is a real column break.
    expect(escapeCellPipes('a \\\\| b')).toBe('a \\\\\\| b')
  })

  it('round-trips through the unescape used to decide what a cell displays', () => {
    expect(unescapeCellPipes(escapeCellPipes('a|b'))).toBe('a|b')
    expect(unescapeCellPipes(escapeCellPipes('a \\| b'))).toBe('a | b')
  })
})
