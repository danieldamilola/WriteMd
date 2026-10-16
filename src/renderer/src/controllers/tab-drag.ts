import { render, type LitElement, type ReactiveController } from 'lit'
import {
  DragDropManager,
  Droppable,
  Feedback,
  Accessibility,
  PointerSensor,
  PointerActivationConstraints,
  type DragMoveEvent,
  type DragEndEvent
} from '@dnd-kit/dom'
import { Sortable } from '@dnd-kit/dom/sortable'
import { animate } from 'motion'
import { FileState, isGroupWithin } from '../state/file-state'
import { placeTab } from '../state/tab-order'
import type { TabDestination } from '../state/tab-order'
import { reducedMotionNow } from '../utils/motion'
import { groupRowIcon } from '../components/group-icons'
import type { WriteMdTab } from '../components/Tab'

interface Entry {
  element: HTMLElement
  entity: Sortable | Droppable
  kind: 'tab' | 'group'
  id: string
}

/** One gesture owner for both tab orientations. Lit retains all DOM ownership. */
export class TabDragController implements ReactiveController {
  private manager: DragDropManager | null = null
  private entries = new Map<string, Entry>()
  private source: Entry | null = null
  private destination: TabDestination | null = null
  private groupDestination: { parentId: string | null; beforeId?: string } | null = null
  private overlay: HTMLElement | null = null
  private offset = { x: 0, y: 0 }
  private scrollOrigin = 0
  private rects = new Map<string, DOMRect>()
  private animations = new Map<HTMLElement, ReturnType<typeof animate>>()
  private frame = 0
  private point = { x: 0, y: 0 }
  private suppressedUntil = 0
  private fileState = FileState.getInstance()
  private announcement: HTMLElement | null = null

  constructor(
    private host: LitElement,
    private axis: 'x' | 'y'
  ) {
    host.addController(this)
  }

  get active(): boolean {
    return this.source !== null
  }
  get suppressClick(): boolean {
    return this.active || performance.now() < this.suppressedUntil
  }

  hostUpdated(): void {
    if (typeof PointerEvent === 'undefined') return
    if (!this.manager) this.initialize()
    if (!this.manager || this.active) return
    const elements = this.host.renderRoot.querySelectorAll<HTMLElement>(
      '[data-tab-id], .h-group-pill[data-group-id], .group-header[data-group-id]'
    )
    const present = new Set<string>()
    for (const element of elements) {
      if (!element.getClientRects().length) continue
      const kind = element.dataset.tabId ? 'tab' : 'group'
      const id = element.dataset.tabId ?? element.dataset.groupId!
      const key = `${kind}:${id}`
      present.add(key)
      if (this.entries.get(key)?.element === element) continue
      this.entries.get(key)?.entity.destroy()
      const entity = new Sortable(
        {
          id: key,
          type: kind,
          accept: kind === 'group' ? ['tab', 'group'] : 'tab',
          index: kind === 'tab' ? Number(element.dataset.tabIndex) : 0,
          element,
          plugins: [],
          transition: null
        },
        this.manager
      )
      this.entries.set(key, { element, entity, kind, id })
    }
    for (const [key, entry] of this.entries) {
      if (!present.has(key)) {
        entry.entity.destroy()
        this.entries.delete(key)
      }
    }
  }

  hostDisconnected(): void {
    window.removeEventListener('keydown', this.key, true)
    window.removeEventListener('blur', this.cancel)
    this.announcement?.remove()
    this.announcement = null
    this.cancel()
    this.manager?.destroy()
    this.manager = null
    this.entries.clear()
  }

  cancel = (): void => {
    if (this.active) this.manager?.actions.stop({ canceled: true })
    this.clear()
  }

