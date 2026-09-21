import { syntaxTree } from '@codemirror/language'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export function insertTightListItem(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty) return false
  const from = sel.from
  const line = state.doc.lineAt(from)

  const tree = syntaxTree(state)
  const cursor = tree.resolveInner(from, -1).cursor()
  let inBulletList = false
  for (;;) {
    if (cursor.name === 'BulletList') {
      inBulletList = true
      break
    }
    if (!cursor.parent()) break
  }
  if (!inBulletList) return false

  const lineText = state.doc.sliceString(line.from, line.to)
  const prefix = lineText.match(/^(\s*)([-*+])(\s+)/)
  if (!prefix) return false

  const [whole, indent, marker] = prefix
  const rest = lineText.slice(whole.length)

  const taskMatch = rest.match(/^(\[[ xX]\])(\s*)/)
  const taskPrefixLen = taskMatch ? taskMatch[0].length : 0
  const contentAfterPrefix = rest.slice(taskPrefixLen)

  if (!contentAfterPrefix.trim()) {
    const depth = Math.floor(indent.length / 2)
    if (depth >= 1) {
      const outerIndent = indent.slice(0, indent.length - 2)
      const continuation = taskMatch ? `${marker} [ ] ` : `${marker} `
      const replacement = `${outerIndent}${continuation}`
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: replacement },
        selection: EditorSelection.cursor(line.from + replacement.length)
      })
    } else {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: '' },
        selection: EditorSelection.cursor(line.from)
      })
    }
    return true
  }

  const continuation = taskMatch ? `${marker} [ ] ` : `${marker} `
  const insert = `\n${indent}${continuation}`
  view.dispatch({
    changes: { from, to: from, insert },
    selection: EditorSelection.cursor(from + insert.length)
  })
  return true
}
