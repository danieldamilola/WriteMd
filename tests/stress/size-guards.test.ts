import { describe, expect, it } from 'vitest'
import {
  renderCell,
  MAX_RENDERED_ROWS
} from '../../src/renderer/src/components/widgets/TableWidget'
import { MATCH_COUNT_LIMIT } from '../../src/renderer/src/components/FindPanel'

/**
 * The size guards added after the stress run. Each one replaces work that scaled
 * with the document (a parser call per cell, a full match walk) with something
 * bounded, and each has to stay honest about what it dropped.
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

describe('find match counting', () => {
  it('caps the tally so counting stays bounded', () => {
    expect(MATCH_COUNT_LIMIT).toBeGreaterThan(100)
    expect(MATCH_COUNT_LIMIT).toBeLessThanOrEqual(50_000)
  })
})