  private initialize(): void {
    window.addEventListener('keydown', this.key, true)
    window.addEventListener('blur', this.cancel)
    this.announcement = document.createElement('div')
    this.announcement.className = 'sr-only'
    this.announcement.setAttribute('role', 'status')
    this.announcement.setAttribute('aria-live', 'polite')
    document.body.append(this.announcement)
    this.manager = new DragDropManager({
      sensors: [
        PointerSensor.configure({
          activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
          preventActivation: (event) =>
            event
              .composedPath()
              .some(
                (node) =>
                  node instanceof Element &&
                  node.matches('button,input,select,textarea,[data-no-drag]')
              )
        })
      ],
      // Tabs retain their tablist semantics and Alt+Arrow keyboard actions.
      plugins: (defaults) => [
        ...defaults.filter((plugin) => plugin !== Accessibility),
        Feedback.configure({ feedback: 'none', dropAnimation: null })
      ]
    })
    this.manager.monitor.addEventListener('dragstart', (event) => {
      const key = String(event.operation.source?.id)
      this.source = this.entries.get(key) ?? null
      if (!this.source) return
      const { current } = event.operation.position
      this.point = { ...current }
      const rect = this.source.element.getBoundingClientRect()
      this.offset = { x: current.x - rect.left, y: current.y - rect.top }
      this.rects.clear()
      for (const [id, entry] of this.entries)
        this.rects.set(id, entry.element.getBoundingClientRect())
      this.scrollOrigin = this.scrollPosition()
      const overlay = document.createElement('div')
      overlay.className = 'writemd-drag-preview'
      overlay.style.width = `${rect.width}px`
      overlay.style.height = `${rect.height}px`
      const tab = this.source.element.querySelector<WriteMdTab>('writemd-tab')
      if (tab) {
        const clone = document.createElement('writemd-tab')
        Object.assign(clone, {
          label: tab.label,
          dirty: tab.dirty,
          pinned: tab.pinned,
          active: true,
          vertical: tab.vertical,
          showClose: false
        })
        clone.style.width = '100%'
        overlay.append(clone)
      } else {
        // A group drags as its icon and label together, matching the row it
        // came from. A group with no icon set falls back to the folder pair,
        // so the preview is never a bare word.
        const group = this.fileState.getState().tabGroups?.find((g) => g.id === this.source?.id)
        const holder = document.createElement('span')
        holder.className = 'writemd-drag-preview-icon'
        render(groupRowIcon(group ?? { collapsed: false }), holder)
        const name = document.createElement('span')
        name.className = 'writemd-drag-preview-group'
        name.textContent = group?.label ?? 'Group'
        overlay.append(holder, name)
      }
      document.body.append(overlay)
      this.overlay = overlay
      this.source.element.style.opacity = '0.25'
      this.tick()
    })
    this.manager.monitor.addEventListener('dragmove', (event: DragMoveEvent) => {
      this.point = { ...event.operation.position.current }
    })
    this.manager.monitor.addEventListener('dragend', (event: DragEndEvent) => {
      this.point = { ...event.operation.position.current }
      if (!event.canceled) this.updateDestination()
      const source = this.source
      const destination = this.destination
      const groupDestination = this.groupDestination
      this.suppressedUntil = performance.now() + 150
      if (this.announcement)
        this.announcement.textContent = event.canceled ? 'Tab drag canceled.' : 'Tab order updated.'
      this.clear()
      if (!event.canceled && source) {
        if (source.kind === 'tab' && destination) {
          this.fileState.dropTab(source.id, destination)
          this.revealGroup(destination.groupId)
        } else if (source.kind === 'group' && groupDestination) {
          this.fileState.moveTabGroup(
            source.id,
            groupDestination.parentId,
            groupDestination.beforeId
          )
        }
      }
      void this.host.updateComplete.then(() => this.hostUpdated())
    })
  }

  private key = (event: KeyboardEvent): void => {
    if (this.active && event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.cancel()
    }
  }

  private get container(): HTMLElement | null {
    return this.host.renderRoot.querySelector(
      this.axis === 'x' ? '.tab-strip' : '.scroll-container'
    )
  }
  private scrollPosition(): number {
    return this.axis === 'x' ? (this.container?.scrollLeft ?? 0) : (this.container?.scrollTop ?? 0)
  }

