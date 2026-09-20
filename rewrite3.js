const fs = require('fs')

let code = fs.readFileSync('src/renderer/src/components/extensions/live-decorations.ts', 'utf8')

// Fix buildInlineDecorations
code = code.replace(
  `export function buildInlineDecorations(state: EditorState, view?: EditorView): DecorationSet {
  const { state } = view
  const { doc } = state`,
  `export function buildInlineDecorations(state: EditorState, view?: EditorView): DecorationSet {
  const { doc } = state`
)

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
      return buildInlineDecorations(tr.state)
    }
    return value
  },
  provide: f => EditorView.decorations.from(f)
})`

code = code.replace(oldPluginRegex, newPlugin)

fs.writeFileSync('src/renderer/src/components/extensions/live-decorations.ts', code)
console.log('Rewrote live-decorations.ts correctly')
