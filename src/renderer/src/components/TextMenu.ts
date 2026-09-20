import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { EditorView } from '@codemirror/view'
import { menuStyles, menuIcon } from './menu-styles'
import {
  wrapInline,
  clearFormatting,
  toggleLinePrefix,
  stripBlockMarkers,
  tableSkeleton,
  nextFootnoteNumber,
  codeFence,
  mathBlock
} from './text-format'

interface MenuItem {
  id: string
  label: string
  icon: string
  dividerBefore?: boolean
  children?: MenuItem[]
}

const MENU: MenuItem[] = [
  { id: 'add-link', label: 'Add link', icon: 'link' },
  { id: 'add-external-link', label: 'Add external link', icon: 'external' },
  {
    id: 'format',
    label: 'Format',
    icon: 'highlight',
    children: [
      { id: 'bold', label: 'Bold', icon: 'bold' },
      { id: 'italic', label: 'Italic', icon: 'italic' },
      { id: 'strike', label: 'Strikethrough', icon: 'strike' },
      { id: 'highlight', label: 'Highlight', icon: 'highlight' },
      { id: 'code', label: 'Code', icon: 'code' },
      { id: 'math', label: 'Math', icon: 'math' },
      { id: 'comment', label: 'Comment', icon: 'comment' },
      { id: 'clear', label: 'Clear formatting', icon: 'clear' }
    ]
  },
  {
    id: 'paragraph',
    label: 'Paragraph',
    icon: 'paragraph',
    children: [
      { id: 'normal', label: 'Normal text', icon: 'paragraph' },
      { id: 'h1', label: 'Heading 1', icon: 'heading' },
      { id: 'h2', label: 'Heading 2', icon: 'heading' },
      { id: 'h3', label: 'Heading 3', icon: 'heading' },
      { id: 'quote', label: 'Quote', icon: 'quote' }
    ]
  },
  {
    id: 'insert',
    label: 'Insert',
    icon: 'insert',
    children: [
      { id: 'footnote', label: 'Footnote', icon: 'footnote' },
      { id: 'table', label: 'Table', icon: 'table' },
      { id: 'callout', label: 'Callout', icon: 'callout' },
      { id: 'rule', label: 'Horizontal rule', icon: 'rule' },
      { id: 'codeblock', label: 'Code block', icon: 'code' },
      { id: 'mathblock', label: 'Math block', icon: 'math' }
    ]
  },
  { id: 'cut', label: 'Cut', icon: 'cut', dividerBefore: true },
  { id: 'copy', label: 'Copy', icon: 'copy' },
  { id: 'paste', label: 'Paste', icon: 'paste' },
  { id: 'paste-plain', label: 'Paste as plain text', icon: 'paste' },
  { id: 'select-all', label: 'Select all', icon: 'select', dividerBefore: true }
]

