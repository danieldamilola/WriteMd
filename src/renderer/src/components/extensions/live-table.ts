import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorState, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view'
import {
  TableRow,
  TableWidget,
  cellSourceRange,
  renderInlineMarkdown
} from '../widgets/TableWidget'
import { readOnlyFacet } from './read-only'
import { treeGrowthEffect } from './tree-progress'

export function buildTableDecorations(state: EditorState): DecorationSet {
  const { doc } = state
  const readOnly = state.facet(readOnlyFacet)
  const ranges: Range<Decoration>[] = []

  const tree = ensureSyntaxTree(state, Math.min(doc.length, 65536), 100) ?? syntaxTree(state)
  tree.iterate({
    enter: (node) => {
      if (node.name === 'Table') {
        const startLine = doc.lineAt(node.from)
        const endLine = doc.lineAt(node.to)

        // The widget always renders, even with the cursor inside: clicking a
        // cell edits that cell in place. Showing source on cursor-inside is
        // what the old code did, and it dumped the whole table to pipes.
        const rows: TableRow[] = []
        for (let n = startLine.number; n <= endLine.number; n++) {
          const text = doc.line(n).text
          if (text.trim().length === 0) continue
          rows.push({ text, line: n })
        }
        ranges.push(
          Decoration.replace({
            widget: new TableWidget(rows, !readOnly),
            block: true
          }).range(startLine.from, endLine.to)
        )
        return false
      }
      return
    }
  })

  return Decoration.set(ranges, true)
}

export const liveTableField = StateField.define<DecorationSet>({
  create(state) {
    return buildTableDecorations(state)
  },
  update(decorations, tr) {
    // Selection alone never rebuilds: the widget no longer depends on it, and
    // rebuilding on every click would detach a cell mid-edit.
    let shouldRebuild = tr.docChanged
    if (!shouldRebuild) {
      for (const effect of tr.effects) {
        if (effect.is(treeGrowthEffect)) {
          shouldRebuild = true
          break
        }
      }
    }
    if (shouldRebuild) {
      return buildTableDecorations(tr.state)
    }
    return decorations.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f)
})

/** Collapse runs of line breaks: a table row is one line, always. */
function sanitizeCellText(text: string): string {
  return text.replace(/[\r\n]+/g, ' ')
}

function cellFromEvent(e: Event): HTMLElement | null {
  const el = e.target instanceof Element ? e.target : null
  return el?.closest('.cm-live-table-cell') as HTMLElement | null
}

function cellCoords(cell: HTMLElement): { line: number; cell: number } | null {
  const line = Number(cell.dataset.line)
  const cellIndex = Number(cell.dataset.cell)
  if (!Number.isInteger(line) || !Number.isInteger(cellIndex)) return null
  return { line, cell: cellIndex }
}

/** Fresh cell element from the live DOM (commits rebuild the widget). */
function findCell(view: EditorView, line: number, cellIndex: number): HTMLElement | null {
  return view.dom.querySelector(
    `.cm-live-table-cell[data-line="${line}"][data-cell="${cellIndex}"]`
  ) as HTMLElement | null
}

function isCellEditing(cell: HTMLElement): boolean {
  return cell.isContentEditable
}

/**
 * Start editing a cell. Only one cell edits at a time: any other cell still
 * flagged editing gets committed first (its blur may never have fired, which
 * used to strand highlighted-but-dead cells all over the table).
 */
function beginCellEdit(
  view: EditorView,
  cell: HTMLElement,
  point?: { x: number; y: number }
): void {
  const dest = cellCoords(cell)
  for (const other of Array.from(
    view.dom.querySelectorAll('.cm-live-table-cell.cm-live-table-editing')
  )) {
    if (other !== cell) commitCellEdit(view, other as HTMLElement, false)
  }
  // Commits above rebuild the widget, so re-resolve: the node in hand may be
  // detached now.
  const target =
    (dest ? findCell(view, dest.line, dest.cell) : null) ?? (cell.isConnected ? cell : null)
  if (!target) return
  const el = target
  el.contentEditable = 'plaintext-only'
  el.spellcheck = false
  el.classList.add('cm-live-table-editing')
  el.focus()
  const sel = document.getSelection()
  sel?.removeAllRanges()
  // Mouse: caret lands where the user clicked. Keyboard: end of cell.
  if (point && typeof document.caretRangeFromPoint === 'function') {
    const range = document.caretRangeFromPoint(point.x, point.y)
    if (range && el.contains(range.startContainer)) sel?.addRange(range)
  }
  if (sel && sel.rangeCount === 0) {
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    sel.addRange(range)
  }
  // If focus did not stick (something stole it synchronously), drop the
  // editing flag instead of stranding a highlighted cell that eats no keys.
  // The microtask runs after this event's default actions settle.
  window.setTimeout(() => {
    if (el.isConnected && el.classList.contains('cm-live-table-editing') && !el.matches(':focus')) {
      el.contentEditable = 'false'
      el.classList.remove('cm-live-table-editing')
    }
  }, 0)
}

function endCellEdit(cell: HTMLElement): void {
  cell.contentEditable = 'false'
  cell.classList.remove('cm-live-table-editing')
}

/** Validated line text plus the cell's source range, or null. */
function cellSource(
  view: EditorView,
  line: number,
  cellIndex: number
): { lineFrom: number; start: number; end: number; original: string } | null {
  if (!Number.isInteger(line) || line < 1 || line > view.state.doc.lines) return null
  const lineRef = view.state.doc.line(line)
  const range = cellSourceRange(lineRef.text, cellIndex)
  if (!range) return null
  return {
    lineFrom: lineRef.from,
    start: range.start,
    end: range.end,
    original: lineRef.text.slice(range.start, range.end)
  }
}

