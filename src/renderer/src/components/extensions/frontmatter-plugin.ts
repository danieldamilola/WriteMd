import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { StateField, type EditorState } from '@codemirror/state'
import { RangeSetBuilder } from '@codemirror/state'
import { readOnlyFacet } from './read-only'

function getFrontmatterDecorations(state: EditorState) {
  const builder = new RangeSetBuilder<Decoration>()
  const readOnly = state.facet(readOnlyFacet)
  const text = state.doc.toString()
  
  if (text.startsWith('---\n')) {
    const endMatch = text.indexOf('\n---\n', 4)
    if (endMatch !== -1) {
      const from = 0
      const to = endMatch + 5
      
      const activeLines = new Set<number>()
      if (!readOnly) {
        for (const r of state.selection.ranges) {
          const firstLine = state.doc.lineAt(r.from).number
          const lastLine = state.doc.lineAt(r.to).number
          for (let n = firstLine; n <= lastLine; n++) activeLines.add(n)
        }
      }
      
      let active = false
      const startLine = state.doc.lineAt(from).number
      const endLine = state.doc.lineAt(to).number
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
              div.style.background = 'var(--code-bg)'
              div.style.padding = '10px 14px'
              div.style.borderRadius = '6px'
              div.style.border = '1px solid var(--border-subtle)'
              div.style.marginBottom = '12px'
              div.style.cursor = 'pointer'
              div.style.color = 'var(--text-muted)'
              div.style.fontFamily = 'var(--font-mono, monospace)'
              div.style.fontSize = '12px'
              
              const innerText = text.substring(4, endMatch)
              div.innerText = 'Metadata\n' + innerText
              
              return div
            }
          }()
        })
        builder.add(from, to, widget)
      }
    }
  }
  
  return builder.finish()
}

export const frontmatterPlugin = StateField.define<DecorationSet>({
  create(state) {
    return getFrontmatterDecorations(state)
  },
  update(value, tr) {
    if (tr.docChanged || tr.selection) {
      return getFrontmatterDecorations(tr.state)
    }
    return value
  },
  provide: f => EditorView.decorations.from(f)
})
