import { ViewPlugin, Decoration, EditorView, WidgetType, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { readOnlyFacet } from './read-only'

function getWikiLinkDecorations(view: EditorView) {
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

  const text = view.state.doc.toString()
  const regex = /\[\[(.*?)\]\]/g
  let match
  
  while ((match = regex.exec(text)) !== null) {
    const from = match.index
    const to = from + match[0].length
    const content = match[1]
    
    const line = view.state.doc.lineAt(from).number
    
    if (!activeLines.has(line) || readOnly) {
      builder.add(from, to, Decoration.replace({
        widget: new class extends WidgetType {
          eq(_other: any) { return false }
          ignoreEvent() { return false }
          toDOM() {
            const span = document.createElement('span')
            span.className = 'cm-wiki-link'
            span.style.color = 'var(--accent)'
            span.style.textDecoration = 'none'
            span.style.cursor = 'pointer'
            span.style.fontWeight = '500'
            span.innerText = content
            
            span.onclick = (e) => {
              e.preventDefault()
              // Here we'd dispatch an event to open the file.
              // For now we just visually implement it.
            }
            return span
          }
        }()
      }))
    }
  }
  
  return builder.finish()
}

export const wikiLinkPlugin = ViewPlugin.fromClass(
  class {
    decorations
    constructor(view: EditorView) {
      this.decorations = getWikiLinkDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.focusChanged || update.viewportChanged) {
        this.decorations = getWikiLinkDecorations(update.view)
      }
    }
  },
  {
    decorations: v => v.decorations
  }
)
