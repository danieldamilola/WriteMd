import { html, css, LitElement } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import type { ElectronAPI } from '../../../shared/electron-api'
import { SettingsStore } from '../state/settings'

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

type SettingsTab = 'general' | 'editor' | 'appearance' | 'markdown' | 'files'

interface ThemeDefinition {
  id: string
  name: string
  bg: string
  elevated: string
  text: string
  accent: string
}

const THEME_PREVIEWS: ThemeDefinition[] = [
  { id: 'dark', name: 'Dark', bg: '#1a1b1e', elevated: '#212226', text: '#e8e8e8', accent: '#4a9eff' },
  { id: 'light', name: 'Light', bg: '#fafafa', elevated: '#ffffff', text: '#1a1a1a', accent: '#2a7de1' },
  { id: 'paper', name: 'Paper', bg: '#fdf6e3', elevated: '#fefbf3', text: '#3d3a2e', accent: '#b58900' },
  { id: 'dracula', name: 'Dracula', bg: '#282a36', elevated: '#343746', text: '#f8f8f2', accent: '#bd93f9' },
  { id: 'nord', name: 'Nord', bg: '#2e3440', elevated: '#3b4252', text: '#eceff4', accent: '#88c0d0' },
  { id: 'graphite', name: 'Graphite', bg: '#1e1e1e', elevated: '#252526', text: '#cccccc', accent: '#007acc' },
  { id: 'midnight', name: 'Midnight', bg: '#0f1419', elevated: '#151d25', text: '#cdd6da', accent: '#599cb9' }
]

const FONT_FAMILIES = [
  'JetBrains Mono',
  'Fira Code',
  'Geist Mono',
  'SF Mono',
  'Menlo',
  'Consolas',
  'Source Serif Pro',
  'Inter'
]

