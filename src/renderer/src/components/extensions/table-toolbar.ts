import { EditorView, showTooltip, type Tooltip } from '@codemirror/view'
import { StateField, EditorState } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { SettingsStore } from '../../state/settings'

export interface TableToolbarOffset {
  x: number
  y: number
}

const OFFSET_KEY = 'editor.tableToolbarOffset'

/**
 * Per-editor drag offsets. CodeMirror anchors the toolbar above the table, which
 * puts it under the document title on a short table and outside the reading
 * column on a wide one, so it has to be movable. Keyed by view because the two
 * split panes are independent surfaces and dragging one must not teleport the
 * other.
 */
const offsetsByView = new WeakMap<EditorView, TableToolbarOffset>()

function isOffset(value: unknown): value is TableToolbarOffset {
  if (typeof value !== 'object' || value === null) return false
  const { x, y } = value as Record<string, unknown>
  return Number.isFinite(x) && Number.isFinite(y)
}

function readSharedOffset(): TableToolbarOffset {
  const stored = SettingsStore.getInstance().get<unknown>(OFFSET_KEY, { x: 0, y: 0 })
  return isOffset(stored) ? { x: stored.x, y: stored.y } : { x: 0, y: 0 }
}

export function toolbarOffsetFor(view: EditorView): TableToolbarOffset {
  return offsetsByView.get(view) ?? readSharedOffset()
}

interface Anchor {
  /** Where CodeMirror put the toolbar, with no offset applied. */
  left: number
  top: number
  width: number
  height: number
}

const TRANSLATE = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\s*\)/

/**
 * The offset currently painted on the toolbar, read back off the element rather
 * than from the store. The two disagree the moment a clamp trims the position,
 * and only the painted one is true.
 */
function appliedOffset(dom: HTMLElement): TableToolbarOffset {
  const match = TRANSLATE.exec(dom.style.transform)
  return match ? { x: Number(match[1]), y: Number(match[2]) } : { x: 0, y: 0 }
}

/**
 * CodeMirror's placement: the rendered box with the painted offset backed out.
 *
 * This cannot be recovered from the store, and it cannot be recomputed from the
 * rect after a clamp has moved the toolbar. The rect then reports the clamped
 * position, so backing a clamped offset out of it drifts — which once made the
 * clamp re-base itself and cancel its own correction on the next pass.
 */
function readAnchor(dom: HTMLElement): Anchor {
  const box = dom.getBoundingClientRect()
  const offset = appliedOffset(dom)
  return {
    left: box.left - offset.x,
    top: box.top - offset.y,
    width: box.width,
    height: box.height
  }
}

/**
 * Keep the toolbar inside the editor it belongs to. `view.dom` is the pane, so
 * one clamp covers both layouts: the vertical tab rail and the horizontal strip
 * differ only in how tall the pane is, and the pane is what is measured.
 */
