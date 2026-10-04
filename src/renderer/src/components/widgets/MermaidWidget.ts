import { WidgetType } from '@codemirror/view'
import { createLinkInterceptor } from '../extensions/safe-links'

// Mermaid ships two themes, so the app's seven map onto two. Mermaid 11 picked
// between them from prefers-color-scheme; 12 stopped, so a dark app theme
// rendered light node fills with dark text on a near-black background. Reading
// the app's own theme attribute is the reliable signal, and it also means the
// diagrams follow an in-app theme switch rather than the OS setting.
const DARK_THEMES = new Set(['dark', 'graphite', 'midnight', 'dracula', 'nord'])

type MermaidApi = typeof import('mermaid')['default']

/**
 * Mermaid is loaded on first diagram, not at startup.
 *
 * A static import pulled mermaid and its layout engines (dagre, cytoscape, elk,
 * katex) into the initial bundle and executed them on every launch, for notes
 * that contain no diagrams at all. Measured on the stress vault: the working set
 * before this change was ~750 MB at rest.
 */
let mermaidPromise: Promise<MermaidApi> | null = null

function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then((m) => m.default)
  return mermaidPromise
}

let configuredTheme: 'dark' | 'default' | null = null

function currentMermaidTheme(): 'dark' | 'default' {
  const current = document.documentElement.getAttribute('data-theme')
  return current && DARK_THEMES.has(current) ? 'dark' : 'default'
}

function configureMermaid(mermaid: MermaidApi): void {
  configuredTheme = currentMermaidTheme()
  mermaid.initialize({
    securityLevel: 'strict',
    startOnLoad: false,
    theme: configuredTheme
  })
}

// Diagram source is raw fenced-block content from disk, and the rendered SVG is
// assigned to innerHTML below. `strict` is the only level that runs DOMPurify
// over mermaid's output, and it is also the only level that does not enable
// click handlers inside the diagram. Stated here rather than inherited from a
// library default so the property is greppable and survives a version bump.

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

    const fail = (err: unknown): void => {
      renderSpan.innerText = 'Mermaid Error: ' + (err instanceof Error ? err.message : String(err))
      renderSpan.style.color = 'var(--danger)'
    }

    void loadMermaid()
      .then((mermaid) => {
        // Switching theme in Settings re-renders open documents, so each widget
        // is built against whatever the app's theme is now.
        if (currentMermaidTheme() !== configuredTheme) configureMermaid(mermaid)
        return mermaid.render(this.id + '-svg', this.codeContent)
      })
      .then((result) => {
        renderSpan.innerHTML = result.svg
      })
      .catch(fail)

    return container
  }

  ignoreEvent(): boolean {
    return false
  }
}
