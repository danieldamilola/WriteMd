import { Facet, EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

// Read-only / Reading Mode Facet
export const readOnlyFacet = Facet.define<boolean, boolean>({
  combine: (values) => (values.length ? values[values.length - 1] : false)
})

export function readOnlyExtension(ro: boolean): Extension {
  return [
    EditorView.editable.of(!ro),
    EditorState.readOnly.of(ro),
    readOnlyFacet.of(ro),
    ro ? EditorView.editorAttributes.of({ class: 'cm-live-readonly' }) : []
  ]
}
