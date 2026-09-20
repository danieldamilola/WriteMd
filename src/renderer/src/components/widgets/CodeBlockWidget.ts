import { WidgetType, EditorView } from '@codemirror/view'

export class CodeBlockWidget extends WidgetType {
  constructor(
    readonly language: string,
    readonly codeContent: string
  ) {
    super()
  }

  eq(other: CodeBlockWidget): boolean {
    return other.language === this.language && other.codeContent === this.codeContent
  }

  toDOM(_view: EditorView): HTMLElement {
    const container = document.createElement('div')
    container.className = 'cm-live-code-header'
    container.style.display = 'flex'
    container.style.justifyContent = 'space-between'
    container.style.alignItems = 'center'
    container.style.padding = '4px 12px'
    container.style.background = 'var(--bg-elevated)'
    container.style.borderTopLeftRadius = '6px'
    container.style.borderTopRightRadius = '6px'
    container.style.border = '1px solid var(--border-subtle)'
    container.style.borderBottom = 'none'
    container.style.userSelect = 'none'
    
    // Language picker (simplified to just display for now, could be a select later)
    const langSpan = document.createElement('span')
    langSpan.className = 'cm-code-lang'
    langSpan.textContent = this.language || 'text'
    langSpan.style.fontSize = '12px'
    langSpan.style.color = 'var(--text-muted)'
    langSpan.style.fontFamily = 'var(--font-mono)'
    langSpan.style.fontWeight = '500'
    
    // Copy button
    const copyBtn = document.createElement('button')
    copyBtn.className = 'cm-code-copy-btn'
    copyBtn.style.background = 'transparent'
    copyBtn.style.border = 'none'
    copyBtn.style.color = 'var(--text-muted)'
    copyBtn.style.cursor = 'pointer'
    copyBtn.style.padding = '4px'
    copyBtn.style.borderRadius = '4px'
    copyBtn.style.display = 'flex'
    copyBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`
    
    copyBtn.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      navigator.clipboard.writeText(this.codeContent)
      copyBtn.style.color = 'var(--success)'
      setTimeout(() => { copyBtn.style.color = 'var(--text-muted)' }, 2000)
    }

    copyBtn.onmouseenter = () => { copyBtn.style.color = 'var(--text)' }
    copyBtn.onmouseleave = () => { copyBtn.style.color = 'var(--text-muted)' }

    container.appendChild(langSpan)
    container.appendChild(copyBtn)
    
    return container
  }

  ignoreEvent(event: Event): boolean {
    if (event.type === 'mousedown') {
      const target = event.target as HTMLElement
      if (target.closest('.cm-code-copy-btn')) return false
    }
    return true
  }
}
