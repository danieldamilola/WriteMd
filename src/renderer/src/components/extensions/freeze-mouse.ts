import { StateEffect, StateField } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { readOnlyFacet } from './read-only'

const FREEZE_TAIL_MS = 100
export const setFrozen = StateEffect.define<boolean>()

export const previewFrozenField = StateField.define<boolean>({
  create: () => false,
  update(prev, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFrozen)) return effect.value
    }
    return prev
  }
})

export function linkIconHitTarget(event: MouseEvent, root?: HTMLElement): HTMLElement | null {
  const target = event.target
  if (!(target instanceof Element)) return null
  const linkEl = target.closest<HTMLElement>('.cm-live-link')
  if (!linkEl || (root && !root.contains(linkEl))) return null

  const rects = Array.from(linkEl.getClientRects())
  if (rects.length === 0) return null
  const lastRect = rects[rects.length - 1]
  const emSize = parseFloat(window.getComputedStyle(linkEl).fontSize)
  const iconZone = emSize * 1.5
  const onIcon =
    event.clientX >= lastRect.right - iconZone &&
    event.clientX <= lastRect.right &&
    event.clientY >= lastRect.top &&
    event.clientY <= lastRect.bottom

  return onIcon ? linkEl : null
}

export function linkElementFromEvent(event: MouseEvent, root?: HTMLElement): HTMLElement | null {
  const target = event.target
  if (!(target instanceof Element)) return null
  const linkEl = target.closest<HTMLElement>('.cm-live-link')
  if (!linkEl || (root && !root.contains(linkEl))) return null
  return linkEl
}

export const freezeMousePlugin = ViewPlugin.fromClass(
  class {
    private down = false
    private releaseTimer: number | null = null

    private readonly onDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      if (this.view.state.facet(readOnlyFacet)) return

      const target = event.target
      if (!(target instanceof Node) || !this.view.contentDOM.contains(target)) {
        return
      }
      if (linkIconHitTarget(event, this.view.contentDOM)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }

      this.down = true
      if (this.releaseTimer != null) {
        window.clearTimeout(this.releaseTimer)
        this.releaseTimer = null
      }
      if (!this.view.state.field(previewFrozenField)) {
        this.view.dispatch({ effects: setFrozen.of(true) })
      }
    }

    private readonly onUp = (): void => {
      if (!this.down) return
      this.down = false
      if (this.releaseTimer != null) window.clearTimeout(this.releaseTimer)
      this.releaseTimer = window.setTimeout(() => {
        this.releaseTimer = null
        if (!this.view.state.field(previewFrozenField)) return
        try {
          this.view.dispatch({ effects: setFrozen.of(false) })
        } catch {
          // view destroyed
        }
      }, FREEZE_TAIL_MS)
    }

    constructor(readonly view: EditorView) {
      view.dom.addEventListener('pointerdown', this.onDown, true)
      window.addEventListener('pointerup', this.onUp)
      window.addEventListener('pointercancel', this.onUp)
    }

    update(): void {
      /* no per-update behavior; listeners are event-driven */
    }

    destroy(): void {
      this.view.dom.removeEventListener('pointerdown', this.onDown, true)
      window.removeEventListener('pointerup', this.onUp)
      window.removeEventListener('pointercancel', this.onUp)
      if (this.releaseTimer != null) window.clearTimeout(this.releaseTimer)
    }
  }
)
