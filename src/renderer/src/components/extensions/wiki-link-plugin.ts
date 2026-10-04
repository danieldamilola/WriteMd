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

/**
 * How far outside the viewport a scan looks.
 *
 * Widgets are only rendered inside the viewport anyway, so scanning the whole
 * document on every keystroke bought nothing and cost a full-document string
 * copy each time (6% of all typing time on a 6 MB note, plus the garbage).
 * The margin keeps a link that straddles the edge rendered instead of popping
 * in one character later.
 */
const SCAN_MARGIN = 2_000

/**
 * The slice of the document a viewport needs scanned.
 *
 * Exported for tests: jsdom never lays out, so a view's viewport there is
 * always the empty range at 0 and an end-of-document link can only be checked
 * through this function.
 */
export function wikiLinkScanRange(
  viewportFrom: number,
  viewportTo: number,
  docLength: number
): { start: number; end: number } {
  return {
    start: Math.max(0, viewportFrom - SCAN_MARGIN),
    end: Math.min(docLength, viewportTo + SCAN_MARGIN)
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

  const doc = view.state.doc
  const { start, end } = wikiLinkScanRange(view.viewport.from, view.viewport.to, doc.length)
  const text = doc.sliceString(start, end)
  const regex = /\[\[(.*?)\]\]/g
  let match

  while ((match = regex.exec(text)) !== null) {
    const from = start + match.index
    const to = from + match[0].length
    // A link cut in half by the scan window is left alone; it renders once the
    // viewport moves far enough to contain it whole.
    if (to > end) break
    const content = match[1]

    const line = doc.lineAt(from).number

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
