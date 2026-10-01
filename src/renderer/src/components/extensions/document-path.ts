import { Facet } from '@codemirror/state'

/**
 * Path of the document an editor view is showing, or null for an unsaved buffer.
 *
 * Lives in its own module because both the link-click handler and the live
 * decorations need it. Keeping it in `link-click.ts` made those two modules
 * import each other, and the cycle only resolved because every exported binding
 * happened to be a function or facet declaration.
 */
export const documentPathFacet = Facet.define<string | null, string | null>({
  combine: (values) => (values.length ? values[values.length - 1] : null)
})

/**
 * How a click is matched to a link.
 *
 * - `decoration`: only clicks landing on a rendered `.cm-live-link` count. This
 *   is live-preview mode, where a click on an un-revealed link must reveal the
 *   markup rather than navigate.
 * - `syntax`: fall back to the syntax tree at the click coordinates. Used in
 *   source mode, which renders no decorations, so there is nothing else to hit.
 */
export const linkClickStyleFacet = Facet.define<'decoration' | 'syntax', 'decoration' | 'syntax'>({
  combine: (values) => (values.length ? values[values.length - 1] : 'decoration')
})
