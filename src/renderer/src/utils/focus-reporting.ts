import { EditorView } from '@codemirror/view'

/**
 * CodeMirror's focus check, corrected for an app that lives in a shadow tree.
 *
 * Upstream:
 *
 *   get hasFocus() {
 *     return (this.dom.ownerDocument.hasFocus() || <safari context menu kludge>)
 *       && this.root.activeElement == this.contentDOM
 *   }
 *
 * Two things have to hold. In the split pane only the second one did: the
 * editor's shadow root really did report the secondary view's contentDOM as its
 * active element, while `document.hasFocus()` came back false. With `hasFocus`
 * false, CodeMirror treats the view as dormant - it stops writing the browser's
 * caret after a click, so its state selection and the visible caret drift
 * apart. Typing still looked right because the browser applies those
 * characters at the caret, but Enter, Backspace and the arrow keys all ran
 * against the stale selection, which sat at position 0.
 *
 * Whether `document.hasFocus()` is honest is the window manager's business, and
 * it is not something an editor should let decide where its own caret is. The
 * element being the active element of the root that contains it is the fact
 * that matters, so that is what this reports, walking up the shadow chain so a
 * nested editor still sees itself.
 */
function activeIn(root: Document | ShadowRoot, content: HTMLElement): boolean {
  const active = root.activeElement
  if (!active) return false
  return active === content || content.contains(active)
}

function hasFocus(this: EditorView): boolean {
  let root = this.contentDOM.getRootNode() as Document | ShadowRoot
  // Closest scope first, then every host above it. Bounded because a malformed
  // DOM could in theory cycle, and this runs on every selection update.
  for (let depth = 0; depth < 8; depth++) {
    if (activeIn(root, this.contentDOM)) return true
    // `host` is what distinguishes a shadow root, and reading the property keeps
    // this off the `ShadowRoot` global. An `instanceof` against it throws a
    // ReferenceError wherever that global is not defined, which takes the whole
    // focus check down rather than merely answering it wrongly.
    const host = (root as ShadowRoot).host
    if (!host) break
    const hostRoot = host.getRootNode()
    if (hostRoot === root) break
    root = hostRoot as Document | ShadowRoot
  }
  return false
}

let installed = false

/** Idempotent, and a no-op if CodeMirror ever ships a different shape here. */
export function installFocusReportingFix(): void {
  if (installed) return
  const descriptor = Object.getOwnPropertyDescriptor(EditorView.prototype, 'hasFocus')
  if (!descriptor?.get) return
  installed = true
  Object.defineProperty(EditorView.prototype, 'hasFocus', {
    ...descriptor,
    get: hasFocus
  })
}
