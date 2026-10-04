/**
 * Overlay-style scrollbars: thumbs stay invisible until the user scrolls a
 * pane, then fade back out when it goes idle.
 *
 * Scroll events are not composed, so a listener on `document` never sees them
 * from inside a shadow tree, and every pane in this app lives in one
 * (including CodeMirror's, nested inside `writemd-editor`). Each root instead
 * gets one capturing listener: capture does not require bubbling, so a root
 * listener still sees scrolls from any descendant at any depth. Roots are
 * picked up as they are created, since panes mount long after startup.
 *
 * The visible side is pure CSS (`scrollbarStyles`, the CodeMirror theme, and
 * the global stylesheet all key off `.is-scrolling`); this module only owns the
 * class and its idle timer.
 */
const VISIBLE_MS = 900

const timers = new WeakMap<Element, number>()
const roots = new Set<Document | ShadowRoot>()

function onScroll(event: Event): void {
  const target = event.target
  if (!(target instanceof Element)) return
  target.classList.add('is-scrolling')
  const prev = timers.get(target)
  if (prev !== undefined) window.clearTimeout(prev)
  timers.set(
    target,
    window.setTimeout(() => {
      target.classList.remove('is-scrolling')
      timers.delete(target)
    }, VISIBLE_MS)
  )
}

function attachRoot(root: Document | ShadowRoot): void {
  if (roots.has(root)) return
  roots.add(root)
  root.addEventListener('scroll', onScroll, true)
}

/** Roots that existed before init need their listener retrofitted. */
function adoptExistingRoots(root: Document | ShadowRoot): void {
  attachRoot(root)
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.shadowRoot) adoptExistingRoots(el.shadowRoot)
  }
}

/**
 * Panes mount after this module runs, so a scan at startup cannot reach their
 * shadow roots. Intercepting shadow attachment is what makes coverage total.
 */
function patchAttachShadow(): () => void {
  const proto = Element.prototype as Element & {
    attachShadow: (init: ShadowRootInit) => ShadowRoot
    __writemdScrollbarPatched?: boolean
  }
  if (proto.__writemdScrollbarPatched) return () => undefined
  proto.__writemdScrollbarPatched = true
  const original = proto.attachShadow
  proto.attachShadow = function (this: Element, init: ShadowRootInit): ShadowRoot {
    const root = original.call(this, init)
    attachRoot(root)
    return root
  }
  return () => {
    proto.attachShadow = original
    delete proto.__writemdScrollbarPatched
  }
}

/** Start auto-hiding; the returned teardown detaches every root listener. */
export function initAutoHideScrollbars(root: Document = document): () => void {
  const restoreAttachShadow = patchAttachShadow()
  adoptExistingRoots(root)
  return () => {
    restoreAttachShadow()
    for (const r of roots) r.removeEventListener('scroll', onScroll, true)
    roots.clear()
  }
}