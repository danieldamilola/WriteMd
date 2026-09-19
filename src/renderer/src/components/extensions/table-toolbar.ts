import { EditorView, showTooltip, type Tooltip } from '@codemirror/view'
import { StateField, EditorState } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'

function isInTable(state: EditorState, pos: number): boolean {
  const tree = ensureSyntaxTree(state, pos, 100) ?? syntaxTree(state)
  let inTable = false
  tree.iterate({
    from: pos,
    to: pos,
    enter: (node) => {
      if (node.name === 'Table') {
        inTable = true
        return false
      }
      return
    }
  })
  return inTable
}

export function getTableTooltip(state: EditorState): Tooltip | null {
  const pos = state.selection.main.head
  if (!isInTable(state, pos)) return null

  return {
    pos,
    above: true,
    strictSide: true,
    arrow: true,
    create: (view: EditorView) => {
      const dom = document.createElement('div')
      dom.className = 'cm-table-toolbar'
      
      const btnAddRow = document.createElement('button')
      btnAddRow.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Row`
      btnAddRow.title = 'Add Row Below'
      btnAddRow.onclick = (e) => {
        e.preventDefault()
        // Simple append logic: just simulate pressing Enter at the end of the line
        const pos = view.state.selection.main.head
        const line = view.state.doc.lineAt(pos)
        // Check how many pipes
        const pipes = line.text.split('|').length - 1
        let newRow = '\\n|' + Array(Math.max(1, pipes - 1)).fill('          ').join('|') + '|'
        view.dispatch({
          changes: { from: line.to, insert: newRow },
          selection: { anchor: line.to + 3 }
        })
        view.focus()
      }

      const btnAlignLeft = document.createElement('button')
      btnAlignLeft.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="15" y1="12" x2="3" y2="12"></line><line x1="17" y1="18" x2="3" y2="18"></line></svg>`
      btnAlignLeft.title = 'Align Left'
      
      const btnAlignCenter = document.createElement('button')
      btnAlignCenter.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="19" y1="12" x2="5" y2="12"></line><line x1="19" y1="18" x2="5" y2="18"></line></svg>`
      btnAlignCenter.title = 'Align Center'
      
      const btnAlignRight = document.createElement('button')
      btnAlignRight.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="12" x2="9" y2="12"></line><line x1="21" y1="18" x2="7" y2="18"></line></svg>`
      btnAlignRight.title = 'Align Right'

      // We just do a simple Add Row for MVP
      dom.appendChild(btnAddRow)
      dom.appendChild(btnAlignLeft)
      dom.appendChild(btnAlignCenter)
      dom.appendChild(btnAlignRight)

      return { dom }
    }
  }
}

export const tableToolbarField = StateField.define<readonly Tooltip[]>({
  create(state) {
    const tooltip = getTableTooltip(state)
    return tooltip ? [tooltip] : []
  },
  update(tooltips, tr) {
    if (!tr.docChanged && !tr.selection) return tooltips
    const tooltip = getTableTooltip(tr.state)
    return tooltip ? [tooltip] : []
  },
  provide: (f) => showTooltip.computeN([f], (state) => state.field(f))
})
