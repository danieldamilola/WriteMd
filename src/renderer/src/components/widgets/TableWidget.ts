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

/**
 * Characters that can start inline markdown. A cell without any of them renders
 * as its own text, which skips a markdown-it parse per cell.
 *
 * That parse is the bulk of building a large table: 32 000 cells of plain words
 * spent over a second in the parser alone.
 */
const INLINE_MARKDOWN_HINT = /[*_`[\]!<&~]/

/** Same result as `renderInlineMarkdown`, without the parser when possible. */
export function renderCell(text: string): string {
  if (!INLINE_MARKDOWN_HINT.test(text)) return escapeHtml(text)
  return md.renderInline(text)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Rows rendered before the table says so.
 *
 * Every cell is a DOM node, so a table with thousands of rows cannot be built
 * in one pass without a visible stall. The rest of the table stays reachable in
 * source mode, which the footer says out loud rather than silently truncating.
 */
export const MAX_RENDERED_ROWS = 400

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

/** Split one table line into trimmed cell texts, renderer semantics. */
export function parseTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((c) => c.trim())
}

/** Per-column alignment declared by the separator row. */
function parseAligns(sepCells: string[]): Array<'left' | 'center' | 'right' | ''> {
  return sepCells.map((sep) => {
    const s = sep.trim()
    if (s.startsWith(':') && s.endsWith(':')) return 'center'
    if (s.endsWith(':')) return 'right'
    if (s.startsWith(':')) return 'left'
    return ''
  })
}

/** Fill an existing `<tr>` with one row's cells. */
function renderRow(
  tr: HTMLTableRowElement,
  cells: string[],
  columns: number,
  aligns: Array<'left' | 'center' | 'right' | ''>,
  docLine: number,
  tag: 'td' | 'th'
): void {
  const existing = Array.from(tr.children) as HTMLElement[]
  while (existing.length > columns) {
    tr.removeChild(tr.lastChild as Node)
    existing.pop()
  }
  for (let i = 0; i < columns; i++) {
    let cell = existing[i]
    if (!cell) {
      cell = document.createElement(tag)
      tr.appendChild(cell)
    }
    const html = renderCell(cells[i] ?? '')
    if (cell.innerHTML !== html) cell.innerHTML = html
    cell.className = 'cm-live-table-cell'
    cell.dataset.line = String(docLine)
    cell.dataset.cell = String(i)
    cell.style.textAlign = aligns[i] ?? ''
  }
}

function makeRow(
  cells: string[],
  columns: number,
  aligns: Array<'left' | 'center' | 'right' | ''>,
  docLine: number,
  tag: 'td' | 'th'
): HTMLTableRowElement {
  const tr = document.createElement('tr')
  renderRow(tr, cells, columns, aligns, docLine, tag)
  return tr
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

    const headerCells = parseTableCells(lines[0])
    const columns = headerCells.length
    const aligns = parseAligns(parseTableCells(lines[1]))

    const table = document.createElement('table')
    const thead = document.createElement('thead')
    thead.appendChild(
      makeRow(headerCells, columns, aligns, this.rows[0].line, 'th')
    )
    table.appendChild(thead)

    const bodyLimit = Math.min(lines.length, 2 + MAX_RENDERED_ROWS)
    if (bodyLimit > 2) {
      const tbody = document.createElement('tbody')
      for (let r = 2; r < bodyLimit; r++) {
        tbody.appendChild(
          makeRow(parseTableCells(lines[r]), columns, aligns, this.rows[r].line, 'td')
        )
      }
      table.appendChild(tbody)
    }

    wrap.appendChild(table)
    if (lines.length > bodyLimit) wrap.appendChild(this.buildTruncationNotice(lines.length, bodyLimit))
    return wrap
  }

  /**
   * Say what is not on screen instead of quietly showing a short table.
   *
   * The omitted rows are still in the document, and source mode still has all
   * of them; a table that silently stops at row 400 reads as data loss.
   */
  private buildTruncationNotice(total: number, shown: number): HTMLElement {
    const notice = document.createElement('div')
    notice.className = 'cm-live-table-truncated'
    notice.setAttribute('role', 'note')
    const hidden = total - shown
    notice.textContent = `${hidden} more row${hidden === 1 ? '' : 's'} not shown (${total} total). Switch to source mode to edit them.`
    return notice
  }

  /**
   * Patch the existing table instead of rebuilding it.
   *
   * CodeMirror calls this instead of `toDOM` when the widget is replaced by an
   * equal-shaped one, which is every keystroke inside the table. Rebuilding from
   * scratch re-created 32 000 cells for a 4000-row table, and that rebuild was
   * the whole cost of typing in one: a second-long stall per character. Now
   * only the row that changed is redrawn.
   */
  updateDOM(dom: HTMLElement): boolean {
    const wrap = dom as HTMLElement
    wrap.dataset.editable = String(this.cellsEditable)
    if (this.rows.length < 2) return false
    const tbody = wrap.querySelector('tbody')
    const theadRow = wrap.querySelector('thead tr')
    if (!tbody || !theadRow) return false

    const lines = this.rows.map((r) => r.text)
    const headerCells = parseTableCells(lines[0])
    const columns = headerCells.length
    const aligns = parseAligns(parseTableCells(lines[1]))

    renderRow(theadRow as HTMLTableRowElement, headerCells, columns, aligns, this.rows[0].line, 'th')

    const bodyLimit = Math.min(lines.length, 2 + MAX_RENDERED_ROWS)
    const bodyRows = lines.slice(2, bodyLimit)
    const existing = Array.from(tbody.children) as HTMLTableRowElement[]
    // Remove rows that no longer exist.
    while (existing.length > bodyRows.length) {
      tbody.removeChild(tbody.lastChild as Node)
      existing.pop()
    }
    // Redraw only what changed; appending is cheaper than a rebuild.
    for (let i = 0; i < bodyRows.length; i++) {
      const docRow = this.rows[i + 2]
      const cells = parseTableCells(bodyRows[i])
      if (existing[i]) {
        renderRow(existing[i], cells, columns, aligns, docRow.line, 'td')
      } else {
        const tr = makeRow(cells, columns, aligns, docRow.line, 'td')
        tbody.appendChild(tr)
        existing.push(tr)
      }
    }
    this.syncTruncationNotice(wrap, lines.length, bodyLimit)
    return true
  }

  private syncTruncationNotice(wrap: HTMLElement, total: number, shown: number): void {
    const existing = wrap.querySelector('.cm-live-table-truncated')
    const hidden = total - shown
    if (hidden <= 0) {
      existing?.remove()
      return
    }
    if (existing) {
      const text = `${hidden} more row${hidden === 1 ? '' : 's'} not shown (${total} total). Switch to source mode to edit them.`
      if (existing.textContent !== text) existing.textContent = text
      return
    }
    wrap.appendChild(this.buildTruncationNotice(total, shown))
  }

  ignoreEvent(): boolean {
    return false
  }
}
