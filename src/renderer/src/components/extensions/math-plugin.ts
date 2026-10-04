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
let cachedDoc: Text | null = null
let cachedMatches: MathMatch[] = []

function scanMath(doc: Text): MathMatch[] {
  const matches: MathMatch[] = []
  const text = doc.toString()

  const blockRegex = /\$\$([\s\S]*?)\$\$/g
  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(text)) !== null) {
    matches.push({
      from: match.index,
      to: match.index + match[0].length,
      content: match[1].trim(),
      block: true
    })
  }

  const inlineRegex = /\$([^$\n]+?)\$/g
  while ((match = inlineRegex.exec(text)) !== null) {
    const from = match.index
    const to = from + match[0].length
    // Inline math inside a `$$` block belongs to that block, not to itself.
    if (matches.some((m) => m.block && from >= m.from && to <= m.to)) continue
    matches.push({ from, to, content: match[1].trim(), block: false })
  }

  matches.sort((a, b) => a.from - b.from)
  return matches
}

function matchesFor(state: EditorState): MathMatch[] {
  if (state.doc !== cachedDoc) {
    cachedDoc = state.doc
    cachedMatches = scanMath(state.doc)
  }
  return cachedMatches
}

function getMathDecorations(state: EditorState): DecorationSet {
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

  for (const m of matchesFor(state)) {
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
    if (tr.docChanged || tr.selection) {
      return getMathDecorations(tr.state)
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f)
})