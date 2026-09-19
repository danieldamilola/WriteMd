import { WidgetType } from '@codemirror/view'

export class BulletWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-live-list-marker cm-live-bullet'
    span.textContent = '•'
    return span
  }
  ignoreEvent(): boolean {
    return false
  }
}

export const BULLET_WIDGET = new BulletWidget()