function clampOffset(
  view: EditorView,
  anchor: Anchor,
  offset: TableToolbarOffset
): TableToolbarOffset {
  const host = view.dom.getBoundingClientRect()
  const minX = host.left - anchor.left
  const maxX = host.right - anchor.width - anchor.left
  const minY = host.top - anchor.top
  const maxY = host.bottom - anchor.height - anchor.top
  return {
    x: Math.min(Math.max(offset.x, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(offset.y, minY), Math.max(minY, maxY))
  }
}

/** How far the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 4

function applyOffset(dom: HTMLElement, offset: TableToolbarOffset): void {
  dom.style.transform =
    offset.x === 0 && offset.y === 0 ? '' : `translate(${offset.x}px, ${offset.y}px)`
}

/**
 * Pull the toolbar back inside its pane, leaving the stored preference alone.
 *
 * CodeMirror anchors the tooltip above its table, and for a table near the top of
 * the document that lands outside the pane — inside the top bar, which is a
 * window drag region, so a press there moves the window and the toolbar never
 * gets the event. Trimming the rendered position rather than the stored value
 * keeps this layout-specific: the pane's height changes with the tab rail and
 * with the window, so what fits now may not fit later.
 *
 * CodeMirror places the tooltip in a measure cycle that may not have run when
 * this is first called, so the check re-arms until the toolbar sits where its
 * anchor says it should, and gives up after a few tries rather than polling.
 */
function clampIntoPane(dom: HTMLElement, view: EditorView, tries = 6): void {
  const box = dom.getBoundingClientRect()
  // CodeMirror parks a tooltip it has not positioned yet at -10000px. Clamping
  // that would fling the toolbar thousands of pixels across the screen, so an
  // off-screen box means "not placed", not "out of bounds".
  const onScreen =
    box.width > 0 &&
    box.height > 0 &&
    box.right > 0 &&
    box.bottom > 0 &&
    box.left < window.innerWidth &&
    box.top < window.innerHeight
  if (onScreen) {
    const offset = appliedOffset(dom)
    const anchor = readAnchor(dom)
    const next = clampOffset(view, anchor, offset)
    const settledLeft = anchor.left + next.x
    const settledTop = anchor.top + next.y
    applyOffset(dom, next)
    // Already where the anchor says it belongs. Anything else means CodeMirror
    // has not finished placing it.
    if (Math.abs(box.left - settledLeft) < 0.5 && Math.abs(box.top - settledTop) < 0.5) return
  }
  if (tries <= 0) return
  // A frame, not a task: CodeMirror places the tooltip in its measure cycle, and
  // a chain of zero-delay timeouts drains long before the next frame arrives —
  // which spent the whole budget while the toolbar was still parked.
  requestAnimationFrame(() => clampIntoPane(dom, view, tries - 1))
}

/**
 * A press anywhere on the toolbar can become a drag; a press that does not move
 * stays a click on whatever was under it. Deciding on movement rather than on
 * which element was hit means the whole bar is a handle, so grabbing it by a
 * button works the same as grabbing the grip — and it is the only way a drag can
 * start while the cursor happens to be over the middle of a 200px toolbar.
 */
function makeDraggable(dom: HTMLElement, view: EditorView): void {
  /** A double-click on a button is the button's own action, twice. */
  const onButton = (e: MouseEvent): boolean =>
    e.target instanceof Element && e.target.closest('button') !== null

  /**
   * The gesture that moved the toolbar also produces a click on the button under
   * the pointer, which would insert a row as a side effect of moving the bar.
   */
  const swallowNextClick = (): void => {
    const swallow = (e: Event): void => {
      e.preventDefault()
      e.stopPropagation()
      dom.removeEventListener('click', swallow, true)
    }
    dom.addEventListener('click', swallow, true)
    // A release outside the window produces no click. Drop the guard on the
    // next press rather than leaving it to eat an unrelated click.
    dom.addEventListener('mousedown', () => dom.removeEventListener('click', swallow, true), {
      once: true
    })
  }

  dom.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    // Keeps the caret in the document. Buttons still get their click: this only
    // cancels focus and selection.
    e.preventDefault()

    // From wherever the toolbar actually is. The store seeds a toolbar; it does
    // not describe it once a clamp has trimmed the position.
    const start = appliedOffset(dom)
    const fromX = e.clientX
    const fromY = e.clientY
    let anchor: Anchor | null = null
    let next = start
    let dragging = false

    const move = (ev: MouseEvent): void => {
      const dx = ev.clientX - fromX
      const dy = ev.clientY - fromY
      if (!dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        dragging = true
        anchor = readAnchor(dom)
        document.body.style.cursor = 'grabbing'
        ev.preventDefault()
      }
      next = clampOffset(view, anchor as Anchor, { x: start.x + dx, y: start.y + dy })
      applyOffset(dom, next)
    }
    const stop = (): void => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', stop)
      document.body.style.cursor = ''
      if (!dragging) return
      swallowNextClick()
      offsetsByView.set(view, next)
      SettingsStore.getInstance().set(OFFSET_KEY, next)
    }

    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', stop)
  })

  dom.addEventListener('dblclick', (e) => {
    if (onButton(e)) return
    const home: TableToolbarOffset = { x: 0, y: 0 }
    offsetsByView.set(view, home)
    applyOffset(dom, home)
    SettingsStore.getInstance().set(OFFSET_KEY, home)
  })
}

function getTableRange(state: EditorState, pos: number): { from: number; to: number } | null {
  const tree = ensureSyntaxTree(state, pos, 100) ?? syntaxTree(state)
  let range: { from: number; to: number } | null = null
  tree.iterate({
    from: pos,
    to: pos,
    enter: (node) => {
      if (node.name === 'Table') {
        range = { from: node.from, to: node.to }
        return false
      }
      return
    }
  })
  return range
}

