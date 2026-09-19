import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorState, StateField, type Range } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { TableWidget } from '../widgets/TableWidget'
import { readOnlyFacet } from './read-only'
import { treeGrowthEffect } from './tree-progress'

export function buildTableDecorations(state: EditorState): DecorationSet {
  const { doc } = state
  const readOnly = state.facet(readOnlyFacet)
  const ranges: Range<Decoration>[] = []

  // Collect active line numbers from cursor selection
  const activeLines = new Set<number>()
  if (!readOnly) {
    for (const r of state.selection.ranges) {
      const firstLine = doc.lineAt(r.from).number
      const lastLine = doc.lineAt(r.to).number
      for (let n = firstLine; n <= lastLine; n++) {
        activeLines.add(n)
      }
    }
  }

  const tree = ensureSyntaxTree(state, Math.min(doc.length, 65536), 100) ?? syntaxTree(state)
  tree.iterate({
    enter: (node) => {
      if (node.name === 'Table') {
        const startLine = doc.lineAt(node.from)
        const endLine = doc.lineAt(node.to)

        let isCursorInside = false
        if (!readOnly) {
          for (let n = startLine.number; n <= endLine.number; n++) {
            if (activeLines.has(n)) {
              isCursorInside = true
              break
            }
          }
        }

        // If cursor is outside the table (or in reading mode), replace the entire block of lines
        if (!isCursorInside) {
          const tableText = doc.sliceString(startLine.from, endLine.to)
          ranges.push(
            Decoration.replace({
              widget: new TableWidget(tableText),
              block: true
            }).range(startLine.from, endLine.to)
          )
          return false
        }
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
    let shouldRebuild = tr.docChanged || tr.selection != null
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
