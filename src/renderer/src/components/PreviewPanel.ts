import { css, html, LitElement, nothing } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { SettingsStore } from '../state/settings'
import { api } from '../api'
import {
  PAGE_SIZE_MM,
  PX_PER_MM,
  renderExportHtml,
  resolvePageSize,
  VALID_PAGE_SIZES,
  type ExportTheme
} from '../../../shared/export-html'

/**
 * Export preview.
 *
 * The document is rendered through `renderExportHtml`, the same function the
 * exporter writes to disk, so what appears here is what lands in the file
 * rather than an approximation that can drift. What it does not reproduce is
 * pagination: `printToPDF` breaks the pages itself, so the sheet here is one
 * continuous page-width column with a guide at each break.
 */
@customElement('writemd-preview-panel')
export class PreviewPanel extends LitElement {
  @property({ type: String }) markdown = ''
  @property({ type: String }) docPath: string | null = null

  @state() private pageSize = 'A4'
  @state() private marginMm = 24
  @state() private theme: ExportTheme = 'light'
  /** Pane width in CSS px, so the sheet scales to fit instead of clipping. */
  @state() private available = 0
  /** Measured height of the rendered document, in CSS px. */
  @state() private contentHeight = 0
  @state() private notice = ''

  // No initializer: @query installs a getter, so assigning to it throws.
  @query('.stage') private stage!: HTMLElement | null

  private observer: ResizeObserver | null = null
  private unsubs: Array<() => void> = []

  connectedCallback(): void {
    super.connectedCallback()
    const store = SettingsStore.getInstance()
    const read = (): void => {
      this.pageSize = store.get<string>('export.pdfPageSize', 'A4')
      this.marginMm = store.get<number>('export.pdfMargin', 24)
      this.theme = store.get<string>('export.pdfTheme', 'light') === 'dark' ? 'dark' : 'light'
    }
    read()
    // Subscriptions only fire on a change, so the saved value would otherwise
    // not apply until the user touched the matching control in Settings.
    for (const key of ['export.pdfPageSize', 'export.pdfMargin', 'export.pdfTheme']) {
      this.unsubs.push(store.subscribe(key, read))
    }
    this.observer = new ResizeObserver(() => {
      const w = this.stage?.clientWidth ?? 0
      if (w && Math.abs(w - this.available) > 1) this.available = w
    })
  }

  disconnectedCallback(): void {
    this.observer?.disconnect()
    this.observer = null
    for (const unsub of this.unsubs) unsub()
    this.unsubs = []
    super.disconnectedCallback()
  }

  protected firstUpdated(): void {
    if (this.stage) this.observer?.observe(this.stage)
  }

  private get docTitle(): string {
    if (!this.docPath) return 'Untitled'
    const base = this.docPath.replace(/\\/g, '/').split('/').pop() ?? 'Untitled'
    return base.replace(/\.[^/.]+$/, '')
  }

  private get page(): { width: number; height: number } {
    return PAGE_SIZE_MM[resolvePageSize(this.pageSize)]
  }

  /** The body width printToPDF would give the document, in CSS pixels. */
  private get bodyWidth(): number {
    const page = this.page
    const margins = Math.min(this.marginMm, Math.min(page.width, page.height) / 2 - 8)
    return Math.max(120, (page.width - margins * 2) * PX_PER_MM)
  }

  private get sheetWidth(): number {
    return this.page.width * PX_PER_MM
  }

  private get sheetHeight(): number {
    return this.page.height * PX_PER_MM
  }

  /**
   * Height of the printable column.
   *
   * It grows past one page for a long note rather than clipping it. A preview
   * that silently cut off the rest of the document would be worse than no
   * preview at all, and the frame has no readable intrinsic height until it has
   * loaded, hence `measure`.
   */
  private get bodyHeight(): number {
    const one = Math.max(200, this.sheetHeight - this.marginMm * 2 * PX_PER_MM)
    return Math.max(one, this.contentHeight)
  }

  private get pageCount(): number {
    return Math.max(1, Math.ceil(this.bodyHeight / this.sheetHeight))
  }

  /**
   * Grow the frame to whatever the document turned out to need.
   *
   * `allow-same-origin` is required to read the frame's document, and it is
   * safe here precisely because `allow-scripts` is not granted and the exported
   * document carries a policy that blocks scripts anyway.
   */
  private measure = (): void => {
    const frame = this.renderRoot.querySelector('iframe')
    const doc = frame?.contentDocument
    if (!doc?.body) return
    const height = doc.body.scrollHeight
    // Only ever grow: a stale measurement must not shrink the sheet back over
    // content that is still there.
    if (height > this.contentHeight) this.contentHeight = height
  }

  /** Fits the sheet to the pane, never enlarging it past 1:1. */
  private get scale(): number {
    if (!this.available) return 0.5
    return Math.min(1, Math.max(0.25, (this.available - 32) / this.sheetWidth))
  }

  private get frameHtml(): string {
    return renderExportHtml(this.markdown, { title: this.docTitle, theme: this.theme })
  }

  private setExport(key: string, value: unknown): void {
    SettingsStore.getInstance().set(key, value)
  }

