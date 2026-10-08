import type { LitElement, ReactiveController } from 'lit'
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
import { FileState } from '../state/file-state'
import { placeTab } from '../state/tab-order'
import type { TabDestination } from '../state/tab-order'
import { reducedMotionNow } from '../utils/motion'
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
  private groupBefore: string | null = null
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
                  node.matches('button,input,select,textarea,.group-chevron,[data-no-drag]')
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
        overlay.textContent =
          this.fileState.getState().tabGroups?.find((g) => g.id === this.source?.id)?.label ??
          'Group'
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
      const before = this.groupBefore
      this.suppressedUntil = performance.now() + 150
      if (this.announcement)
        this.announcement.textContent = event.canceled ? 'Tab drag canceled.' : 'Tab order updated.'
      this.clear()
      if (!event.canceled && source) {
        if (source.kind === 'tab' && destination) this.fileState.dropTab(source.id, destination)
        else if (
          source.kind === 'group' &&
          this.container &&
          this.point.x >= this.container.getBoundingClientRect().left &&
          this.point.x <= this.container.getBoundingClientRect().right &&
          this.point.y >= this.container.getBoundingClientRect().top &&
          this.point.y <= this.container.getBoundingClientRect().bottom
        ) {
          const groups = this.fileState.getState().tabGroups ?? []
          const from = groups.findIndex((g) => g.id === source.id)
          const remaining = groups.filter((g) => g.id !== source.id)
          const to = before ? remaining.findIndex((g) => g.id === before) : remaining.length
          if (from >= 0 && to >= 0) this.fileState.reorderTabGroups(from, to)
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
      this.groupBefore = null
      for (const entry of this.entries.values()) entry.element.removeAttribute('data-drop-target')
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
      this.groupBefore =
        candidates.find((entry) => position < (geometry(entry).start + geometry(entry).end) / 2)
          ?.id ?? null
      return
    }
    const hoveredGroup = [...this.entries.values()].find((entry) => {
      const box = geometry(entry)
      return entry.kind === 'group' && position >= box.start && position <= box.end
    })
    const before = candidates.find(
      (entry) => position < (geometry(entry).start + geometry(entry).end) / 2
    )
    const anchor = before ?? candidates.at(-1)
    let next: TabDestination | null = null
    if (hoveredGroup) next = { section: 'group', groupId: hoveredGroup.id }
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
    for (const entry of this.entries.values()) entry.element.removeAttribute('data-drop-target')
    ;(hoveredGroup ?? anchor)?.element.setAttribute('data-drop-target', '')
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

  private clear(): void {
    cancelAnimationFrame(this.frame)
    this.overlay?.remove()
    this.overlay = null
    for (const entry of this.entries.values()) {
      this.animations.get(entry.element)?.cancel()
      entry.element.style.removeProperty('transform')
      entry.element.style.removeProperty('opacity')
      entry.element.removeAttribute('data-drop-target')
    }
    this.animations.clear()
    this.source = null
    this.destination = null
    this.groupBefore = null
  }
}
