import { ViewPlugin, Decoration, EditorView, WidgetType, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { readOnlyFacet } from './read-only'

function getFrontmatterDecorations(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>()
  const readOnly = view.state.facet(readOnlyFacet)
  const text = view.state.doc.toString()
  
  if (text.startsWith('---\n')) {
    const endMatch = text.indexOf('\n---\n', 4)
    if (endMatch !== -1) {
      const from = 0
      const to = endMatch + 5
      
      const activeLines = new Set<number>()
      if (view.hasFocus && !readOnly) {
        for (const r of view.state.selection.ranges) {
          const firstLine = view.state.doc.lineAt(r.from).number
          const lastLine = view.state.doc.lineAt(r.to).number
          for (let n = firstLine; n <= lastLine; n++) activeLines.add(n)
        }
      }
      
      let active = false
      const startLine = view.state.doc.lineAt(from).number
      const endLine = view.state.doc.lineAt(to).number
      for (let n = startLine; n <= endLine; n++) {
        if (activeLines.has(n)) { active = true; break; }
      }
      
      if (!active || readOnly) {
        const widget = Decoration.replace({
          block: true,
          widget: new class extends WidgetType {
            eq(_other: any) { return false }
            ignoreEvent() { return false }
            toDOM() {
              const div = document.createElement('div')
              div.className = 'cm-frontmatter-widget'
              div.style.background = 'var(--bg-secondary)'
              div.style.padding = '8px 12px'
              div.style.borderRadius = '6px'
              div.style.border = '1px solid var(--border)'
              div.style.marginBottom = '12px'
              div.style.cursor = 'pointer'
              div.style.color = 'var(--text-muted)'
              div.style.fontFamily = 'monospace'
              div.style.fontSize = '0.9em'
              
              const innerText = text.substring(4, endMatch)
              div.innerText = 'Metadata\\n' + innerText
              
              return div
            }
          }()
        })
        builder.add(from, to, widget)
      } else {
        // Just dim the text
        const mark = Decoration.mark({ class: 'cm-frontmatter-dim' })
        builder.add(from, to, mark)
      }
    }
  }
  
  return builder.finish()
}

export const frontmatterPlugin = ViewPlugin.fromClass(
  class {
    decorations
    constructor(view: EditorView) {
      this.decorations = getFrontmatterDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.focusChanged || update.viewportChanged) {
        this.decorations = getFrontmatterDecorations(update.view)
      }
    }
  },
  {
    decorations: v => v.decorations
  }
)