  private async save(kind: 'pdf' | 'html'): Promise<void> {
    this.notice = ''
    try {
      const result = await api()?.export?.[kind]?.(this.markdown, this.docPath)
      if (result && !result.ok && result.reason !== 'canceled') {
        this.notice = `Export failed: ${result.reason ?? 'unknown error'}`
      }
    } catch (err) {
      this.notice = `Export failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  render(): unknown {
    const scale = this.scale
    return html`
      <div class="bar">
        <label>
          Page
          <select
            aria-label="Page size"
            .value=${this.pageSize}
            @change=${(e: Event) =>
              this.setExport(
                'export.pdfPageSize',
                String((e.currentTarget as HTMLSelectElement).value)
              )}
          >
            ${VALID_PAGE_SIZES.map(
              (size) =>
                html`<option value=${size} ?selected=${size === this.pageSize}>${size}</option>`
            )}
          </select>
        </label>
        <label>
          Margin
          <input
            type="number"
            min="0"
            max="60"
            aria-label="Margin in millimetres"
            .value=${String(this.marginMm)}
            @change=${(e: Event) =>
              this.setExport(
                'export.pdfMargin',
                Math.max(0, parseInt((e.target as HTMLInputElement).value, 10) || 0)
              )}
          />
          <span class="unit">mm</span>
        </label>
        <label>
          Theme
          <select
            aria-label="Export theme"
            .value=${this.theme}
            @change=${(e: Event) =>
              this.setExport(
                'export.pdfTheme',
                String((e.currentTarget as HTMLSelectElement).value)
              )}
          >
            <option value="light" ?selected=${this.theme === 'light'}>Light</option>
            <option value="dark" ?selected=${this.theme === 'dark'}>Dark</option>
          </select>
        </label>
        <div class="spacer"></div>
        <div class="actions">
          <button class="action" @click=${() => void this.save('html')}>Save HTML</button>
          <button class="action primary" @click=${() => void this.save('pdf')}>Save PDF</button>
        </div>
      </div>
      ${this.notice ? html`<div class="notice" role="alert">${this.notice}</div>` : nothing}
      <div class="stage">
        <div
          class="sheet"
          style=${`width:${this.sheetWidth}px;height:${this.bodyHeight}px;transform:scale(${scale})`}
        >
          <iframe
            title="Export preview"
            class="frame"
            style=${`width:${this.bodyWidth}px;height:${this.bodyHeight}px`}
            sandbox="allow-same-origin"
            .srcdoc=${this.frameHtml}
            @load=${this.measure}
          ></iframe>
          <div
            class="guides"
            aria-hidden="true"
            style=${`height:${this.bodyHeight}px;--page:${this.sheetHeight}px`}
          ></div>
        </div>
      </div>
      <div class="foot">
        ${Math.round(scale * 100)}% · ${this.pageCount === 1 ? '1 page' : `${this.pageCount} pages`}
        · the PDF paginates on its own
      </div>
    `
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background: var(--frame-surface);
        font-family: var(--font-ui);
      }

      /*
       * The pane can be dragged down to a few hundred pixels, and a single
       * unwrapped row pushed the Save buttons off the edge - a clipped "Save
       * PDF" is a control the user cannot tell they have. So the bar wraps:
       * controls flow onto a second row rather than being squeezed, and
       * nothing inside it shrinks below its own text.
       */
      .bar {
        display: flex;
        align-items: center;
        gap: 8px 12px;
        flex-wrap: wrap;
        padding: 8px;
        flex-shrink: 0;
        font-size: 12px;
        color: var(--text-muted);
      }

      .bar label {
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }

      .bar select,
      .bar input {
        font: inherit;
        font-size: 12px;
        color: var(--text);
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 3px 6px;
        /* Without this a squeezed select clips its own longest option. */
        white-space: nowrap;
        min-width: 0;
      }

      .bar input[type='number'] {
        width: 56px;
      }

      .unit {
        color: var(--text-muted);
      }

      /*
       * Collapses once the row is full, so it never reserves enough space to
       * push the actions onto a line of their own for nothing.
       */
      .spacer {
        flex: 1 1 0;
        min-width: 0;
      }

      .actions {
        display: flex;
        gap: 8px;
        margin-left: auto;
      }

      .action {
        font: inherit;
        font-size: 12px;
        white-space: nowrap;
        color: var(--text);
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 5px;
        padding: 5px 10px;
        cursor: pointer;
      }

      .action:hover {
        background: var(--bg-hover);
      }

      .action.primary {
        color: var(--accent-text);
        background: var(--accent);
        border-color: transparent;
      }

      .notice {
        padding: 6px 8px;
        font-size: 12px;
        color: var(--danger);
        border-bottom: 1px solid var(--border-subtle);
      }

      .stage {
        flex: 1;
        min-height: 0;
        overflow: auto;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding: 16px;
      }

      /*
       * Scaled with a transform from a top-centre origin, so the sheet shrinks
       * toward the middle of the pane and leaves equal gutters either side.
       * The zoom property would reflow the text at the smaller size and make the
       * preview disagree with the file; a transform keeps the layout identical
       * and just makes it smaller.
       */
      .sheet {
        position: relative;
        transform-origin: top center;
        background: #ffffff;
        box-shadow: var(--shadow-3);
        flex-shrink: 0;
      }

      .frame {
        border: 0;
        display: block;
        background: #ffffff;
      }

      /*
       * Page-break guides, drawn over the frame so the text underneath still
       * reads. They mark where the column reaches a full page height; the PDF
       * breaks wherever the content actually lands, so these are indicative
       * rather than exact - which is why the footer says so.
       *
       * Two pixels, not one: the sheet is scaled to fit the pane, so a hairline
       * at 60% is under a pixel on screen and vanishes.
       */
      .guides {
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: repeating-linear-gradient(
          to bottom,
          transparent 0,
          transparent calc(var(--page) - 2px),
          color-mix(in srgb, var(--text-muted) 60%, transparent) calc(var(--page) - 2px),
          color-mix(in srgb, var(--text-muted) 60%, transparent) var(--page)
        );
      }

      .foot {
        padding: 6px 8px;
        flex-shrink: 0;
        font-size: 11px;
        color: var(--text-muted);
        border-top: 1px solid var(--border-subtle);
      }
    `
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-preview-panel': PreviewPanel
  }
}
