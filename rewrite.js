const fs = require('fs');

const code = `import { html, css, LitElement } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import type { ElectronAPI } from '../../../shared/electron-api'
import { SettingsStore } from '../state/settings'
import { showConfirm } from './ConfirmDialog'

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

type SettingsTab = 'appearance' | 'editor' | 'ai' | 'about'

interface ThemeDefinition {
  id: string
  name: string
  c1: string
  c2: string
}

const THEME_PREVIEWS: ThemeDefinition[] = [
  { id: 'dark', name: 'Dark', c1: '#111', c2: '#1a1a1a' },
  { id: 'graphite', name: 'Graphite', c1: '#1e1e1e', c2: '#252526' },
  { id: 'nord', name: 'Nord', c1: '#2e3440', c2: '#3b4252' },
  { id: 'midnight', name: 'Midnight', c1: '#0f1419', c2: '#151d25' },
  { id: 'light', name: 'Light', c1: '#ffffff', c2: '#fafafa' },
  { id: 'paper', name: 'Paper', c1: '#fefbf3', c2: '#fdf6e3' },
  { id: 'dracula', name: 'Dracula', c1: '#282a36', c2: '#343746' }
]

const ACCENT_COLORS = [
  '#ffffff', // Monochrome (X)
  '#2a7de1', // Blue
  '#9b51e0', // Purple
  '#f24e1e', // Pink/Red
  '#00b87c', // Green
  '#f2994a', // Orange/Yellow
  '#f26419', // Orange
  '#00c4cc'  // Cyan
]

const FONT_FAMILIES = [
  { id: 'Inter', name: 'Inter', type: 'Sans-serif' },
  { id: 'Merriweather', name: 'Merriweather', type: 'Serif' },
  { id: 'Lora', name: 'Lora', type: 'Serif' },
  { id: 'Source Serif Pro', name: 'Source Serif', type: 'Serif' },
  { id: 'Fira Sans', name: 'Fira Sans', type: 'Sans-serif' },
  { id: 'JetBrains Mono', name: 'JetBrains Mono', type: 'Monospace' }
]

@customElement('writemd-settings-modal')
export class SettingsModal extends LitElement {
  static styles = css\`
    :host {
      position: fixed;
      inset: 0;
      z-index: 300;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      animation: fadeIn 120ms ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .modal-dialog {
      width: min(840px, 94vw);
      height: min(620px, 88vh);
      display: flex;
      background: #0a0a0a;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
      overflow: hidden;
      color: #e5e5e5;
    }

    /* Sidebar Navigation */
    .sidebar {
      width: 240px;
      flex-shrink: 0;
      background: #111111;
      border-right: 1px solid #1f1f1f;
      display: flex;
      flex-direction: column;
    }

    .sidebar-search {
      padding: 16px;
      border-bottom: 1px solid #1f1f1f;
    }

    .sidebar-search input {
      width: 100%;
      box-sizing: border-box;
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 6px;
      padding: 8px 12px;
      color: #fff;
      font-size: 13px;
      outline: none;
    }
    .sidebar-search input:focus {
      border-color: #444;
    }

    .sidebar-nav {
      padding: 12px 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .nav-btn {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      color: #888;
      background: transparent;
      border: none;
      cursor: pointer;
      text-align: left;
      transition: all 0.15s ease;
    }

    .nav-btn svg {
      width: 18px;
      height: 18px;
      opacity: 0.7;
    }

    .nav-btn:hover {
      background: #1a1a1a;
      color: #ddd;
    }

    .nav-btn.active {
      background: #1e1e1e;
      color: #fff;
      font-weight: 600;
    }
    .nav-btn.active svg {
      opacity: 1;
    }

    /* Main Area */
    .main-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .main-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 56px;
      padding: 0 24px;
      border-bottom: 1px solid #1f1f1f;
      flex-shrink: 0;
    }

    .main-header h2 {
      font-size: 16px;
      font-weight: 600;
      margin: 0;
      color: #fff;
    }

    .close-btn {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      color: #888;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .close-btn:hover {
      background: #1a1a1a;
      color: #fff;
    }

    .content-panel {
      flex: 1;
      padding: 24px;
      overflow-y: auto;
    }
    
    .content-panel::-webkit-scrollbar { width: 6px; }
    .content-panel::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }

    /* Sections */
    .section {
      margin-bottom: 32px;
    }
    .section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #666;
      margin-bottom: 16px;
    }

    /* Theme Grid */
    .theme-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
    }

    .theme-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      cursor: pointer;
    }
    
    .theme-box-wrapper {
      padding: 4px;
      border-radius: 10px;
      border: 2px solid transparent;
      transition: all 0.2s ease;
    }

    .theme-card.active .theme-box-wrapper {
      border-color: #fff;
    }
    
    .theme-box {
      width: 72px;
      height: 64px;
      border-radius: 6px;
      background: #222;
      display: flex;
      overflow: hidden;
    }
    
    .theme-box-left { flex: 1; }
    .theme-box-right { flex: 1; }

    .theme-name {
      font-size: 13px;
      font-weight: 500;
      color: #aaa;
    }
    .theme-card.active .theme-name {
      color: #fff;
    }

    /* Accent Colors */
    .color-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .color-circle-wrapper {
      padding: 3px;
      border-radius: 50%;
      border: 2px solid transparent;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .color-circle-wrapper.active {
      border-color: #fff;
    }
    
    .color-circle {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .color-circle svg {
      width: 14px;
      height: 14px;
      color: #000;
    }

    /* Font Grid */
    .font-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }

    .font-card {
      background: #111;
      border: 1px solid #222;
      border-radius: 8px;
      padding: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: all 0.2s ease;
    }
    
    .font-card:hover {
      border-color: #444;
    }

    .font-card.active {
      border-color: #fff;
    }

    .font-info {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .font-name {
      font-size: 15px;
      font-weight: 600;
      color: #ddd;
    }
    .font-card.active .font-name { color: #fff; }

    .font-type {
      font-size: 12px;
      color: #666;
    }

    .font-card svg {
      color: #fff;
      width: 20px;
      height: 20px;
    }
    
    /* Fallback sections for Editor/About */
    .setting-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 0;
      border-bottom: 1px solid #1f1f1f;
    }
    .setting-label { font-size: 14px; color: #fff; }
    .setting-desc { font-size: 12px; color: #888; margin-top: 4px; }
  \`;

  @state() private tab: SettingsTab = 'appearance'
  
  // Settings State
  @state() private vaultPath = ''
  @state() private theme = 'dark'
  @state() private accentColor = '#ffffff'
  @state() private fontFamily = 'Inter'
  @state() private fontSize = 15
  @state() private wordWrap = true
  @state() private autoSave = true
  @state() private lineNumbers = false

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
    this.accentColor = s.get('appearance.accentColor', '#ffffff')
    this.fontFamily = s.get('editor.fontFamily', 'Inter')
    this.fontSize = s.get('editor.fontSize', 15)
    this.wordWrap = s.get('editor.wordWrap', true)
    this.autoSave = s.get('files.autoSave', true)
    this.lineNumbers = s.get('editor.lineNumbers', false)
    this.vaultPath = s.get('files.vaultPath', '')
  }

  private updateSetting(key: string, value: any): void {
    this.settingsStore.set(key, value)
    this.loadCurrentSettings()
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close()
  }

  private handleBackdropClick = (e: MouseEvent): void => {
    if (e.target === this) this.close()
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  private async handleVaultSelect() {
    const electron = api()
    if (!electron) return
    const result = await electron.invoke('dialog:openDirectory', {
      defaultPath: this.vaultPath
    })
    if (result && result.length > 0) {
      this.updateSetting('files.vaultPath', result[0])
    }
  }

  private async handleReset() {
    const confirmed = await showConfirm(
      'Are you sure you want to reset all settings to default?',
      'Reset Settings'
    )
    if (confirmed) {
      // Just clear localstorage/indexeddb equivalent for MVP
      alert('Settings reset!')
    }
  }

  render() {
    return html\`
      <div class="modal-dialog" role="dialog" aria-modal="true" @click=\${(e: MouseEvent) => e.stopPropagation()}>
        
        <!-- Sidebar Navigation -->
        <div class="sidebar">
          <div class="sidebar-search">
            <input type="text" placeholder="Search..." />
          </div>
          <div class="sidebar-nav">
            <button class="nav-btn \${this.tab === 'appearance' ? 'active' : ''}" @click=\${() => (this.tab = 'appearance')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                <path d="M2 12h20" />
              </svg>
              Appearance
            </button>
            <button class="nav-btn \${this.tab === 'editor' ? 'active' : ''}" @click=\${() => (this.tab = 'editor')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              Editor
            </button>
            <button class="nav-btn \${this.tab === 'ai' ? 'active' : ''}" @click=\${() => (this.tab = 'ai')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              AI
            </button>
            <button class="nav-btn \${this.tab === 'about' ? 'active' : ''}" @click=\${() => (this.tab = 'about')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              About
            </button>
          </div>
        </div>

        <!-- Main Area -->
        <div class="main-area">
          <div class="main-header">
            <h2>\${this.tab.charAt(0).toUpperCase() + this.tab.slice(1)}</h2>
            <button class="close-btn" @click=\${this.close}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          
          <div class="content-panel">
            \${this.tab === 'appearance' ? this.renderAppearance() : ''}
            \${this.tab === 'editor' ? this.renderEditor() : ''}
            \${this.tab === 'ai' ? this.renderAI() : ''}
            \${this.tab === 'about' ? this.renderAbout() : ''}
          </div>
        </div>
      </div>
    \`
  }

  private renderAppearance() {
    return html\`
      <div class="section">
        <div class="section-title">Theme</div>
        <div class="theme-grid">
          \${THEME_PREVIEWS.map(t => html\`
            <div class="theme-card \${this.theme === t.id ? 'active' : ''}" @click=\${() => this.updateSetting('appearance.theme', t.id)}>
              <div class="theme-box-wrapper">
                <div class="theme-box">
                  <div class="theme-box-left" style="background: \${t.c1}"></div>
                  <div class="theme-box-right" style="background: \${t.c2}"></div>
                </div>
              </div>
              <span class="theme-name">\${t.name}</span>
            </div>
          \`)}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Accent Color</div>
        <div class="color-row">
          \${ACCENT_COLORS.map((c, i) => html\`
            <div class="color-circle-wrapper \${this.accentColor === c ? 'active' : ''}" @click=\${() => this.updateSetting('appearance.accentColor', c)}>
              <div class="color-circle" style="background: \${c}">
                \${i === 0 ? html\`
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                \` : ''}
              </div>
            </div>
          \`)}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Font</div>
        <div class="font-grid">
          \${FONT_FAMILIES.map(f => html\`
            <div class="font-card \${this.fontFamily === f.id ? 'active' : ''}" @click=\${() => this.updateSetting('editor.fontFamily', f.id)}>
              <div class="font-info">
                <span class="font-name" style="font-family: \${f.id}">\${f.name}</span>
                <span class="font-type">\${f.type}</span>
              </div>
              \${this.fontFamily === f.id ? html\`
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              \` : ''}
            </div>
          \`)}
        </div>
      </div>
    \`
  }

  private renderEditor() {
    return html\`
      <div class="section">
        <div class="section-title">Editor Preferences</div>
        
        <div class="setting-row">
          <div>
            <div class="setting-label">Font Size</div>
            <div class="setting-desc">Base font size for the editor</div>
          </div>
          <input type="number" style="width: 80px; background: #111; color: #fff; border: 1px solid #333; padding: 6px; border-radius: 4px;" 
            .value=\${this.fontSize.toString()} 
            @change=\${(e: any) => this.updateSetting('editor.fontSize', parseInt(e.target.value))} />
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Word Wrap</div>
            <div class="setting-desc">Wrap lines that exceed the editor width</div>
          </div>
          <input type="checkbox" .checked=\${this.wordWrap} @change=\${(e: any) => this.updateSetting('editor.wordWrap', e.target.checked)} />
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Line Numbers</div>
            <div class="setting-desc">Show line numbers in source mode</div>
          </div>
          <input type="checkbox" .checked=\${this.lineNumbers} @change=\${(e: any) => this.updateSetting('editor.lineNumbers', e.target.checked)} />
        </div>
      </div>
      
      <div class="section">
        <div class="section-title">Files</div>
        <div class="setting-row">
          <div>
            <div class="setting-label">Vault Location</div>
            <div class="setting-desc">\${this.vaultPath || 'Default Documents/WriteMD folder'}</div>
          </div>
          <button style="padding: 6px 12px; background: #222; border: 1px solid #444; color: #fff; border-radius: 4px; cursor: pointer;" @click=\${this.handleVaultSelect}>Change</button>
        </div>
      </div>
    \`
  }

  private renderAI() {
    return html\`
      <div class="section" style="text-align: center; padding: 40px 0; color: #666;">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 16px;">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
        <h3 style="color: #fff; margin-bottom: 8px;">AI Features</h3>
        <p>AI integrations are currently disabled in this workspace.</p>
      </div>
    \`
  }

  private renderAbout() {
    return html\`
      <div class="section">
        <div class="section-title">WriteMD</div>
        <div class="setting-row">
          <div>
            <div class="setting-label">Version</div>
            <div class="setting-desc">1.0.0-beta</div>
          </div>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-label">Reset</div>
            <div class="setting-desc">Restore all preferences to default values</div>
          </div>
          <button style="padding: 6px 12px; background: transparent; border: 1px solid #ff4444; color: #ff4444; border-radius: 4px; cursor: pointer;" @click=\${this.handleReset}>Reset All</button>
        </div>
      </div>
    \`
  }
}
`;

fs.writeFileSync('src/renderer/src/components/SettingsModal.ts', code);
