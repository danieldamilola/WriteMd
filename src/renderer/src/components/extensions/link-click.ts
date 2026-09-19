import { syntaxTree } from '@codemirror/language'
import { Facet, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { linkDestinationUrl } from './live-decorations'
import { linkElementFromEvent, linkIconHitTarget } from './freeze-mouse'
import { readOnlyFacet } from './read-only'

// Document Path Facet for resolving relative assets
export const documentPathFacet = Facet.define<string | null, string | null>({
  combine: (values) => (values.length ? values[values.length - 1] : null)
})

export function makeLinkClickHandler(onLinkClick: (url: string) => void): Extension {
  return EditorView.domEventHandlers({
    click: (event, view) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
      if (event.button !== 0) return false

      const linkEl = view.state.facet(readOnlyFacet)
        ? linkElementFromEvent(event, view.contentDOM)
        : linkIconHitTarget(event, view.contentDOM)
      if (!linkEl) return false

      const pos = view.posAtDOM(linkEl)
      if (pos < 0) return false

      const tree = syntaxTree(view.state)
      let node: SyntaxNode | null = tree.resolveInner(pos, 1)
      let visibleUrl: SyntaxNode | null = null
      while (node && node.name !== 'Link') {
        if (node.name === 'URL') visibleUrl = node
        node = node.parent
      }
      const urlNode = node ? linkDestinationUrl(node, view.state.doc) : visibleUrl
      if (!urlNode) return false

      const url = view.state.doc.sliceString(urlNode.from, urlNode.to)
      if (!url) return false

      event.preventDefault()
      event.stopPropagation()
      onLinkClick(url)
      return true
    }
  })
}

export function defaultOnLinkClick(url: string): void {
  if (typeof window !== 'undefined' && window.electronAPI?.shell?.openExternal) {
    void window.electronAPI.shell.openExternal(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
