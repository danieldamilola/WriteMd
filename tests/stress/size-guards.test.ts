import { describe, expect, it } from 'vitest'
import { renderCell, MAX_RENDERED_ROWS } from '../../src/renderer/src/components/widgets/TableWidget'
import { documentContextFor, AI_DOC_CONTEXT_LIMIT } from '../../src/renderer/src/components/Editor'
import { MATCH_COUNT_LIMIT } from '../../src/renderer/src/components/FindPanel'

/**
 * The size guards added after the stress run. Each one replaces work that scaled
 * with the document (a parser call per cell, a whole-file AI payload, a full
 * match walk) with something bounded, and each has to stay honest about what it
 * dropped.
 */
describe('table cell rendering', () => {
  it('renders plain text without invoking the markdown parser', () => {
    // Plain text has to come out escaped exactly as markdown-it would.
    expect(renderCell('plain words')).toBe('plain words')
    expect(renderCell('a < b & c')).toBe('a &lt; b &amp; c')
    expect(renderCell('  padded  ')).toBe('  padded  ')
  })

  it('still renders inline markdown when there is any', () => {
    expect(renderCell('**bold**')).toBe('<strong>bold</strong>')
    expect(renderCell('`code`')).toBe('<code>code</code>')
    expect(renderCell('[link](https://example.com)')).toContain('href')
  })

  it('caps rendered rows at a size that cannot stall the first paint', () => {
    expect(MAX_RENDERED_ROWS).toBeGreaterThan(50)
    // 400 rows of 8 cells is 3200 nodes; the whole-table build was 32 000.
    expect(MAX_RENDERED_ROWS * 8).toBeLessThanOrEqual(4000)
  })
})

describe('ai document context', () => {
  it('passes a small file through untouched', () => {
    const text = '# Small note\n\nA few words.'
    const ctx = documentContextFor(text)
    expect(ctx.text).toBe(text)
    expect(ctx.note).toBe('')
  })

  it('caps a huge file and says the file was cut', () => {
    const ctx = documentContextFor('x'.repeat(AI_DOC_CONTEXT_LIMIT + 5000))
    expect(ctx.text).toHaveLength(AI_DOC_CONTEXT_LIMIT)
    expect(ctx.note).toContain('Only the first')
    expect(ctx.note).toContain('KB of this')
  })

  it('does not slice at a surrogate boundary', () => {
    // A cut in the middle of an emoji would leave a lone surrogate in the
    // prompt, which is invalid UTF-16 and can get a request rejected whole.
    const text = '\u{1F600}'.repeat(AI_DOC_CONTEXT_LIMIT)
    const ctx = documentContextFor(text)
    expect(ctx.text.length).toBeLessThanOrEqual(AI_DOC_CONTEXT_LIMIT)
    const last = ctx.text.charCodeAt(ctx.text.length - 1)
    if (last >= 0xd800 && last <= 0xdfff) {
      // A surrogate at the end is only valid as the tail of a complete pair.
      const prev = ctx.text.charCodeAt(ctx.text.length - 2)
      expect(prev >= 0xd800 && prev <= 0xdbff).toBe(true)
    }
  })

  it('drops the split pair when the limit lands mid-emoji', () => {
    // Odd limit boundary: an emoji starting exactly at the cut is excluded.
    const text = 'a'.repeat(AI_DOC_CONTEXT_LIMIT - 1) + '\u{1F600}'.repeat(10)
    const ctx = documentContextFor(text)
    const last = ctx.text.charCodeAt(ctx.text.length - 1)
    expect(last).toBe('a'.charCodeAt(0))
  })

  it('keeps the cap small enough for a provider request', () => {
    expect(AI_DOC_CONTEXT_LIMIT).toBeLessThanOrEqual(500_000)
  })
})

describe('find match counting', () => {
  it('caps the tally so counting stays bounded', () => {
    expect(MATCH_COUNT_LIMIT).toBeGreaterThan(100)
    expect(MATCH_COUNT_LIMIT).toBeLessThanOrEqual(50_000)
  })
})