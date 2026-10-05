import { describe, it, expect, beforeEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import {
  tableToolbarField,
  toolbarOffsetFor
} from '../src/renderer/src/components/extensions/table-toolbar'
import { SettingsStore } from '../src/renderer/src/state/settings'

/**
 * CodeMirror anchors the table toolbar above the table it belongs to. On a
 * short table that lands it over the document title; on a wide table it lands
 * outside the reading column. It had no way to move, so these cases pin that it
 * now does: the grip drags it, buttons keep their clicks, the drag stays inside
 * the editor it belongs to, and the two split panes do not share a position.
 */

const DOC = ['# Notes', '', '| Feature | Parser |', '| --- | --- |', '| Tables | yes |'].join('\n')

interface Box {
  left: number
  top: number
  width: number
  height: number
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect
}

/**
 * jsdom implements no layout for text, and CodeMirror positions a tooltip by
 * calling getClientRects on a text node mid-measure. Without these the measure
 * throws and the toolbar never reaches the DOM, so nothing below can run.
 */
function stubTextRects(): void {
  const emptyRects = (): DOMRectList =>
    Object.assign([] as DOMRect[], { item: () => null }) as unknown as DOMRectList
  for (const [target, key, value] of [
    [Range.prototype, 'getClientRects', emptyRects],
    [Text.prototype, 'getClientRects', emptyRects],
    [Text.prototype, 'getBoundingClientRect', () => rect(0, 0, 0, 0)]
  ] as const) {
    Object.defineProperty(target, key, { value, configurable: true })
  }
}

stubTextRects()

const TRANSLATE = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\s*\)/

/**
 * jsdom has no layout, so every box is 0x0 at the origin and the clamp would
 * never be exercised. The stated box is returned offset by whatever transform is
 * currently applied, which is what a real getBoundingClientRect does.
 */
function stubBox(el: Element, box: Box): void {
  el.getBoundingClientRect = () => {
    const match = TRANSLATE.exec((el as HTMLElement).style.transform)
    const dx = match ? Number(match[1]) : 0
    const dy = match ? Number(match[2]) : 0
    return rect(box.left + dx, box.top + dy, box.width, box.height)
  }
}

/** jsdom has no layout, so every box is 0x0 at the origin. */
/**
 * jsdom has no layout, so every box is 0x0 at the origin. This states one for
 * the toolbar only, offset by whatever transform is currently applied, which is
 * what a real getBoundingClientRect does. It is installed on the prototype
 * because the clamp reads the box on a task of its own, before a test that
 * queried the element could get a chance to stub it.
 */
function stubToolbarBox(box: Box): () => void {
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    if (!this.classList.contains('cm-table-toolbar')) return original.call(this)
    const match = TRANSLATE.exec((this as HTMLElement).style.transform)
    const dx = match ? Number(match[1]) : 0
    const dy = match ? Number(match[2]) : 0
    return rect(box.left + dx, box.top + dy, box.width, box.height)
  }
  return () => {
    Element.prototype.getBoundingClientRect = original
  }
}

/** One frame, so CodeMirror's measure cycle can run. */
async function frame(): Promise<void> {
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  await new Promise((r) => setTimeout(r, 0))
}

/** Long enough for the deferred clamp, and its re-checks, to have run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0))
  await frame()
}

async function makeView(doc = DOC, boxes?: { pane?: Box; bar?: Box }): Promise<EditorView> {
  const restore = boxes?.bar ? stubToolbarBox(boxes.bar) : null
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: 14 },
      extensions: [markdown({ extensions: [GFM] }), tableToolbarField]
    }),
    parent
  })
  if (boxes?.pane) stubBox(view.dom, boxes.pane)
  await frame()
  if (boxes?.bar) stubBox(toolbarIn(view), boxes.bar)
  await settle()
  restore?.()
  return view
}

function toolbarIn(view: EditorView): HTMLElement {
  const el = view.dom.querySelector('.cm-table-toolbar')
  if (!el) throw new Error('table toolbar did not render')
  return el as HTMLElement
}

/**
 * jsdom will not synthesise a MouseEvent from a dispatched Event, and it has no
 * layout to derive coordinates from, so the events are built with explicit
 * client positions.
 */
function mouse(type: string, x: number, y: number, target: EventTarget): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y
  })
  target.dispatchEvent(event)
  return event
}

function drag(from: Element, dx: number, dy: number): void {
  const box = from.getBoundingClientRect()
  const x0 = box.left + 2
  const y0 = box.top + 2
  mouse('mousedown', x0, y0, from)
  // Two moves: the second one reads the box the first one already moved.
  mouse('mousemove', x0 + dx / 2, y0 + dy / 2, document)
  mouse('mousemove', x0 + dx, y0 + dy, document)
  mouse('mouseup', x0 + dx, y0 + dy, document)
}

