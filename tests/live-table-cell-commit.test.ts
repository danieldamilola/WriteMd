import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { livePreviewPlugin } from '../src/renderer/src/components/LivePreview'
import { readOnlyExtension } from '../src/renderer/src/components/extensions/read-only'
import { cellSourceRange } from '../src/renderer/src/components/widgets/TableWidget'

/**
 * The commit path is the one that writes to the user's file, and it had no test
 * at all. Two failures lived there:
 *
 * Clicking a cell and clicking away again committed `innerText` against the
 * source, so a cell holding `**bold**` had its asterisks replaced with nothing
 * and a link lost its URL, with no typing and no intent. And a pipe typed into a
 * cell was written raw, where the split treats it as a column break, so the cell
 * silently became two and the extra one was invisible.
 */
function mount(doc: string, readOnly = false): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({ extensions: [GFM] }),
      livePreviewPlugin({ onLinkClick: (): void => undefined }),
      readOnlyExtension(readOnly)
    ]
  })
  return new EditorView({ state, parent: document.body })
}

/** The rendered cells of the table the extension produced, in document order. */
function cellsOf(view: EditorView): HTMLElement[] {
  return Array.from(view.dom.querySelectorAll('.cm-live-table-cell')) as HTMLElement[]
}

/**
 * jsdom implements neither `innerText` nor `isContentEditable`, and the commit
 * path reads both: `cell.innerText` for the new text, `cell.isContentEditable` to
 * decide whether the cell is being edited at all. Without these the focusout
 * handler returns early and every "nothing changed" assertion below would pass
 * without the commit ever running.
 */
function armCell(cell: HTMLElement): void {
  Object.defineProperty(cell, 'innerText', {
    configurable: true,
    get: (): string => cell.textContent ?? ''
  })
  Object.defineProperty(cell, 'isContentEditable', {
    configurable: true,
    get: (): boolean => cell.classList.contains('cm-live-table-editing')
  })
}

function cellAt(view: EditorView, line: number, cell: number): HTMLElement {
  const found = view.dom.querySelector(
    `.cm-live-table-cell[data-line="${line}"][data-cell="${cell}"]`
  ) as HTMLElement | null
  if (!found) throw new Error(`no cell at ${line}:${cell}`)
  armCell(found)
  return found
}

/**
 * Drive a cell through the sequence a click does: enter the editor, change what
 * it shows, leave it, and see what reached the document.
 */
function clickAndLeave(view: EditorView, line: number, cell: number, text?: string): void {
  const target = cellAt(view, line, cell)
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  expect(target.classList.contains('cm-live-table-editing')).toBe(true)
  if (text !== undefined) target.textContent = text
  target.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
}

const TABLE = ['| Feature | Parser |', '| --- | --- |', '| Tables | yes |'].join('\n')

describe('in-place table cell editing', () => {
  it('writes nothing when a cell is clicked and left alone', () => {
    const view = mount(TABLE)
    clickAndLeave(view, 3, 0)
    expect(view.state.doc.toString()).toBe(TABLE)
    view.destroy()
  })

  it('writes a real edit to the cell it was made in', () => {
    // The positive control. Without it every "nothing changed" case below would
    // also pass if the commit path never ran at all.
    const view = mount(TABLE)
    clickAndLeave(view, 3, 0, 'changed')
    expect(view.state.doc.toString()).toContain('| changed | yes |')
    view.destroy()
  })

  it('writes nothing for a cell holding emphasis, which is the data loss', () => {
    const doc = [
      '| Feature | Parser |',
      '| --- | --- |',
      '| **bold** | [d](https://x.test) |'
    ].join('\n')
    const view = mount(doc)
    clickAndLeave(view, 3, 0)
    clickAndLeave(view, 3, 1)
    // Both cells draw as HTML, so what the cell displays is not its source.
    // Committing it would have flattened the emphasis and dropped the URL.
    expect(view.state.doc.toString()).toBe(doc)
    view.destroy()
  })

  it('edits the source of a cell with markup, so a real edit keeps it', () => {
    const view = mount(['| a |', '| --- |', '| **bold** |'].join('\n'))
    clickAndLeave(view, 3, 0, '**bolder**')
    expect(view.state.doc.toString()).toContain('| **bolder** |')
    view.destroy()
  })

  it('escapes a pipe typed into a cell instead of adding a column', () => {
    const view = mount(['| a | b |', '| --- | --- |', '| x | y |'].join('\n'))
    clickAndLeave(view, 3, 0, 'p | q')
    expect(view.state.doc.toString()).toContain('| p \\| q |')
    view.destroy()
  })

  it('does not double-escape a pipe the source already escaped', () => {
    const view = mount(['| a | b |', '| --- | --- |', '| x \\| y | z |'].join('\n'))
    // The cell displays `x | y`, and leaving it alone must not turn `\|` into
    // `\\|`.
    clickAndLeave(view, 3, 0)
    expect(view.state.doc.toString()).toContain('| x \\| y |')
    view.destroy()
  })

  it('keeps an escaped pipe in one cell when the row is written back', () => {
    const view = mount(['| a | b |', '| --- | --- |', '| x \\| y | z |'].join('\n'))
    clickAndLeave(view, 3, 0, 'x | y')
    // One cell changed, one column structure: the row still has two cells.
    const line = view.state.doc.line(3).text
    const range = cellSourceRange(line, 1)
    expect(range).not.toBeNull()
    expect(line.slice(range!.start, range!.end).trim()).toBe('z')
    view.destroy()
  })

  it('tags every rendered cell with the coordinates the commit reads back', () => {
    const view = mount(TABLE)
    const cells = cellsOf(view)
    expect(cells.length).toBe(4)
    expect(cells.map((c) => `${c.dataset.line}:${c.dataset.cell}`)).toEqual([
      '1:0',
      '1:1',
      '3:0',
      '3:1'
    ])
    view.destroy()
  })

  it('does not edit a cell in a read-only editor', () => {
    const view = mount(TABLE, true)
    const cell = cellAt(view, 3, 0)
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(cell.classList.contains('cm-live-table-editing')).toBe(false)
    view.destroy()
  })
})
