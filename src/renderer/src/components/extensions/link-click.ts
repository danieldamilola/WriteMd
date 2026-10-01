import { syntaxTree } from '@codemirror/language'
import { type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { linkClickStyleFacet } from './document-path'
import { linkDestinationUrl } from './live-decorations'
import { linkElementFromEvent, linkIconHitTarget } from './freeze-mouse'
import { readOnlyFacet } from './read-only'

export { documentPathFacet, linkClickStyleFacet } from './document-path'

/**
 * Called with the clicked destination and the view it was clicked in. The view
 * carries `documentPathFacet`, which is what lets the same handler resolve
 * relative links correctly for the primary pane and the split pane separately.
 */
export type LinkClickHandler = (url: string, view: EditorView) => void

/**
 * Find the `URL`/`Link` node covering the click.
 *
 * In live-preview modes the click lands on a `.cm-live-link` decoration, so the
 * element gives an exact position. In source mode there is no decoration and the
 * click has to come from the syntax tree, which is why `posAtCoords` is the
 * fallback rather than the only path.
 */
function destinationAt(view: EditorView, event: MouseEvent): string | null {
  const linkEl = view.state.facet(readOnlyFacet)
    ? linkElementFromEvent(event, view.contentDOM)
    : linkIconHitTarget(event, view.contentDOM)

  // No initialiser: both branches assign, so the previous `= null` was dead.
  let node: SyntaxNode | null
  if (linkEl) {
    const pos = view.posAtDOM(linkEl)
    if (pos < 0) return null
    node = syntaxTree(view.state).resolveInner(pos, 1)
  } else {
    if (view.state.facet(linkClickStyleFacet) !== 'syntax') return null
    const coords = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (coords == null) return null
    // Without the facet this would swallow clicks anywhere in live-preview mode.
    const direct = syntaxTree(view.state).resolveInner(coords, 1)
    if (!isLinkNode(direct)) return null
    node = direct
  }

  let visibleUrl: SyntaxNode | null = null
  while (node && node.name !== 'Link') {
    if (node.name === 'URL') visibleUrl = node
    node = node.parent
  }
  const urlNode = node ? linkDestinationUrl(node, view.state.doc) : visibleUrl
  if (!urlNode) return null
  return view.state.doc.sliceString(urlNode.from, urlNode.to) || null
}

function isLinkNode(node: SyntaxNode): boolean {
  for (let n: SyntaxNode | null = node; n; n = n.parent) {
    if (n.name === 'Link') return true
  }
  return false
}

export function makeLinkClickHandler(onLinkClick: LinkClickHandler): Extension {
  return EditorView.domEventHandlers({
    click: (event, view) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
      if (event.button !== 0) return false

      const url = destinationAt(view, event)
      if (!url) return false

      event.preventDefault()
      event.stopPropagation()
      onLinkClick(url, view)
      return true
    }
  })
}

/**
 * Hand a destination to the OS browser. Only used for web URLs; the main
 * process refuses every other scheme, and a refusal here would surface as an
 * unhandled rejection with nothing on screen.
 */
export function defaultOnLinkClick(url: string): void {
  const open = window.electronAPI?.shell?.openExternal
  if (!open) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  open(url).catch((err: unknown) => {
    console.error('Could not open link:', url, err)
  })
}
