const fs = require('fs')

let code = fs.readFileSync('src/renderer/src/components/extensions/live-decorations.ts', 'utf8')

// Add EditorState import
if (!code.includes('EditorState')) {
  code = code.replace(
    "import type { Range, Text } from '@codemirror/state'",
    "import type { Range, Text, EditorState } from '@codemirror/state'"
  )
}

// Change ViewPlugin and ViewUpdate imports
code = code.replace(
  "import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'",
  "import { Decoration, EditorView, type DecorationSet, type ViewUpdate } from '@codemirror/view'\nimport { StateField } from '@codemirror/state'"
)

// Replace buildInlineDecorations(view: EditorView) with buildInlineDecorations(state: EditorState, view?: EditorView)
code = code.replace(
  'export function buildInlineDecorations(view: EditorView): DecorationSet {',
  'export function buildInlineDecorations(state: EditorState, view?: EditorView): DecorationSet {'
)

code = code.replace(
  '  const { state } = view\n  const { doc } = state',
  '  const { doc } = state'
)

// In buildInlineDecorations, replace view.hasFocus with view?.hasFocus
code = code.replaceAll('view.hasFocus', 'view?.hasFocus')

// Replace inlinePreviewPlugin
const oldPluginRegex = /export const inlinePreviewPlugin = ViewPlugin\.fromClass\([\s\S]+?\}\n\)/
const newPlugin = `export const inlinePreviewPlugin = StateField.define<DecorationSet>({
  create(state) {
    return buildInlineDecorations(state)
  },
  update(value, tr) {
    const prevFrozen = tr.startState.field(previewFrozenField, false)
    const nextFrozen = tr.state.field(previewFrozenField, false)
    const justUnfroze = prevFrozen && !nextFrozen

    if (nextFrozen && !justUnfroze && !tr.docChanged) return value

    let treeGrew = false
    for (const effect of tr.effects) {
      if (effect.is(treeGrowthEffect)) {
        treeGrew = true
        break
      }
    }

    const readOnlyChanged =
      tr.startState.facet(readOnlyFacet) !== tr.state.facet(readOnlyFacet)

    if (
      justUnfroze ||
      tr.docChanged ||
      tr.selection ||
      treeGrew ||
      readOnlyChanged
    ) {
      // NOTE: We don't have view here, so view?.hasFocus is undefined.
      // This means blocks expand purely based on state.selection, which is fine!
      return buildInlineDecorations(tr.state)
    }
    return value
  },
  provide: f => EditorView.decorations.from(f)
})`

code = code.replace(oldPluginRegex, newPlugin)

fs.writeFileSync('src/renderer/src/components/extensions/live-decorations.ts', code)
console.log('Rewrote live-decorations.ts')