@customElement('writemd-settings-modal')
export class SettingsModal extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 300;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      animation: fadeIn 120ms ease-out;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    .modal-dialog {
      width: min(520px, 94vw);
      height: min(600px, 88vh);
      display: flex;
      flex-direction: column;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg, 12px);
      box-shadow: var(--shadow-3);
      overflow: hidden;
    }

    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 52px;
      padding: 0 20px;
      border-bottom: 1px solid var(--border-subtle);
      flex-shrink: 0;
    }

    .modal-header h2 {
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .close-btn {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-sm, 4px);
      color: var(--text-secondary);
      transition: background var(--transition-fast), color var(--transition-fast);
    }

    .close-btn:hover {
      background: var(--bg-hover);
      color: var(--text);
    }

    .close-btn svg {
      width: 14px;
      height: 14px;
    }

    .modal-body {
      display: flex;
      flex: 1;
      min-height: 0;
    }

    /* Content Area */
    .content-panel {
      flex: 1;
      padding: 20px 24px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .content-panel::-webkit-scrollbar {
      width: 4px;
    }
    .content-panel::-webkit-scrollbar-thumb {
      background: var(--border);
      border-radius: 2px;
    }

    .section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      margin-top: 4px;
      margin-bottom: -6px;
    }

    .setting-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 0;
      border-bottom: 1px solid var(--border-subtle);
    }

    .setting-row:last-child {
      border-bottom: none;
    }

    .setting-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
      min-width: 0;
    }

    .setting-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text);
    }

    .setting-desc {
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.4;
    }

    .setting-control {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Form Controls */
    input[type='text'],
    input[type='number'],
    select {
      font-family: inherit;
      font-size: 13px;
      padding: 6px 10px;
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm, 4px);
      outline: none;
      transition: border-color var(--transition-fast);
    }

    input[type='text']:focus,
    input[type='number']:focus,
    select:focus {
      border-color: var(--border-focus);
    }

    input[type='number'] {
      width: 80px;
      text-align: right;
    }

    select {
      cursor: pointer;
      min-width: 140px;
    }

    /* Toggle Switch */
    .toggle-switch {
      position: relative;
      width: 36px;
      height: 20px;
      border-radius: var(--radius-full, 9999px);
      background: var(--border);
      cursor: pointer;
      border: none;
      padding: 0;
      transition: background-color var(--transition-normal);
      outline: none;
    }

    .toggle-switch[aria-checked='true'] {
      background: var(--accent);
    }

    .toggle-switch::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #ffffff;
      transition: transform var(--transition-normal);
      box-shadow: var(--shadow-1);
    }

    .toggle-switch[aria-checked='true']::after {
      transform: translateX(16px);
    }

    /* Buttons */
    .btn {
      padding: 6px 12px;
      border-radius: var(--radius-sm, 4px);
      font-size: 13px;
      font-weight: 500;
      background: var(--bg-hover);
      color: var(--text);
      border: 1px solid var(--border);
      transition: background var(--transition-fast), border-color var(--transition-fast);
    }

    .btn:hover {
      background: var(--bg-active);
      border-color: var(--border-focus);
    }

    .btn-primary {
      background: var(--accent);
      color: var(--accent-text);
      border-color: transparent;
    }

    .btn-primary:hover {
      background: var(--accent-hover);
    }

    .btn-danger {
      color: var(--danger);
      border-color: var(--danger);
      background: transparent;
    }

    .btn-danger:hover {
      background: var(--danger-bg);
    }

    /* Theme Swatch Grid */
    .theme-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(95px, 1fr));
      gap: 10px;
      width: 100%;
      margin-top: 8px;
    }

    .theme-card {
      display: flex;
      flex-direction: column;
      border-radius: var(--radius-md, 8px);
      border: 2px solid var(--border);
      padding: 6px;
      cursor: pointer;
      background: var(--bg);
      transition: border-color var(--transition-fast), transform var(--transition-fast);
      gap: 6px;
    }

    .theme-card:hover {
      border-color: var(--border-focus);
      transform: translateY(-1px);
    }

    .theme-card.active {
      border-color: var(--accent);
      background: var(--bg-hover);
    }

    .theme-preview-box {
      height: 44px;
      border-radius: 4px;
      padding: 6px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      border: 1px solid rgba(255, 255, 255, 0.08);
      position: relative;
    }

    .theme-preview-line {
      height: 4px;
      border-radius: 2px;
      width: 70%;
    }

    .theme-preview-accent {
      height: 6px;
      border-radius: 3px;
      width: 40%;
    }

    .theme-card-name {
      font-size: 11px;
      font-weight: 500;
      text-align: center;
      color: var(--text);
    }

    /* Modal Footer */
    .modal-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 48px;
      padding: 0 20px;
      border-top: 1px solid var(--border-subtle);
      background: var(--bg);
      font-size: 12px;
      color: var(--text-muted);
      flex-shrink: 0;
    }
  `

  @state() private tab: SettingsTab = 'general'

  // Settings State
  @state() private vaultPath = ''
  @state() private theme = 'dark'
  @state() private fontSize = 15
  @state() private fontFamily = 'JetBrains Mono'
  @state() private lineHeight = 1.7
  @state() private tabSize = 2
  @state() private wordWrap = true
  @state() private autoSave = true
  @state() private autoSaveDelay = 500
  @state() private showLineNumbers = false
  @state() private highlightActiveLine = true
  @state() private spellCheck = false
  @state() private toolbarVisible = true
  @state() private statusBarVisible = true
  @state() private previewFontSize = 16
  @state() private previewMaxWidth = 800
  @state() private enableMermaid = true
  @state() private enableWikiLinks = false
  @state() private imageFolderName = '_assets'
  @state() private defaultNewFileName = 'Untitled.md'
  @state() private recentFilesMax = 10

  private settingsStore = SettingsStore.getInstance()

  connectedCallback(): void {
    super.connectedCallback()
    this.loadCurrentSettings()
    window.addEventListener('keydown', this.handleKeyDown)
    this.addEventListener('click', this.handleBackdropClick)
  }

  disconnectedCallback(): void {
    window.removeEventListener('keydown', this.handleKeyDown)
    this.removeEventListener('click', this.handleBackdropClick)
    super.disconnectedCallback()
  }

  private loadCurrentSettings(): void {
    const s = this.settingsStore
    this.theme = s.get('appearance.theme', 'dark')
    this.toolbarVisible = s.get('appearance.toolbarVisible', true)
    this.statusBarVisible = s.get('appearance.statusBarVisible', true)

    this.fontSize = s.get('editor.fontSize', 15)
    this.fontFamily = s.get('editor.fontFamily', 'JetBrains Mono')
    this.lineHeight = s.get('editor.lineHeight', 1.7)
    this.tabSize = s.get('editor.tabSize', 2)
    this.wordWrap = s.get('editor.wordWrap', true)
    this.autoSave = s.get('editor.autoSave', true)
    this.autoSaveDelay = s.get('editor.autoSaveDelay', 500)
    this.showLineNumbers = s.get('editor.showLineNumbers', false)
    this.highlightActiveLine = s.get('editor.highlightActiveLine', true)
    this.spellCheck = s.get('advanced.spellCheck', false)

    this.previewFontSize = s.get('preview.fontSize', 16)
    this.previewMaxWidth = s.get('preview.maxWidth', 800)
    this.enableMermaid = s.get('advanced.enableMermaid', true)
    this.enableWikiLinks = s.get('advanced.enableWikiLinks', false)

    this.imageFolderName = s.get('files.imageFolderName', '_assets')
    this.defaultNewFileName = s.get('files.defaultNewFileName', 'Untitled.md')
    this.recentFilesMax = s.get('files.recentFilesMax', 10)

    void api()
      ?.vault?.getPath?.()
      .then((p) => {
        this.vaultPath = p ?? ''
      })
      .catch(() => undefined)
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      this.close()
    }
  }

  private close = (): void => {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  private handleBackdropClick = (e: MouseEvent): void => {
    if (e.target === this) {
      this.close()
    }
  }

  private setSetting(key: string, value: unknown): void {
    this.settingsStore.set(key, value)
  }

  private pickVault = async (): Promise<void> => {
    const result = await api()?.dialog?.showOpenDialog?.({
      properties: ['openDirectory', 'createDirectory']
    })
    if (result && !result.canceled && result.filePaths[0]) {
      this.vaultPath = result.filePaths[0]
      await api()?.vault?.setPath?.(this.vaultPath)
      this.setSetting('files.vaultPath', this.vaultPath)
    }
  }

  private resetDefaults = (): void => {
    if (confirm('Reset all settings to default values?')) {
      const defaults: Record<string, unknown> = {
        'editor.fontSize': 15,
        'editor.fontFamily': 'JetBrains Mono',
        'editor.lineHeight': 1.7,
        'editor.tabSize': 2,
        'editor.wordWrap': true,
        'editor.autoSave': true,
        'editor.autoSaveDelay': 500,
        'editor.showLineNumbers': false,
        'editor.highlightActiveLine': true,
        'appearance.theme': 'dark',
        'appearance.toolbarVisible': true,
        'appearance.statusBarVisible': true,
        'preview.fontSize': 16,
        'preview.maxWidth': 800,
        'advanced.enableMermaid': true,
        'advanced.enableWikiLinks': false,
        'advanced.spellCheck': false,
        'files.imageFolderName': '_assets',
        'files.defaultNewFileName': 'Untitled.md',
        'files.recentFilesMax': 10
      }
      for (const [k, v] of Object.entries(defaults)) {
        this.setSetting(k, v)
      }
      this.loadCurrentSettings()
    }
  }

  private renderToggle(key: string, value: boolean, onChange: (val: boolean) => void): unknown {
    return html`
      <button
        class="toggle-switch"
        role="switch"
        aria-checked=${String(value)}
        @click=${() => {
          const next = !value
          onChange(next)
          this.setSetting(key, next)
        }}
      ></button>
    `
  }

  render(): unknown {
    return html`
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-label="Settings" @click=${(e: MouseEvent) => e.stopPropagation()}>
        <!-- Header -->
        <div class="modal-header">
          <h2>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Settings
          </h2>
          <button class="close-btn" @click=${this.close} aria-label="Close settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <!-- Body -->
        <div class="modal-body">
          <!-- Sidebar Navigation -->
          

          <!-- Content Panels -->
          <div class="content-panel" role="tabpanel">
            ${
              this.tab === 'general'
                ? html`
                    <div class="section-title">Vault & Workspace</div>
                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Vault folder</span>
                        <span class="setting-desc">Default storage location for notes. External files open in place.</span>
                      </div>
                      <div class="setting-control">
                        <button class="btn" @click=${() => void this.pickVault()}>Choose...</button>
                      </div>
                    </div>
                    <div style="margin-top: -8px; margin-bottom: 8px;">
                      <input
                        type="text"
                        style="width: 100%; box-sizing: border-box;"
                        .value=${this.vaultPath}
                        readonly
                      />
                    </div>

                    <div class="section-title">Saving & Recovery</div>
                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Auto-save</span>
                        <span class="setting-desc">Automatically write modifications to disk as you write.</span>
                      </div>
                      <div class="setting-control">
                        ${this.renderToggle('editor.autoSave', this.autoSave, (v) => (this.autoSave = v))}
                      </div>
                    </div>

                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Auto-save delay</span>
                        <span class="setting-desc">Delay in milliseconds after you stop typing before writing.</span>
                      </div>
                      <div class="setting-control">
                        <input
                          type="number"
                          min="100"
                          max="5000"
                          step="100"
                          .value=${String(this.autoSaveDelay)}
                          @change=${(e: Event) => {
                            const val = Number((e.target as HTMLInputElement).value)
                            if (val >= 100) {
                              this.autoSaveDelay = val
                              this.setSetting('editor.autoSaveDelay', val)
                            }
                          }}
                        />
                        <span style="font-size: 12px; color: var(--text-muted);">ms</span>
                      </div>
                    </div>

                    <div class="section-title">Maintenance</div>
                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Reset preferences</span>
                        <span class="setting-desc">Restore all editor and appearance options to defaults.</span>
                      </div>
                      <div class="setting-control">
                        <button class="btn btn-danger" @click=${this.resetDefaults}>Reset All</button>
                      </div>
                    </div>
                  `
                : ''
            }

            ${
              this.tab === 'editor'
                ? html`
                    <div class="section-title">Typography</div>
                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Font family</span>
                        <span class="setting-desc">Monospace font used for source and live preview editor.</span>
                      </div>
                      <div class="setting-control">
                        <select
                          .value=${this.fontFamily}
                          @change=${(e: Event) => {
                            const val = (e.target as HTMLSelectElement).value
                            this.fontFamily = val
                            this.setSetting('editor.fontFamily', val)
                          }}
                        >
                          ${FONT_FAMILIES.map(
                            (f) => html`<option value=${f} ?selected=${f === this.fontFamily}>${f}</option>`
                          )}
                        </select>
                      </div>
                    </div>

                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Font size</span>
                        <span class="setting-desc">Base font size in pixels.</span>
                      </div>
                      <div class="setting-control">
                        <input
                          type="number"
                          min="11"
                          max="32"
                          .value=${String(this.fontSize)}
                          @change=${(e: Event) => {
                            const val = Number((e.target as HTMLInputElement).value)
                            if (val >= 11 && val <= 32) {
                              this.fontSize = val
                              this.setSetting('editor.fontSize', val)
                            }
                          }}
                        />
                        <span style="font-size: 12px; color: var(--text-muted);">px</span>
                      </div>
                    </div>

                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Line height</span>
                        <span class="setting-desc">Line spacing ratio for comfortable reading and editing.</span>
                      </div>
                      <div class="setting-control">
                        <input
                          type="number"
                          min="1.2"
                          max="2.4"
                          step="0.1"
                          .value=${String(this.lineHeight)}
                          @change=${(e: Event) => {
                            const val = Number((e.target as HTMLInputElement).value)
                            if (val >= 1.2 && val <= 2.4) {
                              this.lineHeight = val
                              this.setSetting('editor.lineHeight', val)
                            }
                          }}
                        />
                      </div>
                    </div>

                    <div class="section-title">Formatting & Behavior</div>
                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Word wrap</span>
                        <span class="setting-desc">Wrap long prose lines to fit editor width.</span>
                      </div>
                      <div class="setting-control">
                        ${this.renderToggle('editor.wordWrap', this.wordWrap, (v) => (this.wordWrap = v))}
                      </div>
                    </div>

                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Tab size</span>
                        <span class="setting-desc">Number of spaces per indentation level.</span>
                      </div>
                      <div class="setting-control">
                        <select
                          .value=${String(this.tabSize)}
                          @change=${(e: Event) => {
                            const val = Number((e.target as HTMLSelectElement).value)
                            this.tabSize = val
                            this.setSetting('editor.tabSize', val)
                          }}
                        >
                          <option value="2">2 spaces</option>
                          <option value="4">4 spaces</option>
                        </select>
                      </div>
                    </div>

                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Line numbers</span>
                        <span class="setting-desc">Display line numbers in left gutter.</span>
                      </div>
                      <div class="setting-control">
                        ${this.renderToggle('editor.showLineNumbers', this.showLineNumbers, (v) => (this.showLineNumbers = v))}
                      </div>
                    </div>

                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Highlight active line</span>
                        <span class="setting-desc">Subtly tint the line where cursor is active.</span>
                      </div>
                      <div class="setting-control">
                        ${this.renderToggle(
                          'editor.highlightActiveLine',
                          this.highlightActiveLine,
                          (v) => (this.highlightActiveLine = v)
                        )}
                      </div>
                    </div>

                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Spell check</span>
                        <span class="setting-desc">Underline misspelled words with native dictionary.</span>
                      </div>
                      <div class="setting-control">
                        ${this.renderToggle('advanced.spellCheck', this.spellCheck, (v) => (this.spellCheck = v))}
                      </div>
                    </div>
                  `
                : ''
            }

            ${
              this.tab === 'appearance'
                ? html`
                    <div class="section-title">Theme Palette</div>
                    <div class="setting-info">
                      <span class="setting-desc">Select an interface theme. Instantly applies across UI and editor.</span>
                    </div>

                    <div class="theme-grid">
                      ${THEME_PREVIEWS.map(
                        (t) => html`
                          <div
                            class="theme-card ${this.theme === t.id ? 'active' : ''}"
                            @click=${() => {
                              this.theme = t.id
                              this.setSetting('appearance.theme', t.id)
                            }}
                          >
                            <div class="theme-preview-box" style="background: ${t.bg};">
                              <div class="theme-preview-line" style="background: ${t.text}; opacity: 0.8;"></div>
                              <div class="theme-preview-accent" style="background: ${t.accent};"></div>
                            </div>
                            <span class="theme-card-name">${t.name}</span>
                          </div>
                        `
                      )}
                    </div>

                    <div class="section-title" style="margin-top: 16px;">Interface Elements</div>
                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Top action toolbar</span>
                        <span class="setting-desc">Show quick format action buttons at the top of the workspace.</span>
                      </div>
                      <div class="setting-control">
                        ${this.renderToggle(
                          'appearance.toolbarVisible',
                          this.toolbarVisible,
                          (v) => (this.toolbarVisible = v)
                        )}
                      </div>
                    </div>

                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Status info pill</span>
                        <span class="setting-desc">Display word and character counts in bottom right.</span>
                      </div>
                      <div class="setting-control">
                        ${this.renderToggle(
                          'appearance.statusBarVisible',
                          this.statusBarVisible,
                          (v) => (this.statusBarVisible = v)
                        )}
                      </div>
                    </div>
                  `
                : ''
            }

            ${
              this.tab === 'markdown'
                ? html`
                    <div class="section-title">Reading & Preview Layout</div>
                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Reading font size</span>
                        <span class="setting-desc">Typography size in dedicated reader mode.</span>
                      </div>
                      <div class="setting-control">
                        <input
                          type="number"
                          min="12"
                          max="28"
                          .value=${String(this.previewFontSize)}
                          @change=${(e: Event) => {
                            const val = Number((e.target as HTMLInputElement).value)
                            if (val >= 12 && val <= 28) {
                              this.previewFontSize = val
                              this.setSetting('preview.fontSize', val)
                            }
                          }}
                        />
                        <span style="font-size: 12px; color: var(--text-muted);">px</span>
                      </div>
                    </div>

                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Max reading width</span>
                        <span class="setting-desc">Constrains maximum width of prose lines for readability.</span>
                      </div>
                      <div class="setting-control">
                        <input
                          type="number"
                          min="500"
                          max="1600"
                          step="50"
                          .value=${String(this.previewMaxWidth)}
                          @change=${(e: Event) => {
                            const val = Number((e.target as HTMLInputElement).value)
                            if (val >= 500) {
                              this.previewMaxWidth = val
                              this.setSetting('preview.maxWidth', val)
                            }
                          }}
                        />
                        <span style="font-size: 12px; color: var(--text-muted);">px</span>
                      </div>
                    </div>

                    <div class="section-title">Syntax Extensions</div>
                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Mermaid diagrams</span>
                        <span class="setting-desc">Render flowchart, sequence, and graph syntax blocks visually.</span>
                      </div>
                      <div class="setting-control">
                        ${this.renderToggle(
                          'advanced.enableMermaid',
                          this.enableMermaid,
                          (v) => (this.enableMermaid = v)
                        )}
                      </div>
                    </div>

                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Wiki-links [[note]]</span>
                        <span class="setting-desc">Enable Obsidian-style double bracket links to internal vault notes.</span>
                      </div>
                      <div class="setting-control">
                        ${this.renderToggle(
                          'advanced.enableWikiLinks',
                          this.enableWikiLinks,
                          (v) => (this.enableWikiLinks = v)
                        )}
                      </div>
                    </div>
                  `
                : ''
            }

            ${
              this.tab === 'files'
                ? html`
                    <div class="section-title">Attachments & Assets</div>
                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Pasted images directory</span>
                        <span class="setting-desc">Subfolder name created beside document for pasted screenshots.</span>
                      </div>
                      <div class="setting-control">
                        <input
                          type="text"
                          style="width: 140px;"
                          .value=${this.imageFolderName}
                          @change=${(e: Event) => {
                            const val = (e.target as HTMLInputElement).value.trim() || '_assets'
                            this.imageFolderName = val
                            this.setSetting('files.imageFolderName', val)
                          }}
                        />
                      </div>
                    </div>

                    <div class="section-title">New Documents</div>
                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Default document name</span>
                        <span class="setting-desc">Template name assigned to newly created blank notes.</span>
                      </div>
                      <div class="setting-control">
                        <input
                          type="text"
                          style="width: 140px;"
                          .value=${this.defaultNewFileName}
                          @change=${(e: Event) => {
                            const val = (e.target as HTMLInputElement).value.trim() || 'Untitled.md'
                            this.defaultNewFileName = val
                            this.setSetting('files.defaultNewFileName', val)
                          }}
                        />
                      </div>
                    </div>

                    <div class="section-title">History</div>
                    <div class="setting-row">
                      <div class="setting-info">
                        <span class="setting-label">Recent documents limit</span>
                        <span class="setting-desc">Maximum number of recent files retained on welcome screen.</span>
                      </div>
                      <div class="setting-control">
                        <input
                          type="number"
                          min="5"
                          max="30"
                          .value=${String(this.recentFilesMax)}
                          @change=${(e: Event) => {
                            const val = Number((e.target as HTMLInputElement).value)
                            if (val >= 5 && val <= 50) {
                              this.recentFilesMax = val
                              this.setSetting('files.recentFilesMax', val)
                            }
                          }}
                        />
                      </div>
                    </div>
                  `
                : ''
            }
          </div>
        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <span>Changes are saved automatically</span>
          <button class="btn btn-primary" @click=${this.close}>Done</button>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-settings-modal': SettingsModal
  }
}