  private tick = (): void => {
    if (!this.source) return
    const container = this.container
    // The library's AutoScroller owns edge scrolling, including a stationary pointer.
    if (!container) {
      this.cancel()
      return
    }
    if (this.overlay)
      this.overlay.style.transform = `translate3d(${this.point.x - this.offset.x}px,${this.point.y - this.offset.y}px,0)`
    this.updateDestination()
    this.frame = requestAnimationFrame(this.tick)
  }

  private updateDestination(): void {
    if (!this.source) return
    const bounds = this.container?.getBoundingClientRect()
    if (
      !bounds ||
      this.point.x < bounds.left ||
      this.point.x > bounds.right ||
      this.point.y < bounds.top ||
      this.point.y > bounds.bottom
    ) {
      this.destination = null
      this.groupDestination = null
      for (const entry of this.entries.values()) {
        entry.element.removeAttribute('data-drop-target')
        entry.element.classList.remove('drag-over')
      }
      return
    }
    const delta = this.scrollPosition() - this.scrollOrigin
    const position = this.axis === 'x' ? this.point.x : this.point.y
    const geometry = (entry: Entry): { start: number; end: number } => {
      const rect = this.rects.get(`${entry.kind}:${entry.id}`)!
      return this.axis === 'x'
        ? { start: rect.left - delta, end: rect.right - delta }
        : { start: rect.top - delta, end: rect.bottom - delta }
    }
    const candidates = [...this.entries.values()]
      .filter((entry) => entry.kind === this.source?.kind && entry !== this.source)
      .sort((a, b) => geometry(a).start - geometry(b).start)
    if (this.source.kind === 'group') {
      const groups = this.fileState.getState().tabGroups ?? []
      for (const entry of this.entries.values()) {
        entry.element.removeAttribute('data-drop-target')
        entry.element.classList.remove('drag-over')
      }
      this.groupDestination = null
      const hovered = [...this.entries.values()].find((entry) => {
        const box = geometry(entry)
        return entry.kind === 'group' && position >= box.start && position <= box.end
      })
      if (hovered) {
        if (isGroupWithin(groups, hovered.id, this.source.id)) return
        const box = geometry(hovered)
        const fraction = (position - box.start) / (box.end - box.start)
        if (fraction >= 0.25 && fraction <= 0.75) {
          this.groupDestination = { parentId: hovered.id }
          hovered.element.classList.add('drag-over')
        } else {
          const parentId = groups.find((group) => group.id === hovered.id)?.parentId ?? null
          const siblings = groups.filter(
            (group) => group.id !== this.source?.id && (group.parentId ?? null) === parentId
          )
          const beforeId =
            fraction < 0.5
              ? hovered.id
              : siblings[siblings.findIndex((group) => group.id === hovered.id) + 1]?.id
          this.groupDestination = { parentId, beforeId }
          hovered.element.setAttribute('data-drop-target', '')
        }
      } else {
        const roots = candidates.filter(
          (entry) =>
            !groups.find((group) => group.id === entry.id)?.parentId &&
            !isGroupWithin(groups, entry.id, this.source!.id)
        )
        const beforeId = roots.find((entry) => position < geometry(entry).start)?.id
        this.groupDestination = { parentId: null, beforeId }
        if (beforeId)
          this.entries.get(`group:${beforeId}`)?.element.setAttribute('data-drop-target', '')
      }
      return
    }
    const hoveredGroup = [...this.entries.values()].find((entry) => {
      const box = geometry(entry)
      return entry.kind === 'group' && position >= box.start && position <= box.end
    })
    // A tab's own folder header is not an "into this folder" target. Treating
    // it as one produced a destination with no neighbour, which `placeTab`
    // reads as "append", so hovering your own group silently teleported the
    // tab to the bottom of it. There is nothing to do there, so the header
    // falls through to the ordinary before/after logic and the drop means
    // "reorder me relative to my siblings".
    const intoGroup =
      hoveredGroup && hoveredGroup.id !== this.source.element.dataset.groupId ? hoveredGroup : null
    const before = candidates.find(
      (entry) => position < (geometry(entry).start + geometry(entry).end) / 2
    )
    const anchor = before ?? candidates.at(-1)
    let next: TabDestination | null = null
    if (intoGroup) next = { section: 'group', groupId: intoGroup.id }
    else if (!before && (!anchor || position > geometry(anchor).end + 6))
      next = { section: 'ungrouped' }
    else if (anchor)
      next = {
        section:
          anchor.element.dataset.pinned === 'true'
            ? 'pinned'
            : anchor.element.dataset.groupId
              ? 'group'
              : 'ungrouped',
        groupId: anchor.element.dataset.groupId || null,
        ...(before ? { beforeId: before.id } : { afterId: anchor.id })
      }
    if (JSON.stringify(next) === JSON.stringify(this.destination)) return
    this.destination = next
    for (const entry of this.entries.values()) {
      entry.element.removeAttribute('data-drop-target')
      entry.element.classList.remove('drag-over')
    }
    if (intoGroup) {
      // A distinct treatment from the solid insertion outline: hovering a
      // folder means "into it", which is a different gesture from "between
      // these two rows", and reusing the same outline made the two
      // indistinguishable.
      intoGroup.element.classList.add('drag-over')
    } else {
      anchor?.element?.setAttribute('data-drop-target', '')
    }
    const items = [...candidates, this.source].filter((entry) => {
      const source = this.source!
      return (
        entry.element.dataset.pinned === source.element.dataset.pinned &&
        entry.element.dataset.groupId === source.element.dataset.groupId
      )
    })
    const sameZone =
      next &&
      this.source.element.dataset.pinned === String(next.section === 'pinned') &&
      (this.source.element.dataset.groupId || null) === (next.groupId ?? null)
    items.sort((a, b) => geometry(a).start - geometry(b).start)
    const shifts = new Map<string, number>()
    if (sameZone && next && items.length) {
      const order = placeTab(this.fileState.getState().tabs, this.source.id, next).filter((tab) =>
        items.some((entry) => entry.id === tab.id)
      )
      let cursor = geometry(items[0]).start
      const gap =
        items.length > 1 ? Math.max(0, geometry(items[1]).start - geometry(items[0]).end) : 0
      for (const tab of order) {
        const entry = items.find((item) => item.id === tab.id)!
        const box = geometry(entry)
        shifts.set(entry.id, cursor - box.start)
        cursor += box.end - box.start + gap
      }
    }
    for (const entry of candidates) {
      const shift = shifts.get(entry.id) ?? 0
      this.animations.get(entry.element)?.cancel()
      const transform = `translate${this.axis.toUpperCase()}(${shift}px)`
      if (reducedMotionNow()) entry.element.style.transform = transform
      else
        this.animations.set(
          entry.element,
          animate(entry.element, { transform }, { type: 'spring', stiffness: 520, damping: 42 })
        )
    }
  }

  /**
   * Open a folder the tab was just dropped into, if it was closed.
   *
   * A closed folder renders no rows, so committing into one put the tab
   * somewhere the user cannot see and had no way to find. This expands after
   * the drop rather than on hover: `this.rects` is a dragstart snapshot and
   * `hostUpdated` deliberately refuses to re-sync mid-gesture, so growing the
   * list while dragging would shift every row below it out from under the
   * pointer and leave the insertion markers pointing at the wrong places.
   */
  private revealGroup(groupId: string | null | undefined): void {
    if (!groupId) return
    const group = (this.fileState.getState().tabGroups ?? []).find((g) => g.id === groupId)
    if (group?.collapsed) this.fileState.toggleTabGroupCollapse(groupId)
  }

  private clear(): void {
    cancelAnimationFrame(this.frame)
    this.overlay?.remove()
    this.overlay = null
    for (const entry of this.entries.values()) {
      this.animations.get(entry.element)?.cancel()
      entry.element.style.removeProperty('transform')
      entry.element.style.removeProperty('opacity')
      entry.element.removeAttribute('data-drop-target')
      entry.element.classList.remove('drag-over')
    }
    this.animations.clear()
    this.source = null
    this.destination = null
    this.groupDestination = null
  }
}