function commitCellEdit(view: EditorView, cell: HTMLElement, refocus: boolean): void {
  const coords = cellCoords(cell)
  endCellEdit(cell)
  if (!coords) {
    if (refocus) view.focus()
    return
  }
  const src = cellSource(view, coords.line, coords.cell)
  if (!src) {
    if (refocus) view.focus()
    return
  }
  const next = sanitizeCellText(cell.innerText ?? '')
  // Compare trimmed: the rendered cell never carries the source padding, so
  // a raw compare reports a phantom edit on every blur and strips the row's
  // spacing for nothing. Spacing-only differences are meaningless in tables.
  if (next.trim() === src.original.trim()) {
    if (refocus) view.focus()
    return
  }
  // Keep the row's padding so edits don't reflow the source aesthetics.
  const leading = src.original.slice(0, src.original.length - src.original.trimStart().length)
  const trailing = src.original.slice(src.original.trimEnd().length)
  const insert = `${leading}${next.trim()}${trailing}`
  view.dispatch({
    changes: { from: src.lineFrom + src.start, to: src.lineFrom + src.end, insert }
  })
  // Never steal focus back on blur-commits (e.g. the user clicked away to
  // another app); callers moving within the table focus explicitly.
  if (refocus) view.focus()
}

function cancelCellEdit(view: EditorView, cell: HTMLElement): void {
  const coords = cellCoords(cell)
  // Restore the rendered cell from the (unchanged) document.
  if (coords) {
    const src = cellSource(view, coords.line, coords.cell)
    if (src) {
      const lineText = view.state.doc.line(coords.line).text
      cell.innerHTML = renderInlineMarkdown(lineText.slice(src.start, src.end))
    }
  }
  endCellEdit(cell)
  view.focus()
}

/** Coordinates of the cell below/above in the same column. */
function siblingCoords(
  cell: HTMLElement,
  direction: 1 | -1
): { line: number; cell: number } | null {
  const row = cell.closest('tr')
  const table = cell.closest('table')
  if (!row || !table) return null
  const rows = Array.from(table.querySelectorAll('tr'))
  const cells = Array.from(row.querySelectorAll('.cm-live-table-cell'))
  const col = cells.indexOf(cell)
  const next = rows[rows.indexOf(row) + direction]
  const target = next?.querySelectorAll('.cm-live-table-cell')[col] as HTMLElement | undefined
  return target ? cellCoords(target) : null
}

export const tableCellEditing: Extension = [
  EditorView.domEventHandlers({
    mousedown(e, view) {
      const cell = cellFromEvent(e)
      if (!cell || view.state.facet(readOnlyFacet)) return false
      if (cell.closest('[data-editable="false"]')) return false
      if (isCellEditing(cell)) return false
      e.preventDefault()
      beginCellEdit(view, cell, { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY })
      return true
    },
    focusout(e, view) {
      const cell = cellFromEvent(e)
      if (!cell || !isCellEditing(cell)) return false
      // Moving between cells of the same table is handled by the Tab/Enter
      // paths (they commit explicitly); committing again here would double
      // through the same edit.
      const dest = e.relatedTarget instanceof Element ? e.relatedTarget : null
      if (dest && cell.closest('.cm-live-table-wrap')?.contains(dest)) return false
      commitCellEdit(view, cell, false)
      return true
    }
  }),
  // Capture phase, ahead of CodeMirror core: core consumes cell keystrokes
  // first (Ctrl+A selected the whole document, Enter replaced it with "\n")
  // and bubble-phase handlers never see them. Inside an editing cell the
  // browser owns every key natively; only Enter/Tab/Escape are intercepted.
  ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        view.dom.addEventListener('keydown', this.onKeyDown, true)
      }
      destroy(): void {
        this.view.dom.removeEventListener('keydown', this.onKeyDown, true)
      }
      onKeyDown = (e: KeyboardEvent): void => {
        const cell = cellFromEvent(e)
        if (!cell || !isCellEditing(cell)) return
        // Shield the cell: CodeMirror must never see these keystrokes.
        e.stopPropagation()
        // Select-all natively: relying on the browser default proved
        // unreliable inside the widget (focus escaped to the editor and the
        // keys that followed landed in the document instead of the cell).
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
          e.preventDefault()
          const range = document.createRange()
          range.selectNodeContents(cell)
          const sel = document.getSelection()
          sel?.removeAllRanges()
          sel?.addRange(range)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          cancelCellEdit(this.view, cell)
          return
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          // Capture the destination first: committing rebuilds the widget
          // and detaches this subtree.
          const dest = siblingCoords(cell, 1)
          commitCellEdit(this.view, cell, false)
          const fresh = dest ? findCell(this.view, dest.line, dest.cell) : null
          if (fresh && !this.view.state.facet(readOnlyFacet)) beginCellEdit(this.view, fresh)
          else this.view.focus()
          return
        }
        if (e.key === 'Tab') {
          e.preventDefault()
          const row = cell.closest('tr')
          const cells = Array.from(row?.querySelectorAll('.cm-live-table-cell') ?? [])
          const next = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)] as HTMLElement | undefined
          const dest = next ? cellCoords(next) : null
          commitCellEdit(this.view, cell, false)
          const fresh = dest ? findCell(this.view, dest.line, dest.cell) : null
          if (fresh) beginCellEdit(this.view, fresh)
          else this.view.focus()
          return
        }
      }
    }
  )
]
