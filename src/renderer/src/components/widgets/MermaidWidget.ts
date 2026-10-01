import { WidgetType } from '@codemirror/view'
import mermaid from 'mermaid'
import { createLinkInterceptor } from '../extensions/safe-links'

// Diagram source is raw fenced-block content from disk, and the rendered SVG is
// assigned to innerHTML below. `strict` is the only level that runs DOMPurify
// over mermaid's output, and it is also the only level that does not enable
// click handlers inside the diagram. Stated here rather than inherited from a
// library default so the property is greppable and survives a version bump.
mermaid.initialize({ securityLevel: 'strict', startOnLoad: false })

export class MermaidWidget extends WidgetType {
  private id: string

  constructor(public codeContent: string) {
    super()
    this.id = 'mermaid-' + Math.random().toString(36).substring(2, 11)
  }

  eq(other: MermaidWidget): boolean {
    return other.codeContent === this.codeContent
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'cm-mermaid-widget'
    container.style.display = 'flex'
    container.style.justifyContent = 'center'
    container.style.padding = '16px'
    container.style.background = 'var(--code-bg)'
    container.style.border = '1px solid var(--border-subtle)'
    container.style.borderRadius = '6px'
    container.style.margin = '8px 0'
    container.style.cursor = 'pointer'
    container.style.userSelect = 'none'

    // Anchors mermaid emits for node links would otherwise navigate the
    // window. Scoped to this widget's own container, not the document.
    container.addEventListener('click', createLinkInterceptor(() => container) as EventListener, {
      capture: true
    })

    const renderSpan = document.createElement('div')
    renderSpan.id = this.id
    container.appendChild(renderSpan)

    try {
      mermaid
        .render(this.id + '-svg', this.codeContent)
        .then((result) => {
          renderSpan.innerHTML = result.svg
        })
        .catch((err: unknown) => {
          renderSpan.innerText =
            'Mermaid Error: ' + (err instanceof Error ? err.message : String(err))
          renderSpan.style.color = '#ff6b6b'
        })
    } catch (err: unknown) {
      renderSpan.innerText = 'Mermaid Error: ' + (err instanceof Error ? err.message : String(err))
      renderSpan.style.color = '#ff6b6b'
    }

    return container
  }

  ignoreEvent(): boolean {
    return false
  }
}
