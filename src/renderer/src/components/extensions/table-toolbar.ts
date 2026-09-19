import { EditorView, showTooltip, type Tooltip } from '@codemirror/view'
import { StateField, EditorState } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'

function getTableRange(state: EditorState, pos: number): { from: number, to: number } | null {
  const tree = ensureSyntaxTree(state, pos, 100) ?? syntaxTree(state)
  let range: { from: number, to: number } | null = null
  tree.iterate({
    from: pos,
    to: pos,
    enter: (node) => {
      if (node.name === 'Table') {
        range = { from: node.from, to: node.to }
        return false
      }
      return
    }
  })
  return range
}

export function getTableTooltip(state: EditorState): Tooltip | null {
  const pos = state.selection.main.head
  const tableRange = getTableRange(state, pos)
  if (!tableRange) return null

  return {
    pos: tableRange.from,
    above: true,
    strictSide: true,
    arrow: true,
    create: (view: EditorView) => {
      const dom = document.createElement('div')
      dom.className = 'cm-table-toolbar'
      
      const btnAddRow = document.createElement('button')
      btnAddRow.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Col`
      btnAddRow.title = 'Add Column Right'
      btnAddRow.onclick = (e) => {
        e.preventDefault()
        // Simple append logic: just simulate pressing Enter at the end of the line
        const pos = view.state.selection.main.head
        const line = view.state.doc.lineAt(pos)
        // Check how many pipes
        const pipes = line.text.split('|').length - 1
        let newRow = '\n|' + Array(Math.max(1, pipes - 1)).fill('          ').join('|') + '|'
        view.dispatch({
          changes: { from: line.to, insert: newRow },
          selection: { anchor: line.to + 3 }
        })
        view.focus()
      }
      
      const btnAddCol = document.createElement('button')
      btnAddCol.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Row`
      btnAddCol.title = 'Add Row Below'
      btnAddCol.onclick = (e) => {
        e.preventDefault()
        const tableRange = getTableRange(view.state, view.state.selection.main.head)
        if (!tableRange) return
        
        const changes: { from: number, insert: string }[] = []
        const doc = view.state.doc
        const startLine = doc.lineAt(tableRange.from)
        const endLine = doc.lineAt(tableRange.to)
        
        for (let l = startLine.number; l <= endLine.number; l++) {
          const line = doc.line(l)
          // Insert " |" at the end of every line, or " --- |" for the separator
          if (l === startLine.number + 1) {
            changes.push({ from: line.to, insert: ' -------- |' })
          } else {
            changes.push({ from: line.to, insert: '          |' })
          }
        }
        
        view.dispatch({ changes })
        view.focus()
      }

      const setColumnAlignment = (align: 'left' | 'center' | 'right') => {
        const pos = view.state.selection.main.head
        const tableRange = getTableRange(view.state, pos)
        if (!tableRange) return
        
        const doc = view.state.doc
        const startLine = doc.lineAt(tableRange.from)
        
        const currentLine = doc.lineAt(pos)
        const prefix = currentLine.text.substring(0, pos - currentLine.from)
        let colIdx = (prefix.match(/\|/g) || []).length - 1
        if (colIdx < 0) colIdx = 0

        const sepLine = doc.line(startLine.number + 1)
        const cells = sepLine.text.split('|')
        
        let actualColIdx = colIdx
        if (sepLine.text.trim().startsWith('|')) {
          actualColIdx += 1
        }
        
        if (actualColIdx >= cells.length - 1) return

        let newCell = ' -------- '
        if (align === 'left') newCell = ' :------- '
        if (align === 'center') newCell = ' :------: '
        if (align === 'right') newCell = ' -------: '

        cells[actualColIdx] = newCell
        const newSepText = cells.join('|')

        view.dispatch({
          changes: { from: sepLine.from, to: sepLine.to, insert: newSepText }
        })
        view.focus()
      }

      const btnAlignLeft = document.createElement('button')
      btnAlignLeft.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="15" y1="12" x2="3" y2="12"></line><line x1="17" y1="18" x2="3" y2="18"></line></svg>`
      btnAlignLeft.title = 'Align Left'
      btnAlignLeft.onclick = (e) => { e.preventDefault(); setColumnAlignment('left') }
      
      const btnAlignCenter = document.createElement('button')
      btnAlignCenter.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="19" y1="12" x2="5" y2="12"></line><line x1="19" y1="18" x2="5" y2="18"></line></svg>`
      btnAlignCenter.title = 'Align Center'
      btnAlignCenter.onclick = (e) => { e.preventDefault(); setColumnAlignment('center') }
      
      const btnAlignRight = document.createElement('button')
      btnAlignRight.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="12" x2="9" y2="12"></line><line x1="21" y1="18" x2="7" y2="18"></line></svg>`
      btnAlignRight.title = 'Align Right'
      btnAlignRight.onclick = (e) => { e.preventDefault(); setColumnAlignment('right') }

      // We just do a simple Add Row for MVP
      dom.appendChild(btnAddRow)
      dom.appendChild(btnAddCol)
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