@customElement('writemd-text-menu')
export class TextMenu extends LitElement {
  static styles = [
    menuStyles,
    css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 400;
    }
    .submenu {
      display: none;
      position: absolute;
      top: -4px;
      left: 100%;
      margin-left: 4px;
      min-width: 180px;
      background: #141414;
      border: 1px solid #2e2e32;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      padding: 4px;
    }
    .submenu.left {
      left: auto;
      right: 100%;
      margin-left: 0;
      margin-right: 4px;
    }
    .has-sub:hover > .submenu {
      display: block;
    }
  `
  ]

  @property({ type: Number }) x = 0
  @property({ type: Number }) y = 0
  @property({ type: Boolean }) flip = false
  @property({ attribute: false }) view: EditorView | null = null

  connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener('click', this.handleBackdropClick)
    window.addEventListener('keydown', this.handleKeyDown)
  }

  disconnectedCallback(): void {
    this.removeEventListener('click', this.handleBackdropClick)
    window.removeEventListener('keydown', this.handleKeyDown)
    super.disconnectedCallback()
  }

  private handleBackdropClick = (e: MouseEvent): void => {
    if (e.target === this) this.close()
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close()
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  private mainText(): string {
    if (!this.view) return ''
    const r = this.view.state.selection.main
    return this.view.state.doc.sliceString(r.from, r.to)
  }

  private wrapSelection(before: string, after: string = before): void {
    if (!this.view) return
    const view = this.view
    const changes = view.state.selection.ranges.map((r) => ({
      from: r.from,
      to: r.to,
      insert: wrapInline(view.state.doc.sliceString(r.from, r.to), before, after)
    }))
    view.dispatch({ changes })
    view.focus()
  }

  private insertAtCursor(text: string): void {
    if (!this.view) return
    const r = this.view.state.selection.main
    this.view.dispatch({ changes: { from: r.from, to: r.to, insert: text } })
    this.view.focus()
  }

  private applyToLines(fn: (line: string) => string): void {
    if (!this.view) return
    const view = this.view
    const doc = view.state.doc
    const { from, to } = view.state.selection.main
    const first = doc.lineAt(from).number
    const last = doc.lineAt(to).number
    const changes: Array<{ from: number; to: number; insert: string }> = []
    for (let n = first; n <= last; n++) {
      const line = doc.line(n)
      changes.push({ from: line.from, to: line.to, insert: fn(line.text) })
    }
    view.dispatch({ changes })
    view.focus()
  }

  private async run(id: string): Promise<void> {
    const view = this.view
    if (!view) {
      this.close()
      return
    }
    const sel = this.mainText()
    switch (id) {
      case 'add-link': {
        const text = wrapInline(sel, '[', '](url)')
        const r = view.state.selection.main
        const urlFrom = r.from + text.length - 4
        view.dispatch({ changes: { from: r.from, to: r.to, insert: text } })
        view.dispatch({ selection: { anchor: urlFrom, head: urlFrom + 3 } })
        view.focus()
        break
      }
      case 'add-external-link': {
        const text = wrapInline(sel, '[', ']()')
        const r = view.state.selection.main
        view.dispatch({ changes: { from: r.from, to: r.to, insert: text } })
        const cursor = r.from + text.length - 1
        view.dispatch({ selection: { anchor: cursor } })
        view.focus()
        break
      }
      case 'bold':
        this.wrapSelection('**')
        break
      case 'italic':
        this.wrapSelection('*')
        break
      case 'strike':
        this.wrapSelection('~~')
        break
      case 'highlight':
        this.wrapSelection('==')
        break
      case 'code':
        this.wrapSelection('`')
        break
      case 'math':
        this.wrapSelection('$')
        break
      case 'comment':
        this.wrapSelection('%%')
        break
      case 'clear': {
        const r = view.state.selection.main
        view.dispatch({
          changes: { from: r.from, to: r.to, insert: clearFormatting(sel) }
        })
        view.focus()
        break
      }
      case 'normal':
        this.applyToLines(stripBlockMarkers)
        break
      case 'h1':
        this.applyToLines((l) => toggleLinePrefix(stripBlockMarkers(l), '# '))
        break
      case 'h2':
        this.applyToLines((l) => toggleLinePrefix(stripBlockMarkers(l), '## '))
        break
      case 'h3':
        this.applyToLines((l) => toggleLinePrefix(stripBlockMarkers(l), '### '))
        break
      case 'quote':
        this.applyToLines((l) => toggleLinePrefix(l, '> '))
        break
      case 'footnote': {
        const doc = view.state.doc.toString()
        const n = nextFootnoteNumber(doc)
        const r = view.state.selection.main
        view.dispatch({
          changes: [
            { from: r.from, to: r.to, insert: `${sel}[^${n}]` },
            { from: doc.length, insert: `\n[^${n}]: ` }
          ]
        })
        view.focus()
        break
      }
      case 'table':
        this.insertAtCursor(tableSkeleton())
        break
      case 'callout':
        this.insertAtCursor('\n> [!note] ')
        break
      case 'rule':
        this.insertAtCursor('\n---\n')
        break
      case 'codeblock':
        this.insertAtCursor(codeFence())
        break
      case 'mathblock':
        this.insertAtCursor(mathBlock())
        break
      case 'cut': {
        if (!sel) break
        try {
          await navigator.clipboard.writeText(sel)
          const r = view.state.selection.main
          view.dispatch({ changes: { from: r.from, to: r.to, insert: '' } })
        } catch (err) {
          console.error('Cut failed:', err)
        }
        view.focus()
        break
      }
      case 'copy':
        if (sel) {
          try {
            await navigator.clipboard.writeText(sel)
          } catch (err) {
            console.error('Copy failed:', err)
          }
        }
        view.focus()
        break
      case 'paste':
      case 'paste-plain': {
        try {
          const text = await navigator.clipboard.readText()
          this.insertAtCursor(text)
        } catch (err) {
          console.error('Paste failed:', err)
          alert('Paste failed: clipboard access was denied')
        }
        break
      }
      case 'select-all':
        view.dispatch({
          selection: { anchor: 0, head: view.state.doc.length }
        })
        view.focus()
        break
    }
    this.close()
  }

  render(): unknown {
    return html`
      <div class="m-panel" style="left: ${this.x}px; top: ${this.y}px" @click=${(e: MouseEvent) => e.stopPropagation()}>
        ${MENU.map((item) => html`
          ${item.dividerBefore ? html`<div class="m-divider"></div>` : ''}
          ${item.children
            ? html`
                <div class="m-item has-sub">
                  ${menuIcon(item.icon)}
                  <span>${item.label}</span>
                  <span class="m-chevron">›</span>
                  <div class="submenu ${this.flip ? 'left' : ''}">
                    ${item.children.map(
                      (sub) => html`
                        <div class="m-item" @click=${() => void this.run(sub.id)}>
                          ${menuIcon(sub.icon)}
                          <span>${sub.label}</span>
                        </div>
                      `
                    )}
                  </div>
                </div>
              `
            : html`
                <div class="m-item" @click=${() => void this.run(item.id)}>
                  ${menuIcon(item.icon)}
                  <span>${item.label}</span>
                </div>
              `}
        `)}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-text-menu': TextMenu
  }
}
