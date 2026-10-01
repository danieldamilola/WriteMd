import {
  ViewPlugin,
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
  type ViewUpdate
} from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { readOnlyFacet } from './read-only'
import { emit } from '../../events/bus'

/**
 * A named class rather than an anonymous one defined inside the decoration
 * loop. The old `eq()` returned false unconditionally, so every `[[link]]` in
 * the document had its DOM torn down and rebuilt on each keystroke (the plugin
 * updates on docChanged, selectionSet and focusChanged), along with a fresh
 * onclick closure each time. Comparing the label lets CodeMirror keep the node.
 */
class WikiLinkWidget extends WidgetType {
  constructor(readonly label: string) {
    super()
  }

  eq(other: WikiLinkWidget): boolean {
    return other.label === this.label
  }

  ignoreEvent(): boolean {
    return false
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-wiki-link'
    span.style.color = 'var(--accent)'
    span.style.textDecoration = 'none'
    span.style.cursor = 'pointer'
    span.style.fontWeight = '500'
    span.innerText = this.label

    span.onclick = (e) => {
      e.preventDefault()
      emit('wiki:open', { name: this.label })
    }
    return span
  }
}

function getWikiLinkDecorations(view: EditorView): DecorationSet {
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
      builder.add(from, to, Decoration.replace({ widget: new WikiLinkWidget(content) }))
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
    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.focusChanged ||
        update.viewportChanged
      ) {
        this.decorations = getWikiLinkDecorations(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations
  }
)
