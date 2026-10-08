import { css, html, LitElement } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import '@awesome.me/webawesome/dist/components/button/button.js'
import '@awesome.me/webawesome/dist/components/slider/slider.js'
import type WaSlider from '@awesome.me/webawesome/dist/components/slider/slider.js'
import './Background'
import '@awesome.me/webawesome/dist/components/select/select.js'
import type WaSelect from '@awesome.me/webawesome/dist/components/select/select.js'
import { settingsSelectStyles } from '../design/controls'
import { SettingsStore } from '../state/settings'
import { BackgroundStore } from '../state/background'
import { api } from '../api'

const effects = ['none', 'dither', 'ascii', 'halftone', 'scanlines', 'haze'] as const

@customElement('writemd-background-controls')
export class BackgroundControls extends LitElement {
  static styles = [
    settingsSelectStyles,
    css`
      :host {
        display: block;
        margin-bottom: 24px;
        color: var(--text);
        font: inherit;
        container-type: inline-size;
      }
      * {
        box-sizing: border-box;
      }
      h3 {
        font-size: 14px;
        font-weight: 600;
        margin: 0 0 8px;
      }
      p {
        font-size: 12px;
        color: var(--text-secondary);
        margin: 4px 0 12px;
      }
      .card {
        border: 0;
        border-radius: var(--radius-lg);
        background: var(--bg-card);
        overflow: hidden;
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 16px;
        border: 0;
        flex-wrap: wrap;
      }
      .row:first-child {
        border-top: 0;
      }
      .label {
        font-size: 13px;
        font-weight: 500;
      }
      .hint {
        font-size: 12px;
        color: var(--text-secondary);
        margin-top: 4px;
        line-height: 1.5;
        overflow-wrap: anywhere;
      }
      .preview {
        position: relative;
        height: 130px;
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-md);
        background: var(--bg-frame);
        overflow: hidden;
      }
      .image-row {
        padding: 16px;
      }
      .empty {
        position: absolute;
        inset: 0;
        display: grid;
        place-content: center;
        color: var(--text-muted);
        font-size: 12px;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 12px;
        flex-wrap: wrap;
      }
      .preview-toggle {
        margin-right: auto;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text-secondary);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      .preview-toggle:hover {
        color: var(--text);
        background: var(--bg-hover);
      }
      .segments {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        padding: 3px;
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-md);
      }
      .segments button {
        font: inherit;
        font-size: 12px;
        border: 0;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text-secondary);
        padding: 5px 10px;
        cursor: pointer;
      }
      .segments button[aria-pressed='true'] {
        background: var(--bg-active);
        color: var(--text);
      }
      .segments button:focus-visible {
        outline: 1px solid var(--accent);
      }
      .range {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        flex: 0 1 220px;
        max-width: 100%;
      }
      wa-slider {
        flex: 1;
        min-width: 0;
        width: 170px;
        --track-size: 4px;
        --thumb-width: 12px;
        --thumb-height: 12px;
      }
      output {
        font-size: 12px;
        width: 42px;
        text-align: right;
        color: var(--text-secondary);
      }
      .error {
        color: var(--danger);
        font-size: 12px;
        padding-top: 8px;
      }
      wa-button::part(base) {
        font-family: var(--font-ui);
        font-size: 12px;
        border-radius: var(--radius-sm);
      }
      .row > :first-child {
        min-width: 0;
      }
      @container (width < 560px) {
        .row {
          gap: 12px;
        }
        .row > div:first-child {
          flex: 1 1 100%;
        }
        .range,
        wa-select {
          flex: 1 1 220px;
        }
      }
    `
  ]
  @state() private busy = false
  @state() private error = ''
  @state() private previewEmpty = true
  private settings = SettingsStore.getInstance()
  private backgrounds = BackgroundStore.getInstance()
  private unsubscribes: (() => void)[] = []
  connectedCallback(): void {
    super.connectedCallback()
    this.unsubscribes = [
      this.settings.subscribe('appearance', () => this.requestUpdate()),
      this.backgrounds.subscribe(() => this.requestUpdate())
    ]
  }
  disconnectedCallback(): void {
    this.unsubscribes.forEach((unsubscribe) => unsubscribe())
    super.disconnectedCallback()
  }
  private choose = async (): Promise<void> => {
    this.busy = true
    this.error = ''
    try {
      const previous = this.settings.get('appearance.backgroundId', '')
      const asset = await api()?.appearance?.importBackground()
      if (asset) {
        this.settings.set('appearance.backgroundId', asset.id)
        if (await this.settings.whenSaved()) {
          if (previous && previous !== asset.id) await api()?.appearance?.removeBackground(previous)
        }
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not import image'
    } finally {
      this.busy = false
    }
  }
  private clearImage = async (): Promise<void> => {
    const id = this.settings.get('appearance.backgroundId', '')
    this.settings.set('appearance.backgroundId', '')
    try {
      if (id && (await this.settings.whenSaved())) await api()?.appearance?.removeBackground(id)
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not remove image'
    }
  }
  private segments(key: string, options: readonly string[]): unknown {
    const selected = this.settings.get(key, options[0])
    return html`<div class="segments" role="group" aria-label=${key.split('.').at(-1)}>
      ${options.map(
        (value) =>
          html`<button
            aria-pressed=${selected === value}
            @click=${() => this.settings.set(key, value)}
          >
            ${value === 'ascii' ? 'ASCII' : value === 'ai' ? 'AI pane' : value === 'all' ? 'Always' : value === 'empty' ? 'Empty only' : value[0].toUpperCase() + value.slice(1)}
          </button>`
      )}
    </div>`
  }
  private range(label: string, hint: string, key: string, max = 100, unit = '%'): unknown {
    return html`<div class="row">
      <div>
        <div class="label">${label}</div>
        <div class="hint">${hint}</div>
      </div>
      <div class="range">
        <wa-slider
          aria-label=${label}
          min="0"
          .max=${max}
          .value=${this.settings.get(key, 0)}
          @input=${(event: Event) => this.settings.setMany({ [key]: (event.currentTarget as WaSlider).value }, false)}
          @change=${(event: Event) => this.settings.set(key, (event.currentTarget as WaSlider).value)}
        ></wa-slider>
        <output>${this.settings.get(key, 0)}${unit}</output>
      </div>
    </div>`
  }
  render(): unknown {
    const id = this.settings.get('appearance.backgroundId', '')
    return html`<h3>Background image</h3>
      <p>A local image behind your panes. It stays on this device.</p>
      <div class="card">
        <div class="image-row">
          <div class="preview">
            <writemd-background target="preview" .empty=${this.previewEmpty}></writemd-background>
            ${!id ? html`<span class="empty">No background image</span>` : ''}
          </div>
          <div class="actions">
            <button class="preview-toggle" @click=${() => (this.previewEmpty = !this.previewEmpty)}>
              ${this.previewEmpty ? 'Preview content' : 'Preview empty view'}
            </button>
            <wa-button
              size="small"
              appearance="outlined"
              ?disabled=${this.busy}
              @click=${this.choose}
              >${id ? 'Change' : 'Choose image'}</wa-button
            >
            <wa-button
              size="small"
              appearance="outlined"
              ?disabled=${!id || this.busy}
              @click=${this.clearImage}
              >Remove</wa-button
            >
          </div>
        </div>
        <div class="row">
          <div>
            <div class="label">Background effect</div>
            <div class="hint">Artwork is processed when the effect changes.</div>
          </div>
          ${this.segments('appearance.backgroundEffect', effects)}
        </div>
        <div class="row">
          <div class="label">Show behind</div>
          ${this.segments('appearance.backgroundTarget', ['workspace', 'ai'])}
        </div>
        <div class="row">
          <div class="label">Show on</div>
          ${this.segments('appearance.backgroundShowOn', ['all', 'empty'])}
        </div>
        ${this.range('Empty view visibility', 'Image strength before there is content.', 'appearance.backgroundEmptyOpacity')}
        ${this.range('Content visibility', 'Image strength behind documents and conversations.', 'appearance.backgroundContentOpacity')}
        ${this.range('Haze blur', 'Blur applied by the Haze effect.', 'appearance.backgroundBlur', 40, 'px')}
        ${this.range('Surface opacity', 'Controls desktop glass. Image visibility is set above.', 'appearance.surfaceOpacity')}
        <div class="row">
          <div>
            <div class="label">Window material</div>
            <div class="hint">
              ${this.settings.materialSupported ? 'Desktop glass uses your system’s appearance.' : 'Desktop glass is unavailable on this system.'}
            </div>
          </div>
          <wa-select
            size="small"
            label="Window material"
            aria-label="Window material"
            ?disabled=${!this.settings.materialSupported}
            .value=${this.settings.get('appearance.windowMaterial', 'none')}
            @change=${(event: Event) => this.settings.set('appearance.windowMaterial', String((event.currentTarget as WaSelect).value ?? ''))}
          >
            <wa-option value="none">None</wa-option>
            <wa-option value="mica">Mica / Vibrancy</wa-option>
            <wa-option value="acrylic">Acrylic / Vibrancy</wa-option>
          </wa-select>
        </div>
      </div>
      ${this.backgrounds.loading ? html`<p role="status">Applying image effect…</p>` : ''}
      ${this.error || this.backgrounds.error ? html`<div class="error" role="alert">${this.error || this.backgrounds.error}</div>` : ''}`
  }
}
