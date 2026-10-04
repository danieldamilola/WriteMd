import { describe, it, expect } from 'vitest'
import { TableWidget, cellSourceRange } from '../src/renderer/src/components/widgets/TableWidget'

/**
 * Clicking a table cell in live preview must edit that cell in place, not
 * dump the table to source. The editor maps a clicked cell back to its source
 * range with the same split semantics the preview was drawn from.
 */
describe('cellSourceRange', () => {
  it('maps cells of a plain row to their raw segments', () => {
    expect(cellSourceRange('| a | b |', 0)).toEqual({ start: 1, end: 4 })
    expect(cellSourceRange('| a | b |', 1)).toEqual({ start: 5, end: 8 })
  })

  it('handles missing outer pipes', () => {
    expect(cellSourceRange('a | b', 0)).toEqual({ start: 0, end: 2 })
    expect(cellSourceRange('a | b', 1)).toEqual({ start: 3, end: 5 })
  })

  it('counts leading whitespace in offsets', () => {
    expect(cellSourceRange('  | a | b |', 0)).toEqual({ start: 3, end: 6 })
  })

  it('keeps raw spacing inside the range', () => {
    // "| a  | b |": first segment is " a  " (offsets 1..5).
    expect(cellSourceRange('| a  | b |', 0)).toEqual({ start: 1, end: 5 })
  })

  it('supports empty cells', () => {
    // '||' is a single empty cell, like the renderer counts it.
    expect(cellSourceRange('||', 0)).toEqual({ start: 1, end: 1 })
    expect(cellSourceRange('||', 1)).toBeNull()
    expect(cellSourceRange('| a || b |', 1)).toEqual({ start: 5, end: 5 })
  })

  it('returns null past the last cell or for negative indexes', () => {
    expect(cellSourceRange('| a |', 1)).toBeNull()
    expect(cellSourceRange('| a |', -1)).toBeNull()
  })

  it('round-trips through the preview split', () => {
    // The range the editor replaces must be the segment the widget rendered.
    const line = '| Feature | Parser |'
    for (const i of [0, 1]) {
      const range = cellSourceRange(line, i)
      expect(range).not.toBeNull()
      const rendered = line
        .slice(range!.start, range!.end)
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim())[0]
      expect(rendered).toBe(['Feature', 'Parser'][i])
    }
  })
})

describe('TableWidget cells', () => {
  const rows = [
    { text: '| Feature | Parser |', line: 10 },
    { text: '| --- | --- |', line: 11 },
    { text: '| Tables | yes |', line: 12 }
  ]

  it('tags every cell with its source line and index', () => {
    const dom = new TableWidget(rows, true).toDOM()
    const cells = Array.from(dom.querySelectorAll('.cm-live-table-cell'))
    // header (2) + body (2)
    expect(cells.length).toBe(4)
    const first = cells[0] as HTMLElement
    expect(first.tagName).toBe('TH')
    expect(first.dataset.line).toBe('10')
    expect(first.dataset.cell).toBe('0')
    const bodyCell = cells[2] as HTMLElement
    expect(bodyCell.tagName).toBe('TD')
    expect(bodyCell.dataset.line).toBe('12')
    expect(bodyCell.dataset.cell).toBe('0')
    expect(bodyCell.textContent).toBe('Tables')
  })

  it('marks editability on the wrapper for the handler to read', () => {
    const editable = new TableWidget(rows, true).toDOM()
    expect(editable.dataset.editable).toBe('true')
    const locked = new TableWidget(rows, false).toDOM()
    expect(locked.dataset.editable).toBe('false')
  })

  it('treats widgets with different rows as unequal so edits re-render', () => {
    const a = new TableWidget(rows, true)
    const changed = new TableWidget(
      rows.map((r) => (r.line === 12 ? { ...r, text: '| Tables | no |' } : r)),
      true
    )
    expect(a.eq(changed)).toBe(false)
    expect(a.eq(new TableWidget([...rows], true))).toBe(true)
  })
})
