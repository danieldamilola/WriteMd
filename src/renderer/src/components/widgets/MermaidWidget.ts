import { WidgetType, EditorView } from '@codemirror/view'
import mermaid from 'mermaid'

export class MermaidWidget extends WidgetType {
  private id: string
  
  constructor(public codeContent: string) {
    super()
    this.id = 'mermaid-' + Math.random().toString(36).substring(2, 11)
  }

  eq(other: MermaidWidget) {
    return other.codeContent === this.codeContent
  }

  toDOM(_view: EditorView): HTMLElement {
    const container = document.createElement('div')
    container.className = 'cm-mermaid-widget'
    container.style.display = 'flex'
    container.style.justifyContent = 'center'
    container.style.padding = '10px'
    container.style.background = 'var(--bg-secondary)'
    container.style.borderRadius = '6px'
    container.style.marginTop = '10px'
    container.style.marginBottom = '10px'
    container.style.cursor = 'pointer'
    container.style.userSelect = 'none'

    const renderSpan = document.createElement('div')
    renderSpan.id = this.id
    container.appendChild(renderSpan)

    try {
      mermaid.render(this.id + '-svg', this.codeContent).then((result) => {
        renderSpan.innerHTML = result.svg
      }).catch(err => {
        renderSpan.innerText = 'Mermaid Error: ' + err.message
        renderSpan.style.color = '#ff6b6b'
      })
    } catch (err: any) {
      renderSpan.innerText = 'Mermaid Error: ' + err.message
      renderSpan.style.color = '#ff6b6b'
    }

    return container
  }

  ignoreEvent() {
    return false
  }
}