export function getTableTooltip(state: EditorState): Tooltip | null {
  const pos = state.selection.main.head
  const tableRange = getTableRange(state, pos)
  if (!tableRange) return null

  return {
    pos: tableRange.from,
    above: true,
    strictSide: true,
    arrow: true,
    create: (view: EditorView) => {
      const dom = document.createElement('div')
      dom.className = 'cm-table-toolbar'
      applyOffset(dom, toolbarOffsetFor(view))
      makeDraggable(dom, view)
      setTimeout(() => clampIntoPane(dom, view), 0)

      const grip = document.createElement('span')
      grip.className = 'cm-table-grip'
      grip.setAttribute('role', 'separator')
      grip.setAttribute('aria-label', 'Move table toolbar')
      grip.title = 'Drag to move · Double-click to reset'
      grip.innerHTML =
        '<svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true">' +
        '<circle cx="2" cy="2" r="1.1"/><circle cx="6" cy="2" r="1.1"/>' +
        '<circle cx="2" cy="7" r="1.1"/><circle cx="6" cy="7" r="1.1"/>' +
        '<circle cx="2" cy="12" r="1.1"/><circle cx="6" cy="12" r="1.1"/></svg>'
      dom.appendChild(grip)

      const btnAddRow = document.createElement('button')
      btnAddRow.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Col`
      btnAddRow.title = 'Add Column Right'
      btnAddRow.onclick = (e) => {
        e.preventDefault()
        // Simple append logic: just simulate pressing Enter at the end of the line
        const pos = view.state.selection.main.head
        const line = view.state.doc.lineAt(pos)
        // Check how many pipes
        const pipes = line.text.split('|').length - 1
        const newRow =
          '\n|' +
          Array(Math.max(1, pipes - 1))
            .fill('          ')
            .join('|') +
          '|'
        view.dispatch({
          changes: { from: line.to, insert: newRow },
          selection: { anchor: line.to + 3 }
        })
        view.focus()
      }

      const btnAddCol = document.createElement('button')
      btnAddCol.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Row`
      btnAddCol.title = 'Add Row Below'
      btnAddCol.onclick = (e) => {
        e.preventDefault()
        const tableRange = getTableRange(view.state, view.state.selection.main.head)
        if (!tableRange) return

        const changes: { from: number; insert: string }[] = []
        const doc = view.state.doc
        const startLine = doc.lineAt(tableRange.from)
        const endLine = doc.lineAt(tableRange.to)

        for (let l = startLine.number; l <= endLine.number; l++) {
          const line = doc.line(l)
          // Insert " |" at the end of every line, or " --- |" for the separator
          if (l === startLine.number + 1) {
            changes.push({ from: line.to, insert: ' -------- |' })
          } else {
            changes.push({ from: line.to, insert: '          |' })
          }
        }

        view.dispatch({ changes })
        view.focus()
      }

      const setColumnAlignment = (align: 'left' | 'center' | 'right'): void => {
        const pos = view.state.selection.main.head
        const tableRange = getTableRange(view.state, pos)
        if (!tableRange) return

        const doc = view.state.doc
        const startLine = doc.lineAt(tableRange.from)

        const currentLine = doc.lineAt(pos)
        const prefix = currentLine.text.substring(0, pos - currentLine.from)
        let colIdx = (prefix.match(/\|/g) || []).length - 1
        if (colIdx < 0) colIdx = 0

        const sepLine = doc.line(startLine.number + 1)
        const cells = sepLine.text.split('|')

        let actualColIdx = colIdx
        if (sepLine.text.trim().startsWith('|')) {
          actualColIdx += 1
        }

        if (actualColIdx >= cells.length - 1) return

        let newCell = ' -------- '
        if (align === 'left') newCell = ' :------- '
        if (align === 'center') newCell = ' :------: '
        if (align === 'right') newCell = ' -------: '

        cells[actualColIdx] = newCell
        const newSepText = cells.join('|')

        view.dispatch({
          changes: { from: sepLine.from, to: sepLine.to, insert: newSepText }
        })
        view.focus()
      }

      const btnAlignLeft = document.createElement('button')
      btnAlignLeft.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="15" y1="12" x2="3" y2="12"></line><line x1="17" y1="18" x2="3" y2="18"></line></svg>`
      btnAlignLeft.title = 'Align Left'
      btnAlignLeft.onclick = (e) => {
        e.preventDefault()
        setColumnAlignment('left')
      }

      const btnAlignCenter = document.createElement('button')
      btnAlignCenter.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="19" y1="12" x2="5" y2="12"></line><line x1="19" y1="18" x2="5" y2="18"></line></svg>`
      btnAlignCenter.title = 'Align Center'
      btnAlignCenter.onclick = (e) => {
        e.preventDefault()
        setColumnAlignment('center')
      }

      const btnAlignRight = document.createElement('button')
      btnAlignRight.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="12" x2="9" y2="12"></line><line x1="21" y1="18" x2="7" y2="18"></line></svg>`
      btnAlignRight.title = 'Align Right'
      btnAlignRight.onclick = (e) => {
        e.preventDefault()
        setColumnAlignment('right')
      }

      // We just do a simple Add Row for MVP
      dom.appendChild(btnAddRow)
      dom.appendChild(btnAddCol)
      dom.appendChild(btnAlignLeft)
      dom.appendChild(btnAlignCenter)
      dom.appendChild(btnAlignRight)

      return { dom }
    }
  }
}

export const tableToolbarField = StateField.define<readonly Tooltip[]>({
  create(state) {
    const tooltip = getTableTooltip(state)
    return tooltip ? [tooltip] : []
  },
  update(tooltips, tr) {
    if (!tr.docChanged && !tr.selection) return tooltips
    const tooltip = getTableTooltip(tr.state)
    return tooltip ? [tooltip] : []
  },
  provide: (f) => showTooltip.computeN([f], (state) => state.field(f))
})
