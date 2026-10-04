import { Decoration, DecorationSet, EditorView } from '@codemirror/view'
import { StateField, type EditorState, type Text } from '@codemirror/state'
import { RangeSetBuilder } from '@codemirror/state'
import { readOnlyFacet } from './read-only'
import { MathWidget } from '../widgets/MathWidget'

interface MathMatch {
  from: number
  to: number
  content: string
  /** `$$...$$` renders as a block widget; `$...$` as an inline one. */
  block: boolean
}

/**
 * Delimiter matches for the current document.
 *
 * The scan is the expensive part: it stringifies the whole document and runs
 * two regexes over it, which on a 6 MB note is tens of milliseconds. Moving the
 * cursor does not change a single delimiter, so the matches are cached and only
 * rescanned when the document itself changes. The old code rebuilt them on
 * every selection change as well.
 */
/**
 * How far before the first change a rescan starts.
 *
 * Matches before the change keep their exact positions, so they are kept. A
 * delimiter pair that straddles the boundary is re-found only if it starts
 * inside this window, which is why the window exists: a `$$` block larger than
 * this loses its widget until the next edit, and no hand-written note has one.
 */
const RESCAN_MARGIN = 200_000

/**
 * Delimiter scan, keyed by document.
 *
 * A module-level slot was wrong the moment split view existed: the two panes
 * hold separate `Text` objects, so whichever was not scanned last missed the
 * cache on every arrow key and every click and re-read the whole document - the
 * exact cost the incremental rescan exists to remove. Keying on the document
 * also lets an entry go when the document does.
 */
const mathCache = new WeakMap<Text, MathMatch[]>()

function scanMath(doc: Text, from: number): MathMatch[] {
  const matches: MathMatch[] = []
  const start = Math.max(0, from)
  const text = doc.sliceString(start)

  const blockRegex = /\$\$([\s\S]*?)\$\$/g
  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(text)) !== null) {
    matches.push({
      from: start + match.index,
      to: start + match.index + match[0].length,
      content: match[1].trim(),
      block: true
    })
  }

  const inlineRegex = /\$([^$\n]+?)\$/g
  while ((match = inlineRegex.exec(text)) !== null) {
    const from2 = start + match.index
    const to = from2 + match[0].length
    // Inline math inside a `$$` block belongs to that block, not to itself.
    if (matches.some((m) => m.block && from2 >= m.from && to <= m.to)) continue
    matches.push({ from: from2, to, content: match[1].trim(), block: false })
  }

  matches.sort((a, b) => a.from - b.from)
  return matches
}

function rescanFrom(state: EditorState, prev: { doc: Text; from: number }): MathMatch[] {
  const before = mathCache.get(prev.doc)
  if (!before) {
    const scanned = scanMath(state.doc, 0)
    mathCache.set(state.doc, scanned)
    return scanned
  }
  const start = Math.max(0, prev.from - RESCAN_MARGIN)
  const kept = before.filter((m) => m.to <= start)
  const rescanned = scanMath(state.doc, start)
  const merged = [...kept, ...rescanned].sort((a, b) => a.from - b.from)
  mathCache.set(state.doc, merged)
  return merged
}

function matchesFor(state: EditorState, prev?: { doc: Text; from: number }): MathMatch[] {
  const cached = mathCache.get(state.doc)
  if (cached && !prev) return cached
  return rescanFrom(state, prev ?? { doc: state.doc, from: 0 })
}

function getMathDecorations(state: EditorState, prev?: { doc: Text; from: number }): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const doc = state.doc
  const readOnly = state.facet(readOnlyFacet)

  const activeLines = new Set<number>()
  if (!readOnly) {
    for (const r of state.selection.ranges) {
      const firstLine = doc.lineAt(r.from).number
      const lastLine = doc.lineAt(r.to).number
      for (let n = firstLine; n <= lastLine; n++) activeLines.add(n)
    }
  }

  for (const m of matchesFor(state, prev)) {
    if (m.from >= m.to) continue
    let active = false
    const startLine = doc.lineAt(m.from).number
    const endLine = doc.lineAt(m.to).number
    for (let n = startLine; n <= endLine; n++) {
      if (activeLines.has(n)) {
        active = true
        break
      }
    }
    if (active && !readOnly) continue
    builder.add(
      m.from,
      m.to,
      Decoration.replace({
        widget: new MathWidget(m.content, m.block),
        block: m.block
      })
    )
  }

  return builder.finish()
}

/**
 * A StateField, not a ViewPlugin: `$$` blocks are block replacements, and
 * CodeMirror rejects block decorations from plugins ("Block decorations may not
 * be specified via plugins"), which left the editor with an empty DOM.
 */
export const mathPlugin = StateField.define<DecorationSet>({
  create(state) {
    return getMathDecorations(state)
  },
  update(value, tr) {
    if (tr.docChanged) {
      // Only an edit of a document already in the cache can rescan partially;
      // anything else (a new file, a restored tab, the other split pane) starts
      // over. `tr.startState.doc` is the document the edit was made to, which is
      // not the one the result is cached against: a change always produces a new
      // `Text`.
      const before = mathCache.get(tr.startState.doc)
      if (before && before.length > 0) {
        let first = tr.newDoc.length
        tr.changes.iterChangedRanges((fromA) => {
          if (fromA < first) first = fromA
        })
        return getMathDecorations(tr.state, { doc: tr.startState.doc, from: first })
      }
      return getMathDecorations(tr.state)
    }
    if (tr.selection) {
      return getMathDecorations(tr.state)
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f)
})