function click(target: Element): void {
  const box = target.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  mouse('mousedown', x, y, target)
  mouse('mouseup', x, y, target)
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('table toolbar drag', () => {
  let view: EditorView

  beforeEach(() => {
    SettingsStore.getInstance().set('editor.tableToolbarOffset', { x: 0, y: 0 })
  })

  it('renders a labelled grip ahead of the buttons', async () => {
    view = await makeView()
    const grip = view.dom.querySelector('.cm-table-grip')
    expect(grip).not.toBeNull()
    expect(grip!.getAttribute('aria-label')).toBe('Move table toolbar')
    expect(grip!.firstElementChild!.tagName.toLowerCase()).toBe('svg')
    // The grip is the first child, so the buttons keep their reading order.
    expect(grip!.nextElementSibling?.tagName.toLowerCase()).toBe('button')
    view.destroy()
  })

  it('moves the toolbar with the pointer and keeps the offset', async () => {
    view = await makeView()
    const dom = toolbarIn(view)
    stubBox(view.dom, { left: 0, top: 0, width: 800, height: 600 })
    stubBox(dom, { left: 300, top: 200, width: 180, height: 30 })

    drag(dom, 40, 25)

    expect(dom.style.transform).toBe('translate(40px, 25px)')
    expect(toolbarOffsetFor(view)).toEqual({ x: 40, y: 25 })
    expect(SettingsStore.getInstance().get('editor.tableToolbarOffset', null)).toEqual({
      x: 40,
      y: 25
    })
    view.destroy()
  })

  /**
   * The pane is a different height depending on whether the tab bar is a strip
   * across the top or a rail down the side, so the clamp is measured against the
   * pane, not the window.
   */
  it('stops the toolbar at the top-left edge of the pane', async () => {
    view = await makeView()
    const dom = toolbarIn(view)
    stubBox(view.dom, { left: 100, top: 50, width: 800, height: 600 })
    stubBox(dom, { left: 300, top: 200, width: 180, height: 30 })

    drag(dom, -900, -900)

    // Pane left is 100 and the bar is 180 wide, so -200 parks its left edge on
    // the pane edge; pane top 50 with the bar 200 down gives -150.
    expect(toolbarOffsetFor(view)).toEqual({ x: -200, y: -150 })
    expect(dom.style.transform).toBe('translate(-200px, -150px)')
    view.destroy()
  })

  it('stops the toolbar at the bottom-right edge of the pane', async () => {
    view = await makeView()
    const dom = toolbarIn(view)
    stubBox(view.dom, { left: 100, top: 50, width: 800, height: 600 })
    stubBox(dom, { left: 300, top: 200, width: 180, height: 30 })

    drag(dom, 5000, 5000)

    expect(toolbarOffsetFor(view)).toEqual({ x: 420, y: 420 })
    view.destroy()
  })

  it('drags from the painted position, not the stored one', async () => {
    // The clamp above leaves the toolbar painted 5px down from where
    // CodeMirror anchored it. A drag has to continue from what the user can see,
    // or the toolbar snaps back to the stored offset the moment it is grabbed.
    view = await makeView(DOC, {
      pane: { left: 213, top: 40, width: 982, height: 755 },
      bar: { left: 330, top: 35, width: 215, height: 30 }
    })
    const dom = toolbarIn(view)
    expect(dom.style.transform).toBe('translate(0px, 5px)')

    drag(dom, 60, 20)

    expect(dom.style.transform).toBe('translate(60px, 25px)')
    expect(toolbarOffsetFor(view)).toEqual({ x: 60, y: 25 })
    view.destroy()
  })

  it('leaves the other split pane where it was', async () => {
    view = await makeView()
    const other = await makeView()
    const dom = toolbarIn(view)
    const otherDom = toolbarIn(other)
    stubBox(view.dom, { left: 0, top: 0, width: 800, height: 600 })
    stubBox(other.dom, { left: 0, top: 0, width: 800, height: 600 })
    stubBox(dom, { left: 300, top: 200, width: 180, height: 30 })

    drag(dom, 40, 25)

    expect(toolbarOffsetFor(view)).toEqual({ x: 40, y: 25 })
    expect(dom.style.transform).toBe('translate(40px, 25px)')
    // The neighbouring pane was already on screen at its own place; dragging one
    // toolbar must not jump the other one across the split.
    expect(otherDom.style.transform).toBe('')
    view.destroy()
    other.destroy()
  })

  /**
   * The whole bar is a handle now, so a press that starts on a button drags when
   * the pointer moves and clicks when it does not. Deciding on movement is the
   * only way this works when the pointer lands mid-toolbar, which is where it
   * usually lands.
   */
  it('drags from a press that starts on a button', async () => {
    view = await makeView()
    const dom = toolbarIn(view)
    stubBox(view.dom, { left: 0, top: 0, width: 800, height: 600 })
    stubBox(dom, { left: 300, top: 200, width: 180, height: 30 })

    const button = dom.querySelector('button') as HTMLButtonElement
    let clicks = 0
    button.addEventListener('click', () => clicks++)

    drag(button, 60, 30)

    expect(toolbarOffsetFor(view)).toEqual({ x: 60, y: 30 })
    // The gesture also produces a click on the button under the pointer, which
    // would insert a row as a side effect of moving the toolbar.
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clicks).toBe(0)
    view.destroy()
  })

  it('still clicks when the press does not move', async () => {
    view = await makeView()
    const dom = toolbarIn(view)
    stubBox(view.dom, { left: 0, top: 0, width: 800, height: 600 })
    stubBox(dom, { left: 300, top: 200, width: 180, height: 30 })

    const button = dom.querySelector('button') as HTMLButtonElement
    let clicks = 0
    button.addEventListener('click', () => clicks++)

    click(button)

    expect(clicks).toBe(1)
    expect(toolbarOffsetFor(view)).toEqual({ x: 0, y: 0 })
    view.destroy()
  })

  it('ignores a wobble under the drag threshold', async () => {
    view = await makeView()
    const dom = toolbarIn(view)
    stubBox(view.dom, { left: 0, top: 0, width: 800, height: 600 })
    stubBox(dom, { left: 300, top: 200, width: 180, height: 30 })

    const button = dom.querySelector('button') as HTMLButtonElement
    let clicks = 0
    button.addEventListener('click', () => clicks++)

    const x = 302
    const y = 202
    mouse('mousedown', x, y, button)
    mouse('mousemove', x + 2, y + 2, document)
    mouse('mouseup', x + 2, y + 2, document)

    expect(toolbarOffsetFor(view)).toEqual({ x: 0, y: 0 })
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clicks).toBe(1)
    view.destroy()
  })

  /**
   * CodeMirror anchors the toolbar above its table, and for a table near the top
   * of the document that lands outside the pane — over the top bar, which is a
   * window drag region, so a press there moves the window instead.
   */
  it('pulls an out-of-pane anchor back inside on the frame after it appears', async () => {
    // Pane and box taken from the real app in vertical mode with a table at the
    // top of the document: the toolbar anchors 5px above the pane, and the top
    // bar ends at 40, so it spawns inside the window-drag band.
    view = await makeView(DOC, {
      pane: { left: 213, top: 40, width: 982, height: 755 },
      bar: { left: 330, top: 35, width: 215, height: 30 }
    })
    const dom = toolbarIn(view)

    // The stored preference is untouched: it is a distance from CodeMirror's
    // anchor and the pane it has to fit changes with the layout.
    expect(toolbarOffsetFor(view)).toEqual({ x: 0, y: 0 })
    expect(dom.style.transform).toBe('translate(0px, 5px)')
    view.destroy()
  })

  it('keeps the editor focused while dragging', async () => {
    view = await makeView()
    const dom = toolbarIn(view)
    stubBox(view.dom, { left: 0, top: 0, width: 800, height: 600 })
    stubBox(dom, { left: 300, top: 200, width: 180, height: 30 })

    // Default-prevented is what stops the press from moving focus out of the
    // document, which would drop the caret mid-drag.
    const press = mouse('mousedown', 302, 202, dom)
    expect(press.defaultPrevented).toBe(true)
    mouse('mouseup', 302, 202, document)
    view.destroy()
  })

  it('stops listening once the drag is over', async () => {
    view = await makeView()
    const dom = toolbarIn(view)
    stubBox(view.dom, { left: 0, top: 0, width: 800, height: 600 })
    stubBox(dom, { left: 300, top: 200, width: 180, height: 30 })

    drag(dom, 40, 25)
    mouse('mousemove', 900, 900, document)

    expect(toolbarOffsetFor(view)).toEqual({ x: 40, y: 25 })
    expect(document.body.style.cursor).toBe('')
    view.destroy()
  })

  it('double-clicking the grip sends it back to the anchor', async () => {
    view = await makeView()
    const dom = toolbarIn(view)
    stubBox(view.dom, { left: 0, top: 0, width: 800, height: 600 })
    stubBox(dom, { left: 300, top: 200, width: 180, height: 30 })

    drag(dom, 40, 25)
    expect(toolbarOffsetFor(view)).toEqual({ x: 40, y: 25 })

    dom.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    expect(toolbarOffsetFor(view)).toEqual({ x: 0, y: 0 })
    expect(dom.style.transform).toBe('')
    view.destroy()
  })

  it('re-applies a stored offset when the toolbar is rebuilt', async () => {
    SettingsStore.getInstance().set('editor.tableToolbarOffset', { x: 12, y: -8 })
    view = await makeView()
    expect(toolbarOffsetFor(view)).toEqual({ x: 12, y: -8 })
    expect(toolbarIn(view).style.transform).toBe('translate(12px, -8px)')
    view.destroy()
  })

  it('ignores a stored offset that is not a pair of numbers', async () => {
    SettingsStore.getInstance().set('editor.tableToolbarOffset', { x: '20', y: null })
    view = await makeView()
    expect(toolbarOffsetFor(view)).toEqual({ x: 0, y: 0 })
    view.destroy()
  })

  it('offers the drag layer only while the cursor is in a table', async () => {
    view = await makeView()
    expect(view.dom.querySelector('.cm-table-toolbar')).not.toBeNull()

    // Anchor 2 is inside the "# Notes" heading, above the table.
    view.dispatch({ selection: { anchor: 2 } })
    expect(view.state.field(tableToolbarField)).toHaveLength(0)
    view.destroy()
  })
})
