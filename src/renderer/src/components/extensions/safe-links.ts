import { getAPI } from '../../../../shared/electron-api'

/**
 * Shared handling for links that rendered content can produce.
 *
 * Anchors emitted by the live-preview widgets (table cells) and by the AI
 * panel are not matched by the syntax-tree handler in `link-click.ts`, which
 * only understands links the parser knows about. Left alone they would be
 * top-level navigations, and the preload re-exposes the full IPC bridge on
 * whatever origin the renderer lands on. So every such anchor is intercepted
 * and handed to the main process, which owns the protocol allowlist.
 */

const MODIFIED_CLICK = new Set([1, 2, 4, 8, 16])

/**
 * True when this is a plain left click with no modifier that would make the
 * user expect the browser to take over (new tab, new window, download).
 */
export function isPlainLeftClick(event: MouseEvent): boolean {
  return (
    event.button === 0 && !MODIFIED_CLICK.has(event.buttons) && !event.ctrlKey && !event.metaKey
  )
}

/** The nearest anchor at or above `node`, if the click landed inside one. */
export function anchorAt(node: EventTarget | null): HTMLAnchorElement | null {
  if (!(node instanceof Element)) return null
  const anchor = node.closest('a')
  if (!(anchor instanceof HTMLAnchorElement)) return null
  return anchor.hasAttribute('href') ? anchor : null
}

export async function openLinkExternally(url: string): Promise<void> {
  const api = getAPI()
  if (!api) return
  try {
    await api.shell.openExternal(url)
  } catch (e) {
    console.error('Failed to open link:', e)
  }
}

/**
 * Build a capture-phase click handler for anchors inside `root`. Capture phase
 * is required: widget DOM sits below CodeMirror's own handlers, so a
 * stopPropagation further down would otherwise let the navigation through.
 */
export function createLinkInterceptor(root: () => Node | null): (event: MouseEvent) => void {
  return (event: MouseEvent) => {
    if (event.defaultPrevented) return
    if (!isPlainLeftClick(event)) return
    const host = root()
    const target = event.target
    if (!host || !(target instanceof Node) || !host.contains(target)) return
    const anchor = anchorAt(target)
    if (!anchor) return
    const href = anchor.getAttribute('href')
    if (!href) return
    event.preventDefault()
    event.stopPropagation()
    void openLinkExternally(href)
  }
}
