import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { history, historyKeymap, undo } from '@codemirror/commands'
import { keymap } from '@codemirror/view'

/**
 * One editor view serves every tab, so its single undo stack accumulates every
 * file's edits. Opening a note and pressing Ctrl+Z therefore applied the
 * *previous* note's inverse change to the new one.
 *
 * This was worse than a visible no-op. In a freshly opened one-line note, undoing
 * an edit made in a table three documents ago appended that table cell's text to
 * the note, and the autosave wrote it to disk.
 *
 * Announcing the load as non-history is not sufficient on its own: the earlier
 * document's events remain on the stack behind it. `isolateHistory` does not help
 * either, because it only stops adjacent events from merging rather than stopping
 * undo from walking across the boundary. Replacing the state is the fix, and these
 * cases pin why.
 */
function openView(doc: string): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, extensions: [history(), keymap.of([...historyKeymap])] }),
    parent: document.body
  })
}

describe('a document swap starts a clean undo history', () => {
  it('cannot undo an edit made in the previous document', () => {
    const view = openView('table cell text')

    // An edit in this document, as a cell commit or a keystroke would leave.
    const at = view.state.doc.length
    view.dispatch({ changes: { from: at, insert: ' Tables ' } })
    expect(view.state.doc.toString()).toBe('table cell text Tables ')

    // Switch to a different document the way the editor does it.
    view.setState(EditorState.create({ doc: 'second document', extensions: [history()] }))
    expect(view.state.doc.toString()).toBe('second document')

    undo(view)
    // The previous document's edit is not reachable from here.
    expect(view.state.doc.toString()).toBe('second document')
    view.destroy()
  })

  it('does not resurrect the load itself as an undoable event', () => {
    const view = openView('first document')
    view.setState(EditorState.create({ doc: 'second document', extensions: [history()] }))
    undo(view)
    expect(view.state.doc.toString()).toBe('second document')
    view.destroy()
  })

  it('still undoes edits made after the swap', () => {
    const view = openView('first document')
    view.setState(EditorState.create({ doc: 'second document', extensions: [history()] }))
    const at = view.state.doc.length
    view.dispatch({ changes: { from: at, insert: ' plus typing' } })
    expect(view.state.doc.toString()).toBe('second document plus typing')

    undo(view)
    expect(view.state.doc.toString()).toBe('second document')
    view.destroy()
  })

  it('keeps two documents independent', () => {
    const view = openView('alpha')
    view.dispatch({ changes: { from: 5, insert: '!' } })
    view.setState(EditorState.create({ doc: 'beta', extensions: [history()] }))
    view.dispatch({ changes: { from: view.state.doc.length, insert: '?' } })
    expect(view.state.doc.toString()).toBe('beta?')

    // Undo reaches this document's edit and stops there.
    undo(view)
    expect(view.state.doc.toString()).toBe('beta')
    undo(view)
    expect(view.state.doc.toString()).toBe('beta')
    view.destroy()
  })
})
