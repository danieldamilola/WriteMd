import { html, css, LitElement } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import type { ElectronAPI } from '../../../shared/electron-api'
import { SettingsStore } from '../state/settings'

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

interface ThemeDefinition {
  id: string
  name: string
  bg: string
  elevated: string
  text: string
  accent: string
}

const THEME_PREVIEWS: ThemeDefinition[] = [
  { id: 'dark', name: 'Dark', bg: '#1a1b1e', elevated: '#212226', text: '#e8e8e8', accent: '#ffffff' },
  { id: 'light', name: 'Light', bg: '#fafafa', elevated: '#ffffff', text: '#1a1a1a', accent: '#1a1a1a' },
  { id: 'paper', name: 'Paper', bg: '#fdf6e3', elevated: '#fefbf3', text: '#3d3a2e', accent: '#3d3a2e' },
  { id: 'dracula', name: 'Dracula', bg: '#282a36', elevated: '#343746', text: '#f8f8f2', accent: '#ffffff' },
  { id: 'nord', name: 'Nord', bg: '#2e3440', elevated: '#3b4252', text: '#eceff4', accent: '#ffffff' },
  { id: 'graphite', name: 'Graphite', bg: '#1e1e1e', elevated: '#252526', text: '#cccccc', accent: '#ffffff' },
  { id: 'midnight', name: 'Midnight', bg: '#0f1419', elevated: '#151d25', text: '#cdd6da', accent: '#ffffff' }
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
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
      animation: fadeIn 150ms ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: scale(0.98) translateY(10px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }

    .modal-dialog {
      width: 480px;
      max-height: 85vh;
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
      justify-content: center;
      position: relative;
      height: 48px;
      border-bottom: 1px solid var(--border-subtle);
      flex-shrink: 0;
      background: var(--bg);
    }

    .modal-header h2 {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .close-btn {
      position: absolute;
      right: 12px;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-sm, 4px);
      color: var(--text-secondary);
      background: transparent;
      border: none;
      cursor: pointer;
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
      flex: 1;
      overflow-y: auto;
      padding: 0;
    }

    .modal-body::-webkit-scrollbar {
      width: 4px;
    }
    .modal-body::-webkit-scrollbar-thumb {
      background: var(--border);
      border-radius: 2px;
    }

    .settings-group {
      padding: 24px;
      border-bottom: 1px solid var(--border-subtle);
    }
    
    .settings-group:last-child {
      border-bottom: none;
    }

    .group-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      margin: 0 0 16px 0;
    }

    .setting-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
    }

    .setting-row:last-child {
      margin-bottom: 0;
    }

    .setting-info {
      display: flex;
      flex-direction: column;
      gap: 4px;
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
      border-color: var(--text);
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
      width: 32px;
      height: 18px;
      border-radius: 99px;
      background: var(--border);
      cursor: pointer;
      border: none;
      padding: 0;
      transition: background-color var(--transition-normal);
      outline: none;
    }

    .toggle-switch[aria-checked='true'] {
      background: var(--text);
    }

    .toggle-switch::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--bg);
      transition: transform var(--transition-normal);
      box-shadow: var(--shadow-1);
    }

    .toggle-switch[aria-checked='true']::after {
      transform: translateX(14px);
      background: var(--bg);
    }

    /* Theme Grid */
    .theme-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
      gap: 8px;
      margin-top: 8px;
    }

    .theme-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 4px;
      border-radius: var(--radius-sm, 4px);
    }

    .theme-circle {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 2px solid transparent;
      position: relative;
      transition: transform var(--transition-fast);
    }
    
    .theme-btn:hover .theme-circle {
      transform: scale(1.1);
    }

    .theme-btn.active .theme-circle {
      border-color: var(--text);
    }

    .theme-name {
      font-size: 11px;
      color: var(--text-secondary);
    }

    .theme-btn.active .theme-name {
      color: var(--text);
      font-weight: 500;
    }

    .btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 12px;
      border-radius: var(--radius-sm, 4px);
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: all var(--transition-fast);
    }

    .btn:hover {
      background: var(--bg-hover);
    }

    .btn-danger {
      color: var(--danger);
      border-color: var(--border);
    }

    .btn-danger:hover {
      background: var(--danger-bg);
      border-color: var(--danger);
    }
  \`

  @state()
  private config = SettingsStore.getInstance().get()

  connectedCallback() {
    super.connectedCallback()
    window.addEventListener('keydown', this.handleKeyDown)
    SettingsStore.getInstance().subscribe(this.handleSettingsChange)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('keydown', this.handleKeyDown)
    SettingsStore.getInstance().unsubscribe(this.handleSettingsChange)
  }

  private handleSettingsChange = (newConfig: any) => {
    this.config = newConfig
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.close()
    }
  }

  private close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  private async handleVaultSelect() {
    const electron = api()
    if (!electron) return
    const result = await electron.invoke('dialog:openDirectory', {
      defaultPath: this.config.files.vaultPath
    })
    if (result && result.length > 0) {
      SettingsStore.getInstance().update('files', { vaultPath: result[0] })
    }
  }

  private async resetSettings() {
    const { showConfirm } = await import('./ConfirmDialog')
    const confirmed = await showConfirm(
      'Are you sure you want to reset all settings to defaults? This action cannot be undone.',
      'Reset Preferences'
    )
    if (confirmed) {
      SettingsStore.getInstance().reset()
    }
  }

  render() {
    return html\`
      <div class="modal-dialog">
        <div class="modal-header">
          <h2>Preferences</h2>
          <button class="close-btn" @click=\${this.close} title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <!-- Workspace -->
          <div class="settings-group">
            <h3 class="group-title">Workspace</h3>
            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-label">Vault Location</span>
                <span class="setting-desc">\${this.config.files.vaultPath}</span>
              </div>
              <div class="setting-control">
                <button class="btn" @click=\${this.handleVaultSelect}>Choose...</button>
              </div>
            </div>
            
            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-label">Auto-save</span>
                <span class="setting-desc">Write modifications to disk automatically</span>
              </div>
              <div class="setting-control">
                <button 
                  class="toggle-switch" 
                  role="switch" 
                  aria-checked="\${this.config.files.autoSave}"
                  @click=\${() => SettingsStore.getInstance().update('files', { autoSave: !this.config.files.autoSave })}
                ></button>
              </div>
            </div>
          </div>

          <!-- Appearance -->
          <div class="settings-group">
            <h3 class="group-title">Appearance</h3>
            <div class="setting-row" style="flex-direction: column; align-items: flex-start; gap: 12px;">
              <div class="setting-info">
                <span class="setting-label">Theme</span>
              </div>
              <div class="theme-grid">
                \${THEME_PREVIEWS.map(theme => html\`
                  <button 
                    class="theme-btn \${this.config.appearance.theme === theme.id ? 'active' : ''}"
                    @click=\${() => SettingsStore.getInstance().update('appearance', { theme: theme.id })}
                  >
                    <div class="theme-circle" style="background: \${theme.bg};"></div>
                    <span class="theme-name">\${theme.name}</span>
                  </button>
                \`)}
              </div>
            </div>
          </div>

          <!-- Editor -->
          <div class="settings-group">
            <h3 class="group-title">Editor</h3>
            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-label">Font Family</span>
              </div>
              <div class="setting-control">
                <select 
                  .value=\${this.config.editor.fontFamily}
                  @change=\${(e: any) => SettingsStore.getInstance().update('editor', { fontFamily: e.target.value })}
                >
                  \${FONT_FAMILIES.map(font => html\`<option value="\${font}">\${font}</option>\`)}
                </select>
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-label">Font Size</span>
              </div>
              <div class="setting-control">
                <input 
                  type="number" 
                  min="10" 
                  max="32" 
                  .value=\${this.config.editor.fontSize.toString()}
                  @change=\${(e: any) => SettingsStore.getInstance().update('editor', { fontSize: parseInt(e.target.value) })}
                />
                <span style="font-size: 13px; color: var(--text-muted)">px</span>
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-label">Word Wrap</span>
              </div>
              <div class="setting-control">
                <button 
                  class="toggle-switch" 
                  role="switch" 
                  aria-checked="\${this.config.editor.wordWrap}"
                  @click=\${() => SettingsStore.getInstance().update('editor', { wordWrap: !this.config.editor.wordWrap })}
                ></button>
              </div>
            </div>
            
            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-label">Line Numbers</span>
              </div>
              <div class="setting-control">
                <button 
                  class="toggle-switch" 
                  role="switch" 
                  aria-checked="\${this.config.editor.lineNumbers}"
                  @click=\${() => SettingsStore.getInstance().update('editor', { lineNumbers: !this.config.editor.lineNumbers })}
                ></button>
              </div>
            </div>
          </div>

          <!-- Advanced -->
          <div class="settings-group">
            <h3 class="group-title">Advanced</h3>
            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-label">Reset Preferences</span>
                <span class="setting-desc">Restore all options to defaults</span>
              </div>
              <div class="setting-control">
                <button class="btn btn-danger" @click=\${this.resetSettings}>Reset All</button>
              </div>
            </div>
          </div>

        </div>
      </div>
    \`
  }
}
