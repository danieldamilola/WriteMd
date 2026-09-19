import { keymap } from '@codemirror/view'
import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'

function isInTable(view: EditorView, pos: number): boolean {
  const tree = ensureSyntaxTree(view.state, pos, 100) ?? syntaxTree(view.state)
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

function handleTab(view: EditorView, shift: boolean): boolean {
  const state = view.state
  const pos = state.selection.main.head

  if (!isInTable(view, pos)) return false

  const line = state.doc.lineAt(pos)
  
  // A naive implementation to jump between `|` cells
  const text = line.text
  
  // Find all pipe positions in the current line
  const pipes: number[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '|') pipes.push(i)
  }

  if (pipes.length < 2) return false

  const colOffset = pos - line.from
  let nextPipeIdx = -1

  if (shift) {
    // find the cell to the left
    for (let i = pipes.length - 1; i >= 0; i--) {
      if (pipes[i] < colOffset - 1) { // -1 to handle if we are exactly at the start of a cell
        nextPipeIdx = i - 1
        break
      }
    }
  } else {
    // find the cell to the right
    for (let i = 0; i < pipes.length; i++) {
      if (pipes[i] > colOffset) {
        nextPipeIdx = i
        break
      }
    }
  }

  // If there's a next cell on this line
  if (nextPipeIdx >= 0 && nextPipeIdx < pipes.length - 1) {
    const cellStart = line.from + pipes[nextPipeIdx] + 1
    const cellEnd = line.from + pipes[nextPipeIdx + 1]
    
    // Skip spaces
    let start = cellStart
    while (start < cellEnd && state.doc.sliceString(start, start + 1) === ' ') start++
    
    let end = cellEnd
    while (end > start && state.doc.sliceString(end - 1, end) === ' ') end--
    
    view.dispatch({
      selection: EditorSelection.single(start, end)
    })
    return true
  }

  // If we reach the end of the line (or start of line on Shift+Tab), jump to next/prev row
  if (!shift && nextPipeIdx === pipes.length - 1) {
    if (line.number < state.doc.lines) {
      const nextLine = state.doc.line(line.number + 1)
      if (nextLine.text.includes('|')) {
        view.dispatch({
          selection: EditorSelection.single(nextLine.from + 2, nextLine.from + 2)
        })
        // recursively call handleTab to select the first cell
        handleTab(view, false)
        return true
      }
    }
    
    // No next line, or next line is not a table row -> insert new row
    // Count columns from the first line of the table
    const cols = pipes.length - 1
    let newRowText = '\n|'
    for (let i = 0; i < cols; i++) {
      newRowText += '          |'
    }
    
    view.dispatch({
      changes: { from: line.to, insert: newRowText },
      selection: EditorSelection.single(line.to + 3, line.to + 3)
    })
    return true
  }

  return false
}

export const tableKeymapPlugin = keymap.of([
  {
    key: 'Tab',
    run: (view) => handleTab(view, false)
  },
  {
    key: 'Shift-Tab',
    run: (view) => handleTab(view, true)
  }
])
