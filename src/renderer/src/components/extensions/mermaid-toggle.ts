import { Facet } from '@codemirror/state'

/**
 * Whether ```mermaid fences render as diagrams. The settings toggle writes
 * `advanced.enableMermaid`, which used to have no reader, so the switch did
 * nothing at all. Read where the widget decision is made.
 */
export const mermaidEnabledFacet = Facet.define<boolean, boolean>({
  combine: (values) => (values.length ? values[values.length - 1] : true)
})
