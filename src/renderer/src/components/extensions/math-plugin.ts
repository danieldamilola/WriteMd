import { ViewPlugin, Decoration, EditorView, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { readOnlyFacet } from './read-only'
import { MathWidget } from '../widgets/MathWidget'

function getMathDecorations(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>()
  const readOnly = view.state.facet(readOnlyFacet)
  
  const activeLines = new Set<number>()
  if (view.hasFocus && !readOnly) {
    for (const r of view.state.selection.ranges) {
      const firstLine = view.state.doc.lineAt(r.from).number
      const lastLine = view.state.doc.lineAt(r.to).number
      for (let n = firstLine; n <= lastLine; n++) activeLines.add(n)
    }
  }

  // A very simple regex for matching $$...$$ and $...$
  const text = view.state.doc.toString()
  
  const blockRegex = /\$\$([\s\S]*?)\$\$/g
  let match
  const blockMatches: {from: number, to: number}[] = []
  
  while ((match = blockRegex.exec(text)) !== null) {
    const from = match.index
    const to = from + match[0].length
    const content = match[1].trim()
    blockMatches.push({from, to})
    
    let active = false
    const startLine = view.state.doc.lineAt(from).number
    const endLine = view.state.doc.lineAt(to).number
    for (let n = startLine; n <= endLine; n++) {
      if (activeLines.has(n)) { active = true; break; }
    }
    
    if (!active || readOnly) {
      builder.add(from, to, Decoration.widget({
        widget: new MathWidget(content, true),
        block: true
      }))
    }
  }

  // Inline regex
  const inlineRegex = /\$([^$\n]+?)\$/g
  while ((match = inlineRegex.exec(text)) !== null) {
    const from = match.index
    const to = from + match[0].length
    const content = match[1]
    
    // Ensure it doesn't overlap with block matches
    if (blockMatches.some(m => from >= m.from && to <= m.to)) continue
    
    const line = view.state.doc.lineAt(from).number
    if (!activeLines.has(line) || readOnly) {
      builder.add(from, to, Decoration.widget({
        widget: new MathWidget(content, false)
      }))
    }
  }
  
  return builder.finish()
}

export const mathPlugin = ViewPlugin.fromClass(
  class {
    decorations
    constructor(view: EditorView) {
      this.decorations = getMathDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.focusChanged || update.viewportChanged) {
        this.decorations = getMathDecorations(update.view)
      }
    }
  },
  {
    decorations: v => v.decorations
  }
)
