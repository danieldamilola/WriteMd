import { html, css, LitElement } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { EditorView } from '@codemirror/view'
import { menuStyles, menuIcon } from './menu-styles'
import type { ElectronAPI, VaultTreeNode } from '../../../shared/electron-api'
import { FileState } from '../state/file-state'
import { SettingsStore } from '../state/settings'
import { basenameNoExt, isWebUrl, normalizeExternalUrl, shortPath } from '../utils/links'
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

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

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
        max-width: 280px;
        max-height: 280px;
        overflow-y: auto;
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

  @state() private linkFiles: Array<{ path: string; label: string }> = []

  private fileState = FileState.getInstance()
  private settingsStore = SettingsStore.getInstance()

  connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener('click', this.handleBackdropClick)
    window.addEventListener('keydown', this.handleKeyDown)
    void this.loadLinkFiles()
  }

  /** Files linkable from here: open tabs, recent files, vault — any folder. */
  private async loadLinkFiles(): Promise<void> {
    const seen = new Set<string>()
    const out: Array<{ path: string; label: string }> = []
    const push = (p: string | null): void => {
      if (!p || seen.has(p)) return
      seen.add(p)
      out.push({ path: p, label: shortPath(p) })
    }
    for (const tab of this.fileState.getState().tabs) push(tab.path)
    const collect = (node: VaultTreeNode): void => {
      if (node.isDirectory) {
        for (const child of node.children ?? []) collect(child)
      } else {
        push(node.path)
      }
    }
    const tree = await api()
      ?.vault?.getTree?.()
      .catch(() => undefined)
    if (tree) collect(tree)
    for (const p of this.settingsStore.get<string[]>('files.recentFiles', [])) push(p)
    this.linkFiles = out.slice(0, 15)
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

  /** Insert `[[file]]`, or `[[file|selected text]]` when text is selected. */
  private insertWikiLink(targetPath: string, sel: string): void {
    const view = this.view
    if (!view) return
    const stem = basenameNoExt(targetPath)
    const insert = sel && sel !== stem ? `[[${stem}|${sel}]]` : `[[${stem}]]`
    const r = view.state.selection.main
    view.dispatch({ changes: { from: r.from, to: r.to, insert } })
    view.dispatch({ selection: { anchor: r.from + insert.length } })
    view.focus()
  }

  private async browseForLink(sel: string): Promise<void> {
    const result = await api()?.file?.openDialog?.({
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }]
    })
    const picked = result && !result.canceled ? result.filePaths[0] : undefined
    if (picked) this.insertWikiLink(picked, sel)
    else this.view?.focus()
  }

  /**
   * Insert a website link `[label](https://…)`:
   * - clipboard holds a URL → use it (selection becomes the label)
   * - selection itself is a URL → linkify in place as `[url](url)`
   * - otherwise insert `[label](https://)` with the URL selected for typing
   */
  private async insertExternalLink(sel: string): Promise<void> {
    const view = this.view
    if (!view) return
    let pastedUrl = ''
    try {
      const clip = await navigator.clipboard.readText()
      if (clip && isWebUrl(clip)) pastedUrl = normalizeExternalUrl(clip)
    } catch {
      // Clipboard denied: fall through to manual entry.
    }
    const r = view.state.selection.main
    if (isWebUrl(sel)) {
      const url = normalizeExternalUrl(sel)
      const text = `[${sel}](${url})`
      view.dispatch({ changes: { from: r.from, to: r.to, insert: text } })
      view.dispatch({ selection: { anchor: r.from + text.length } })
    } else if (pastedUrl) {
      const text = sel ? `[${sel}](${pastedUrl})` : `[${pastedUrl}](${pastedUrl})`
      view.dispatch({ changes: { from: r.from, to: r.to, insert: text } })
      view.dispatch({ selection: { anchor: r.from + text.length } })
    } else {
      const text = wrapInline(sel, '[', '](https://)')
      view.dispatch({ changes: { from: r.from, to: r.to, insert: text } })
      const urlFrom = r.from + text.length - 1
      view.dispatch({ selection: { anchor: urlFrom, head: urlFrom + 8 } })
    }
    view.focus()
  }

  private async run(id: string): Promise<void> {
    const view = this.view
    if (!view) {
      this.close()
      return
    }
    const sel = this.mainText()
    if (id === 'link-browse') {
      await this.browseForLink(sel)
      this.close()
      return
    }
    if (id.startsWith('link-file::')) {
      this.insertWikiLink(id.slice('link-file::'.length), sel)
      this.close()
      return
    }
    switch (id) {
      case 'add-link': {
        // No submenu (e.g. keyboard invocation): fall back to file browser.
        await this.browseForLink(sel)
        break
      }
      case 'add-external-link': {
        await this.insertExternalLink(sel)
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

  /** Add-link entry expands to linkable files plus a file browser. */
  private linkMenuItem(): MenuItem {
    return {
      id: 'add-link',
      label: 'Add link',
      icon: 'link',
      children: [
        ...this.linkFiles.map((f) => ({
          id: `link-file::${f.path}`,
          label: f.label,
          icon: 'file'
        })),
        {
          id: 'link-browse',
          label: 'Browse for file…',
          icon: 'folder',
          dividerBefore: this.linkFiles.length > 0
        }
      ]
    }
  }

  render(): unknown {
    const items = MENU.map((item) => (item.id === 'add-link' ? this.linkMenuItem() : item))
    return html`
      <div
        class="m-panel"
        style="left: ${this.x}px; top: ${this.y}px"
        @click=${(e: MouseEvent) => e.stopPropagation()}
      >
        ${items.map(
          (item) => html`
            ${item.dividerBefore ? html`<div class="m-divider"></div>` : ''}
            ${
              item.children
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
                  `
            }
          `
        )}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-text-menu': TextMenu
  }
}
