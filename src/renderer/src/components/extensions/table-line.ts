import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { Range, Extension } from '@codemirror/state'
import { treeGrowthEffect } from './tree-progress'

/** Standalone plugin: marks table lines with cm-line-table-row so they break out of max-width */
export function buildTableLineDecorations(view: EditorView): DecorationSet {
  const { state } = view
  const { doc } = state
  const ranges: Range<Decoration>[] = []
  const tableLines = new Set<number>()

  // 1. Check syntax tree for GFM Table nodes
  const tree = ensureSyntaxTree(state, Math.min(doc.length, 65536), 100) ?? syntaxTree(state)
  tree.iterate({
    enter: (node) => {
      if (node.name === 'Table') {
        const firstLine = doc.lineAt(node.from).number
        const lastLine = doc.lineAt(node.to).number
        for (let n = firstLine; n <= lastLine; n++) {
          tableLines.add(n)
        }
        return false
      }
      return
    }
  })

  // 2. Fast regex fallback on visible lines to guarantee zero-latency non-wrapping
  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number
    const endLine = doc.lineAt(to).number
    for (let n = startLine; n <= endLine; n++) {
      if (!tableLines.has(n)) {
        const text = doc.line(n).text.trim()
        if (text.startsWith('|') && text.includes('|', 1)) {
          tableLines.add(n)
        }
      }
    }
  }

  // 3. Emit line decorations in strict document order
  const sortedLines = Array.from(tableLines).sort((a, b) => a - b)
  for (const lineNum of sortedLines) {
    const line = doc.line(lineNum)
    ranges.push(Decoration.line({ class: 'cm-line-table-row' }).range(line.from))
  }

  return Decoration.set(ranges, true)
}

export const tableLinePlugin: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildTableLineDecorations(view)
    }

    update(update: ViewUpdate): void {
      let shouldRebuild = update.docChanged || update.viewportChanged
      if (!shouldRebuild) {
        for (const tr of update.transactions) {
          for (const effect of tr.effects) {
            if (effect.is(treeGrowthEffect)) {
              shouldRebuild = true
              break
            }
          }
          if (shouldRebuild) break
        }
      }
      if (shouldRebuild) {
        this.decorations = buildTableLineDecorations(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations
  }
)
