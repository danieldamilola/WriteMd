import { WidgetType } from '@codemirror/view'
import { createDocumentMarkdownIt } from '../../utils/markdown'

/**
 * Table cells are rendered with markdown-it rather than a hand-rolled regex
 * pass. `html: false` is the security-relevant part: cell text comes straight
 * off disk, and any inline-HTML allowance would hand it to innerHTML below.
 */
const md = createDocumentMarkdownIt()

/** Render one cell's inline markdown to safe HTML. */
export function renderInlineMarkdown(text: string): string {
  return md.renderInline(text)
}

/** One non-blank source line of a table, with its 1-based document line number. */
export interface TableRow {
  text: string
  line: number
}

/**
 * Source range of one cell within its line, offsets relative to the line
 * start. Splits with the same semantics as the renderer (strip one outer
 * pipe pair, split on every `|`), so the range the editor replaces is
 * exactly the segment the preview was drawn from.
 */
export function cellSourceRange(
  lineText: string,
  cellIndex: number
): { start: number; end: number } | null {
  if (cellIndex < 0) return null
  const leadingWs = lineText.length - lineText.trimStart().length
  let s = lineText.trim()
  let base = leadingWs
  if (s.startsWith('|')) {
    s = s.slice(1)
    base += 1
  }
  if (s.endsWith('|')) s = s.slice(0, -1)
  let pos = 0
  for (let i = 0; i <= cellIndex; i++) {
    const idx = s.indexOf('|', pos)
    const end = idx === -1 ? s.length : idx
    if (i === cellIndex) return { start: base + pos, end: base + end }
    if (idx === -1) return null
    pos = idx + 1
  }
  return null
}

export class TableWidget extends WidgetType {
  constructor(
    readonly rows: TableRow[],
    readonly cellsEditable: boolean
  ) {
    super()
  }

  eq(other: TableWidget): boolean {
    return (
      other.cellsEditable === this.cellsEditable &&
      other.rows.length === this.rows.length &&
      other.rows.every((r, i) => r.text === this.rows[i].text && r.line === this.rows[i].line)
    )
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-live-table-wrap'
    wrap.dataset.editable = String(this.cellsEditable)

    if (this.rows.length < 2) {
      wrap.textContent = this.rows.map((r) => r.text).join('\n')
      return wrap
    }
    const lines = this.rows.map((r) => r.text)

    const parseCells = (line: string): string[] => {
      const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
      return trimmed.split('|').map((c) => c.trim())
    }

    const headerCells = parseCells(lines[0])

    // Parse alignment from separator row
    const sepCells = parseCells(lines[1])
    const aligns: Array<'left' | 'center' | 'right' | ''> = sepCells.map((sep) => {
      const s = sep.trim()
      if (s.startsWith(':') && s.endsWith(':')) return 'center'
      if (s.endsWith(':')) return 'right'
      if (s.startsWith(':')) return 'left'
      return ''
    })

    const table = document.createElement('table')
    const thead = document.createElement('thead')
    const headRow = document.createElement('tr')
    headerCells.forEach((cell, i) => {
      const th = document.createElement('th')
      th.innerHTML = renderInlineMarkdown(cell)
      th.className = 'cm-live-table-cell'
      th.dataset.line = String(this.rows[0].line)
      th.dataset.cell = String(i)
      if (aligns[i]) th.style.textAlign = aligns[i]
      headRow.appendChild(th)
    })
    thead.appendChild(headRow)
    table.appendChild(thead)

    if (lines.length > 2) {
      const tbody = document.createElement('tbody')
      for (let r = 2; r < lines.length; r++) {
        const cells = parseCells(lines[r])
        const tr = document.createElement('tr')
        headerCells.forEach((_h, i) => {
          const td = document.createElement('td')
          td.innerHTML = renderInlineMarkdown(cells[i] ?? '')
          td.className = 'cm-live-table-cell'
          td.dataset.line = String(this.rows[r].line)
          td.dataset.cell = String(i)
          if (aligns[i]) td.style.textAlign = aligns[i]
          tr.appendChild(td)
        })
        tbody.appendChild(tr)
      }
      table.appendChild(tbody)
    }

    wrap.appendChild(table)
    return wrap
  }

  ignoreEvent(): boolean {
    return false
  }
}
