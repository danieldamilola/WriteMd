import { WidgetType, EditorView } from '@codemirror/view'
import katex from 'katex'

export class MathWidget extends WidgetType {
  constructor(
    readonly content: string,
    readonly isBlock: boolean
  ) {
    super()
  }

  eq(other: MathWidget): boolean {
    return other.content === this.content && other.isBlock === this.isBlock
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span')
    span.className = this.isBlock ? 'cm-live-math cm-live-math-block' : 'cm-live-math'
    
    const renderContainer = document.createElement('span')
    renderContainer.className = 'cm-math-render'
    
    try {
      katex.render(this.content, renderContainer, {
        displayMode: this.isBlock,
        throwOnError: false,
        errorColor: '#ff6b6b'
      })
    } catch (e) {
      renderContainer.textContent = `[Math Error] ${this.content}`
    }
    
    span.appendChild(renderContainer)

    if (this.isBlock) {
      const copyBtn = document.createElement('button')
      copyBtn.className = 'cm-math-copy-btn'
      copyBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`
      copyBtn.onclick = (e) => {
        e.preventDefault()
        e.stopPropagation()
        navigator.clipboard.writeText(this.content)
        copyBtn.style.color = 'var(--success)'
        setTimeout(() => { copyBtn.style.color = '' }, 2000)
      }
      span.appendChild(copyBtn)
    }

    return span
  }

  ignoreEvent(event: Event): boolean {
    // Only allow clicks on the copy button to propagate
    if (event.type === 'mousedown') {
      const target = event.target as HTMLElement
      if (target.closest('.cm-math-copy-btn')) return false
    }
    // We want clicks to select the math and reveal source, so we let the editor handle clicks
    return false
  }
}
