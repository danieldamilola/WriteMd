import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { Facet, StateField, type Extension } from '@codemirror/state'
import { displayTitle } from '../../utils/links'
import { documentPathFacet } from './document-path'

/**
 * The document title, rendered inside the editor above the first line.
 *
 * It used to sit in the document header, which put a second copy of the name in
 * a chrome bar away from the text and left nothing in the document body to
 * orient by. Obsidian's inline title reads better: the name is the first thing
 * in the document itself, so it scrolls away with the content instead of
 * staying pinned while the writing moves under it.
 *
 * It occupies no document line, so line 1 is still the first line of the file.
 */

/** Renames the document this view shows. Supplied per view by the editor. */
export const renameTitleFacet = Facet.define<(name: string) => void, (name: string) => void>({
  combine: (values) => (values.length ? values[values.length - 1] : () => {})
})

/**
 * Whether this view shows the title.
 *
 * Source mode is the document's actual bytes, and a filename floating above
 * them would be a second thing pretending to be part of the file.
 */
export const showInlineTitleFacet = Facet.define<boolean, boolean>({
  combine: (values) => (values.length ? values[values.length - 1] : true)
})

class InlineTitleWidget extends WidgetType {
  constructor(
    private readonly title: string,
    private readonly onRename: (name: string) => void
  ) {
    super()
  }

  override eq(other: InlineTitleWidget): boolean {
    return other.title === this.title && other.onRename === this.onRename
  }

  override toDOM(): HTMLElement {
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'cm-inline-title'
    input.value = this.title
    input.spellcheck = false
    input.setAttribute('aria-label', 'Document title')

    input.addEventListener('blur', () => {
      const next = input.value.trim()
      // An empty title is not a name; put the current one back.
      if (!next || next === this.title) input.value = this.title
      else this.onRename(next)
    })
    input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        input.blur()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        input.value = this.title
        input.blur()
      }
      // Otherwise the editor's own keymap types into this input.
      event.stopPropagation()
    })
    return input
  }

  /**
   * Let the editor ignore events inside the widget.
   *
   * `true` means CodeMirror steps out of the way so the event reaches the DOM
   * natively, which is what a real input needs. Returning `false` made the
   * editor swallow the keystrokes and the title silently refused to accept
   * any typing.
   */
  override ignoreEvent(): boolean {
    return true
  }
}

/**
 * Decorations must come from a state field, not a view plugin: CodeMirror
 * rejects block decorations supplied by plugins outright, and the editor went
 * blank rather than degrading.
 */
const titleField = StateField.define<DecorationSet>({
  create: (state) => build(state),
  update: (value, tr) => (tr.docChanged || tr.effects.length ? build(tr.state) : value),
  provide: (field) => EditorView.decorations.from(field)
})

function build(state: { facet: <T>(f: Facet<T, T>) => T; doc: { length: number } }): DecorationSet {
  const path = state.facet(documentPathFacet)
  if (!path || !state.facet(showInlineTitleFacet)) return Decoration.none
  return Decoration.set([
    Decoration.widget({
      widget: new InlineTitleWidget(displayTitle(path), state.facet(renameTitleFacet)),
      block: true,
      side: -1
    }).range(0)
  ])
}

export function inlineTitle(): Extension {
  return titleField
}
