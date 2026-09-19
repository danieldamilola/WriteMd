import { WidgetType, EditorView } from '@codemirror/view'

export class TaskCheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('span')
    box.className = `cm-live-list-marker cm-live-task-checkbox${this.checked ? ' cm-live-task-checkbox-checked' : ''}`
    box.setAttribute('role', 'checkbox')
    box.setAttribute('aria-checked', String(this.checked))
    box.setAttribute('contenteditable', 'false')
    box.tabIndex = -1

    if (this.checked) {
      // SVG checkmark
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 12 12')
      svg.setAttribute('fill', 'none')
      svg.style.width = '10px'
      svg.style.height = '10px'
      svg.style.display = 'block'
      svg.style.margin = 'auto'
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', 'M2.5 6L5 8.5L9.5 3.5')
      path.setAttribute('stroke', '#ffffff')
      path.setAttribute('stroke-width', '1.8')
      path.setAttribute('stroke-linecap', 'round')
      path.setAttribute('stroke-linejoin', 'round')
      svg.appendChild(path)
      box.appendChild(svg)
    }

    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    box.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const pos = view.posAtDOM(box)
      if (pos < 0) return
      const current = view.state.doc.sliceString(pos, pos + 3)
      const next = /\[x\]/i.test(current) ? '[ ]' : '[x]'
      if (current === next) return
      view.dispatch({ changes: { from: pos, to: pos + 3, insert: next } })
    })
    return box
  }

  ignoreEvent(event: Event): boolean {
    return event.type === 'mousedown' || event.type === 'click'
  }
}
