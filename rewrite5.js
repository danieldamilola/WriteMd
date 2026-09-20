const fs = require('fs')
let code = fs.readFileSync('src/renderer/src/components/extensions/live-decorations.ts', 'utf8')

if (!code.includes('EditorState')) {
  code = code.replace(
    "import type { Range, Text } from '@codemirror/state'",
    "import type { Range, Text, EditorState } from '@codemirror/state'"
  )
}
if (!code.includes('StateField')) {
  code = code.replace(
    "import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'",
    "import { Decoration, EditorView, type DecorationSet, type ViewUpdate } from '@codemirror/view'\nimport { StateField } from '@codemirror/state'"
  )
}

// 1. signature
code = code.replace(
  'export function buildInlineDecorations(view: EditorView): DecorationSet {',
  'export function buildInlineDecorations(state: EditorState): DecorationSet {'
)

// 2. doc and ranges
code = code.replace(
  '  const { state } = view\n  const { doc } = state',
  '  const { doc } = state'
)

// 3. remove view.hasFocus
code = code.replaceAll('view.hasFocus && ', '')
code = code.replaceAll('view.hasFocus', 'true')

// 4. change inlinePreviewPlugin from ViewPlugin to StateField
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

// 5. Change MermaidWidget from widget to replace
code = code.replace(
  `        if (language === 'mermaid' && (!anyActive || readOnly)) {
          ranges.push(
            Decoration.replace({
              widget: new MermaidWidget(codeContent),
              block: true
            }).range(node.from, node.to)
          )`,
  `        if (language === 'mermaid' && (!anyActive || readOnly)) {
          ranges.push(
            Decoration.replace({
              widget: new MermaidWidget(codeContent),
              block: true
            }).range(node.from, node.to)
          )` // Wait, it's ALREADY replace! So I don't need to change it!
)

fs.writeFileSync('src/renderer/src/components/extensions/live-decorations.ts', code)
console.log('Rewrote live-decorations.ts correctly')
