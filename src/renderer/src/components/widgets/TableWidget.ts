import { WidgetType } from '@codemirror/view'
import { createDocumentMarkdownIt } from '../../utils/markdown'

/**
 * Table cells are rendered with markdown-it rather than a hand-rolled regex
 * pass. `html: false` is the security-relevant part: cell text comes straight
 * off disk, and any inline-HTML allowance would hand it to innerHTML below.
 */
const md = createDocumentMarkdownIt()

/**
 * Characters that can change what a cell displays, so it needs the parser.
 * A cell without any of them is its own text, which skips a markdown-it parse
 * per cell.
 *
 * That parse is the bulk of building a large table: 32 000 cells of plain words
 * spent over a second in the parser alone.
 *
 * Three entries are there for correctness rather than speed. `\\` is how a
 * literal pipe is written, and taking the fast path showed the backslash. The
 * URL alternatives are what `linkify` turns into anchors; without them in the
 * hint such a cell was drawn as plain text and stopped being a link. Note there
 * is no `www.`: markdown-it does not linkify a bare `www.` host, so that one
 * would only buy a parse.
 */
const INLINE_MARKDOWN_HINT = /[*_`[\]!<&~\\]|(?:https?:\/\/|mailto:)/

/** Render one cell's source as the safe HTML the preview draws. */
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

/** Whether the character at `index` is escaped by the backslashes before it. */
function isEscapedAt(text: string, index: number): boolean {
  let backslashes = 0
  for (let k = index - 1; k >= 0 && text[k] === '\\'; k--) backslashes++
  return backslashes % 2 === 1
}

/**
 * Index of the next pipe that would really split a cell, meaning one that is
 * not already escaped. Returns -1 when the rest of the line has none.
 */
function nextUnescapedPipe(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '|' && !isEscapedAt(text, i)) return i
  }
  return -1
}

/**
 * `a \| b` is one cell, not two. Splitting on every pipe turned an escaped pipe
 * into a real column break the moment the cell was edited.
 */
export function escapeCellPipes(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '|' && !isEscapedAt(text, i)) out += '\\'
    out += text[i]
  }
  return out
}

/** The inverse of `escapeCellPipes`, for deciding what a cell will display. */
export function unescapeCellPipes(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] === '|') {
      out += '|'
      i++
      continue
    }
    out += text[i]
  }
  return out
}

/**
 * Whether a cell's source is its own displayed text, so that editing the
 * rendered cell and writing it back is a round trip rather than a rewrite.
 *
 * This is the guard that stops in-place editing from flattening markup: for
 * `**bold**` the widget shows `bold`, so committing what the cell displays would
 * replace the asterisks with nothing and drop the emphasis from the file. A link
 * loses its URL the same way. Those cells edit their source instead.
 */
export function isPlainCellSource(text: string): boolean {
  return renderCell(text) === escapeHtml(unescapeCellPipes(text))
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
 * pipe pair, split on every unescaped `|`), so the range the editor replaces is
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
  // Only a real pipe closes the row. Stripping an escaped one ate the backslash
  // and left the cell ending mid-escape.
  if (s.length > 0 && s.endsWith('|') && !isEscapedAt(s, s.length - 1)) s = s.slice(0, -1)
  let pos = 0
  for (let i = 0; i <= cellIndex; i++) {
    const idx = nextUnescapedPipe(s, pos)
    const end = idx === -1 ? s.length : idx
    if (i === cellIndex) return { start: base + pos, end: base + end }
    if (idx === -1) return null
    pos = idx + 1
  }
  return null
}

/** Split one table line into trimmed cell texts, renderer semantics. */
export function parseTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '')
  const body =
    trimmed.length > 0 && trimmed.endsWith('|') && !isEscapedAt(trimmed, trimmed.length - 1)
      ? trimmed.slice(0, -1)
      : trimmed
  const cells: string[] = []
  let pos = 0
  for (;;) {
    const idx = nextUnescapedPipe(body, pos)
    if (idx === -1) {
      cells.push(body.slice(pos).trim())
      return cells
    }
    cells.push(body.slice(pos, idx).trim())
    pos = idx + 1
  }
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

/**
 * Source text each cell was last drawn from. `updateDOM` runs on every document
 * change, and re-running markdown-it over 400 rows for a keystroke above the
 * table was the parse cost the patch path was meant to avoid. Comparing the
 * source first skips the parser, not just the DOM write.
 */
const lastRenderedText = new WeakMap<HTMLElement, string>()

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
    const text = cells[i] ?? ''
    // Never redraw the cell being typed into: its content is the user's, not
    // the document's, and overwriting it would eat what they just wrote.
    if (lastRenderedText.get(cell) !== text && !cell.classList.contains('cm-live-table-editing')) {
      const html = renderCell(text)
      if (cell.innerHTML !== html) cell.innerHTML = html
      lastRenderedText.set(cell, text)
    }
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
    thead.appendChild(makeRow(headerCells, columns, aligns, this.rows[0].line, 'th'))
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
    if (lines.length > bodyLimit)
      wrap.appendChild(this.buildTruncationNotice(lines.length, bodyLimit))
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

    renderRow(
      theadRow as HTMLTableRowElement,
      headerCells,
      columns,
      aligns,
      this.rows[0].line,
      'th'
    )

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
