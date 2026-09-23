import { html, css, LitElement } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import type { ElectronAPI } from '../../../shared/electron-api'
import { SettingsStore } from '../state/settings'
import { showConfirm } from './ConfirmDialog'
import { scrollbarStyles } from './scrollbars'
import {
  COMMANDS,
  commandTitle,
  effectiveBinding,
  findConflict,
  formatBinding,
  normalizeBinding,
  parseBinding
} from '../state/shortcuts'

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

type SettingsTab = 'general' | 'appearance' | 'editor' | 'files' | 'shortcuts' | 'advanced' | 'ai' | 'about'

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
  '#00c4cc' // Cyan
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
  static styles = css`
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
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    .modal-dialog {
      width: min(900px, 94vw);
      height: min(700px, 90vh);
      display: flex;
      background: var(--bg-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      box-shadow: var(--shadow-3);
      overflow: hidden;
      color: var(--text);
    }

    /* Sidebar Navigation */
    .sidebar {
      width: 230px;
      flex-shrink: 0;
      background: var(--bg-elevated);
      border-right: none;
      display: flex;
      flex-direction: column;
    }

    .sidebar-search {
      padding: 16px 16px 8px 16px;
    }

    .sidebar-search input {
      width: 100%;
      box-sizing: border-box;
      background: var(--bg-hover);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 8px 12px;
      color: var(--text);
      font-size: 13px;
      outline: none;
    }
    .sidebar-search input:focus {
      border-color: var(--border);
    }

    .sidebar-nav {
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
      overflow-y: auto;
    }

    .nav-group {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      padding: 12px 12px 4px 12px;
    }

    .nav-btn {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      background: transparent;
      border: none;
      cursor: pointer;
      text-align: left;
      transition: all 0.15s ease;
    }

    .nav-btn svg {
      width: 16px;
      height: 16px;
      opacity: 0.7;
      flex-shrink: 0;
    }

    .nav-btn:hover {
      background: var(--bg-hover);
      color: var(--text);
    }

    .nav-btn.active {
      background: var(--bg-active);
      color: var(--text);
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
      flex-shrink: 0;
    }

    .main-header h2 {
      font-size: 15px;
      font-weight: 600;
      margin: 0;
      color: var(--text);
    }

    .close-btn {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      color: var(--text-secondary);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .close-btn:hover {
      background: var(--bg-hover);
      color: var(--text);
    }

    .content-panel {
      flex: 1;
      padding: 8px 24px 24px 24px;
      overflow-y: auto;
    }

    /* Card sections */
    .section {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      padding: 4px 20px;
      margin-bottom: 24px;
    }
    .section-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
      margin: 0 0 12px 4px;
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
      border-color: var(--border-focus);
    }

    .theme-box {
      width: 72px;
      height: 64px;
      border-radius: 6px;
      background: var(--bg-gutter);
      display: flex;
      overflow: hidden;
    }

    .theme-box-left {
      flex: 1;
    }
    .theme-box-right {
      flex: 1;
    }

    .theme-name {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
    }
    .theme-card.active .theme-name {
      color: var(--text);
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
      border-color: var(--border-focus);
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
      color: var(--bg-elevated);
    }

    /* Font Grid */
    .font-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }

    .font-card {
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: all 0.2s ease;
    }

    .font-card:hover {
      border-color: var(--text-muted);
    }

    .font-card.active {
      border-color: var(--border-focus);
    }

    .font-info {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .font-name {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-secondary);
    }
    .font-card.active .font-name {
      color: var(--text);
    }

    .font-type {
      font-size: 12px;
      color: var(--text-muted);
    }

    .font-card svg {
      color: var(--text);
      width: 20px;
      height: 20px;
    }

    /* Card rows */
    .setting-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 24px;
      padding: 14px 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .setting-row:last-child {
      border-bottom: none;
    }
    .setting-label {
      font-size: 14px;
      font-weight: 500;
      color: var(--text);
    }
    .setting-desc {
      font-size: 13px;
      color: var(--text-secondary);
      margin-top: 4px;
      line-height: 1.5;
    }

    .control-btn {
      padding: 6px 12px;
      background: var(--bg-hover);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      flex-shrink: 0;
    }
    .control-btn:hover {
      background: var(--bg-active);
    }

    .select-input {
      background: transparent;
      border: none;
      color: var(--text);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      outline: none;
      text-align: right;
      flex-shrink: 0;
    }
    .select-input option {
      background: var(--bg-elevated);
      color: var(--text);
    }

    .text-input {
      width: 200px;
      background: var(--bg-hover);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 10px;
      color: var(--text);
      font-size: 13px;
      outline: none;
      flex-shrink: 0;
    }
    .text-input:focus {
      border-color: var(--border-focus);
    }

    .danger-btn {
      background: transparent;
      border: 1px solid var(--danger);
      color: var(--danger);
    }
    .danger-btn:hover {
      background: var(--danger-bg);
    }

    /* Toggle Switch */
    .toggle-switch {
      position: relative;
      width: 36px;
      height: 20px;
      border-radius: 99px;
      background: var(--bg-hover);
      cursor: pointer;
      border: 1px solid var(--border);
      padding: 0;
      outline: none;
      transition:
        background 0.2s,
        border-color 0.2s;
    }
    .toggle-switch[aria-checked='true'] {
      background: var(--accent);
      border-color: var(--accent);
    }
    .toggle-switch::after {
      content: '';
      position: absolute;
      top: 1px;
      left: 1px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--text-muted);
      transition:
        transform 0.2s,
        background 0.2s;
    }
    .toggle-switch[aria-checked='true']::after {
      transform: translateX(16px);
      background: var(--accent-text);
    }
    ${scrollbarStyles}
  `

  @state() private tab: SettingsTab = 'general'

  // Settings State
  @state() private vaultPath = ''
  @state() private theme = 'dark'
  @state() private accentColor = '#ffffff'
  @state() private fontFamily = 'Inter'
  @state() private fontSize = 15
  @state() private wordWrap = true
  @state() private autoSave = true
  @state() private lineNumbers = false
  @state() private enableMermaid = true
  @state() private spellCheck = false
  @state() private cleanupImages = 'prompt'
  @state() private defaultNewFileName = 'Untitled.md'
  @state() private pdfPageSize = 'A4'
  @state() private pdfTheme = 'light'
  @state() private pdfMargin = 24
  @state() private appVersion = ''
  @state() private panelOrientation: 'horizontal' | 'vertical' = 'horizontal'
  @state() private updateStatus: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error' = 'idle'
  @state() private updateVersion = ''
  @state() private updateError = ''
  @state() private downloadProgress = 0
  @state() private capturingId: string | null = null
  @state() private conflictMsg = ''

  private updaterUnsubs: Array<() => void> = []

  // AI State
  @state() private aiProvider = 'OpenAI'
  @state() private aiModel = 'gpt-4o'
  @state() private aiApiKey = ''
  @state() private availableModels: string[] = []
  @state() private isFetchingModels = false
  @state() private fetchError = ''

  private settingsStore = SettingsStore.getInstance()

  connectedCallback(): void {
    super.connectedCallback()
    this.loadCurrentSettings()
    window.addEventListener('keydown', this.handleKeyDown)
    this.addEventListener('click', this.handleBackdropClick)
    void api()
      ?.app?.getVersion?.()
      .then((v) => (this.appVersion = v))
      .catch(() => undefined)

    const updater = api()?.updater
    if (updater) {
      const u1 = updater.onUpdateAvailable?.((info) => {
        this.updateStatus = 'available'
        this.updateVersion = info?.version ?? ''
        this.updateError = ''
      })
      const u2 = updater.onUpdateNotAvailable?.(() => {
        this.updateStatus = 'up-to-date'
        this.updateError = ''
      })
      const u3 = updater.onUpdateDownloaded?.((info) => {
        this.updateStatus = 'downloaded'
        this.updateVersion = info?.version ?? this.updateVersion
        this.downloadProgress = 100
      })
      const u4 = updater.onDownloadProgress?.((p) => {
        this.updateStatus = 'downloading'
        this.downloadProgress = Math.round(p.percent ?? 0)
      })
      const u5 = updater.onError?.((err) => {
        this.updateStatus = 'error'
        this.updateError = err
      })
      if (u1) this.updaterUnsubs.push(u1)
      if (u2) this.updaterUnsubs.push(u2)
      if (u3) this.updaterUnsubs.push(u3)
      if (u4) this.updaterUnsubs.push(u4)
      if (u5) this.updaterUnsubs.push(u5)
    }
  }

  disconnectedCallback(): void {
    window.removeEventListener('keydown', this.handleKeyDown)
    this.removeEventListener('click', this.handleBackdropClick)
    this.updaterUnsubs.forEach((fn) => fn())
    this.updaterUnsubs = []
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
    this.enableMermaid = s.get('advanced.enableMermaid', true)
    this.spellCheck = s.get('advanced.spellCheck', false)
    this.cleanupImages = s.get('files.cleanupUnusedImages', 'prompt')
    this.defaultNewFileName = s.get('files.defaultNewFileName', 'Untitled.md')
    this.pdfPageSize = s.get('export.pdfPageSize', 'A4')
    this.pdfTheme = s.get('export.pdfTheme', 'light')
    this.pdfMargin = s.get('export.pdfMargin', 24)
    this.panelOrientation = s.get('appearance.panelOrientation', 'horizontal') as 'horizontal' | 'vertical'
    this.aiProvider = s.get('ai.provider', 'OpenAI')
    this.aiModel = s.get('ai.model', 'gpt-4o')
    this.aiApiKey = s.get('ai.apiKey', '')

    const defaults: Record<string, string[]> = {
      OpenAI: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      Anthropic: [
        'claude-3-5-sonnet-20240620',
        'claude-3-opus-20240229',
        'claude-3-haiku-20240307'
      ],
      GoogleGemini: ['gemini-1.5-pro', 'gemini-1.5-flash'],
      Mistral: ['mistral-large-latest', 'open-mixtral-8x22b'],
      Groq: ['llama3-70b-8192', 'llama3-8b-8192', 'mixtral-8x7b-32768'],
      DeepSeek: ['deepseek-chat', 'deepseek-coder'],
      xAI: ['grok-2', 'grok-2-mini'],
      OpenRouter: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-1.5-pro'],
      Ollama: ['llama3', 'mistral', 'phi3']
    }

    if (this.availableModels.length === 0) {
      this.availableModels = defaults[this.aiProvider] || []
      if (this.aiModel && !this.availableModels.includes(this.aiModel)) {
        this.availableModels.unshift(this.aiModel)
      }
    }
  }

  private updateSetting(key: string, value: unknown): void {
    this.settingsStore.set(key, value)
    this.loadCurrentSettings()
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (this.capturingId) {
      e.preventDefault()
      e.stopPropagation()
      this.finishCapture(e)
      return
    }
    if (e.key === 'Escape') this.close()
  }

  private shortcutOverrides(): Record<string, string> {
    return { ...this.settingsStore.get<Record<string, string>>('shortcuts.bindings', {}) }
  }

  private finishCapture(e: KeyboardEvent): void {
    const id = this.capturingId
    if (!id) return
    if (e.key === 'Escape') {
      this.capturingId = null
      this.conflictMsg = ''
      return
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const overrides = this.shortcutOverrides()
      delete overrides[id]
      this.settingsStore.set('shortcuts.bindings', overrides)
      this.capturingId = null
      this.conflictMsg = ''
      return
    }
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
    const raw = `${e.ctrlKey || e.metaKey ? 'Ctrl+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.altKey ? 'Alt+' : ''}${e.key}`
    const normalized = normalizeBinding(raw)
    if (!normalized) {
      this.capturingId = null
      return
    }
    const overrides = this.shortcutOverrides()
    const parsed = parseBinding(normalized)
    const conflict = parsed ? findConflict(id, parsed, overrides) : null
    if (conflict) {
      this.conflictMsg = `${normalized} is already used by ${commandTitle(conflict)}`
      return
    }
    overrides[id] = normalized
    this.settingsStore.set('shortcuts.bindings', overrides)
    this.capturingId = null
    this.conflictMsg = ''
  }

  private handleResetShortcuts(): void {
    this.settingsStore.set('shortcuts.bindings', {})
    this.capturingId = null
    this.conflictMsg = ''
  }

  private handleBackdropClick = (e: MouseEvent): void => {
    if (e.target === this) this.close()
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  private async handleVaultSelect(): Promise<void> {
    const electron = api()
    if (!electron) return
    const result = await electron.dialog?.showOpenDialog?.({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: this.vaultPath
    })
    if (result && !result.canceled && result.filePaths.length > 0) {
      this.updateSetting('files.vaultPath', result.filePaths[0])
    }
  }

  private async handleReset(): Promise<void> {
    const confirmed = await showConfirm(
      'Are you sure you want to reset all settings to default?',
      'Reset Settings'
    )
    if (confirmed) {
      this.settingsStore.reset()
      this.loadCurrentSettings()
    }
  }

  private async fetchModels(): Promise<void> {
    this.fetchError = ''
    if (!this.aiApiKey && this.aiProvider !== 'Ollama') {
      this.fetchError = 'API Key required'
      return
    }
    this.isFetchingModels = true
    this.availableModels = []
    try {
      const electron = api()
      if (!electron) throw new Error('No electron API')

      const models = await electron.net.fetchModels(this.aiProvider, this.aiApiKey)
      if (models && models.length > 0) {
        this.availableModels = models
        if (!this.availableModels.includes(this.aiModel)) {
          this.aiModel = this.availableModels[0]
          this.updateSetting('ai.model', this.aiModel)
        }
      } else {
        throw new Error('No models returned')
      }
    } catch (e) {
      console.error('Failed to fetch models', e)
      this.fetchError = e instanceof Error ? e.message : 'Failed to fetch'
    } finally {
      this.isFetchingModels = false
    }
  }

  private handleProviderChange(e: Event): void {
    const provider = (e.target as HTMLSelectElement).value
    this.updateSetting('ai.provider', provider)

    // Set some sensible defaults before fetching
    const defaults: Record<string, string[]> = {
      OpenAI: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      Anthropic: [
        'claude-3-5-sonnet-20240620',
        'claude-3-opus-20240229',
        'claude-3-haiku-20240307'
      ],
      GoogleGemini: ['gemini-1.5-pro', 'gemini-1.5-flash'],
      Mistral: ['mistral-large-latest', 'open-mixtral-8x22b'],
      Groq: ['llama3-70b-8192', 'llama3-8b-8192', 'mixtral-8x7b-32768'],
      DeepSeek: ['deepseek-chat', 'deepseek-coder'],
      xAI: ['grok-2', 'grok-2-mini'],
      OpenRouter: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-1.5-pro'],
      Ollama: ['llama3', 'mistral', 'phi3']
    }

    this.availableModels = defaults[provider] || []
    if (this.availableModels.length > 0) {
      this.updateSetting('ai.model', this.availableModels[0])
    }
  }

  private async handleCheckForUpdates(): Promise<void> {
    const updater = api()?.updater
    if (!updater) return
    this.updateStatus = 'checking'
    this.updateError = ''
    try {
      const result = await updater.check()
      if (!result) {
        this.updateStatus = 'up-to-date'
      }
    } catch (e) {
      this.updateStatus = 'error'
      this.updateError = e instanceof Error ? e.message : String(e)
    }
  }

  private async handleDownloadUpdate(): Promise<void> {
    const updater = api()?.updater
    if (!updater) return
    this.updateStatus = 'downloading'
    this.downloadProgress = 0
    try {
      await updater.download()
    } catch (e) {
      this.updateStatus = 'error'
      this.updateError = e instanceof Error ? e.message : String(e)
    }
  }

  private handleInstallUpdate(): void {
    void api()?.updater?.install?.()
  }

  render(): unknown {
    return html`
      <div
        class="modal-dialog"
        role="dialog"
        aria-modal="true"
        @click=${(e: MouseEvent) => e.stopPropagation()}
      >
        <!-- Sidebar Navigation -->
        <div class="sidebar">
          <div class="sidebar-search">
            <input type="text" placeholder="Search settings..." />
          </div>
          <div class="sidebar-nav">
            <div class="nav-group">Workspace</div>
            <button
              class="nav-btn ${this.tab === 'general' ? 'active' : ''}"
              @click=${() => (this.tab = 'general')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
              </svg>
              General
            </button>
            <button
              class="nav-btn ${this.tab === 'editor' ? 'active' : ''}"
              @click=${() => (this.tab = 'editor')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              Editor
            </button>
            <button
              class="nav-btn ${this.tab === 'files' ? 'active' : ''}"
              @click=${() => (this.tab = 'files')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              Files & Vault
            </button>
            <div class="nav-group">Application</div>
            <button
              class="nav-btn ${this.tab === 'appearance' ? 'active' : ''}"
              @click=${() => (this.tab = 'appearance')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                <path d="M2 12h20" />
              </svg>
              Appearance
            </button>
            <button
              class="nav-btn ${this.tab === 'shortcuts' ? 'active' : ''}"
              @click=${() => (this.tab = 'shortcuts')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6" />
              </svg>
              Shortcuts
            </button>
            <button
              class="nav-btn ${this.tab === 'advanced' ? 'active' : ''}"
              @click=${() => (this.tab = 'advanced')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3" />
                <path
                  d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
                />
              </svg>
              Advanced
            </button>
            <div class="nav-group">Plugins</div>
            <button
              class="nav-btn ${this.tab === 'ai' ? 'active' : ''}"
              @click=${() => (this.tab = 'ai')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path
                  d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                />
              </svg>
              AI Assistant
            </button>
            <button
              class="nav-btn ${this.tab === 'about' ? 'active' : ''}"
              @click=${() => (this.tab = 'about')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
              About
            </button>
          </div>
        </div>

        <!-- Main Area -->
        <div class="main-area">
          <div class="main-header">
            <h2>
              ${this.tab === 'files' ? 'Files & Vault' : this.tab.charAt(0).toUpperCase() + this.tab.slice(1)}
            </h2>
            <button class="close-btn" @click=${this.close}>
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div class="content-panel">
            ${this.tab === 'general' ? this.renderGeneral() : ''}
            ${this.tab === 'appearance' ? this.renderAppearance() : ''}
            ${this.tab === 'editor' ? this.renderEditor() : ''}
            ${this.tab === 'files' ? this.renderFiles() : ''}
            ${this.tab === 'shortcuts' ? this.renderShortcuts() : ''}
            ${this.tab === 'advanced' ? this.renderAdvanced() : ''}
            ${this.tab === 'ai' ? this.renderAI() : ''}
            ${this.tab === 'about' ? this.renderAbout() : ''}
          </div>
        </div>
      </div>
    `
  }

  private renderGeneral(): unknown {
    return html`
      <div class="section-title">New files</div>
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">Default file name</div>
            <div class="setting-desc">Name used for new vault files</div>
          </div>
          <input
            type="text"
            class="text-input"
            .value=${this.defaultNewFileName}
            @change=${(e: Event) =>
              this.updateSetting('files.defaultNewFileName', (e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Spell check</div>
            <div class="setting-desc">Underline misspelled words while writing</div>
          </div>
          <button
            class="toggle-switch"
            role="switch"
            aria-checked="${this.spellCheck}"
            @click=${() => this.updateSetting('advanced.spellCheck', !this.spellCheck)}
          ></button>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Unused images</div>
            <div class="setting-desc">What to do with images no longer referenced</div>
          </div>
          <select
            class="select-input"
            .value=${this.cleanupImages}
            @change=${(e: Event) => this.updateSetting('files.cleanupUnusedImages', (e.target as HTMLSelectElement).value)}
          >
            <option value="prompt">Ask me</option>
            <option value="keep">Keep</option>
            <option value="delete">Delete</option>
          </select>
        </div>
      </div>
    `
  }

  private renderAppearance(): unknown {
    return html`
      <div class="section-title">Theme</div>
      <div class="section">
        <div class="theme-grid">
          ${THEME_PREVIEWS.map(
            (t) => html`
              <div
                class="theme-card ${this.theme === t.id ? 'active' : ''}"
                @click=${() => this.updateSetting('appearance.theme', t.id)}
              >
                <div class="theme-box-wrapper">
                  <div class="theme-box">
                    <div class="theme-box-left" style="background: ${t.c1}"></div>
                    <div class="theme-box-right" style="background: ${t.c2}"></div>
                  </div>
                </div>
                <span class="theme-name">${t.name}</span>
              </div>
            `
          )}
        </div>
      </div>

      <div class="section-title">Accent Color</div>
      <div class="section">
        <div class="color-row">
          ${ACCENT_COLORS.map(
            (c, i) => html`
              <div
                class="color-circle-wrapper ${this.accentColor === c ? 'active' : ''}"
                @click=${() => this.updateSetting('appearance.accentColor', c)}
              >
                <div class="color-circle" style="background: ${c}">
                  ${
                    i === 0
                      ? html`
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="3"
                          >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        `
                      : ''
                  }
                </div>
              </div>
            `
          )}
        </div>
      </div>

      <div class="section-title">Panel Layout</div>
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">Vertical panel</div>
            <div class="setting-desc">Stack split panes vertically instead of side by side</div>
          </div>
          <button
            class="toggle-switch"
            role="switch"
            aria-checked="${this.panelOrientation === 'vertical'}"
            @click=${() => this.updateSetting('appearance.panelOrientation', this.panelOrientation === 'vertical' ? 'horizontal' : 'vertical')}
          ></button>
        </div>
      </div>
    `
  }

  private renderEditor(): unknown {
    return html`
      <div class="section-title">Font</div>
      <div class="section">
        <div class="font-grid">
          ${FONT_FAMILIES.map(
            (f) => html`
              <div
                class="font-card ${this.fontFamily === f.id ? 'active' : ''}"
                @click=${() => this.updateSetting('editor.fontFamily', f.id)}
              >
                <div class="font-info">
                  <span class="font-name" style="font-family: ${f.id}">${f.name}</span>
                  <span class="font-type">${f.type}</span>
                </div>
                ${
                  this.fontFamily === f.id
                    ? html`
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.5"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      `
                    : ''
                }
              </div>
            `
          )}
        </div>
      </div>

      <div class="section-title">Preferences</div>
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">Font Size</div>
            <div class="setting-desc">Base font size for the editor</div>
          </div>
          <input
            type="number"
            class="text-input"
            style="width: 80px;"
            .value=${this.fontSize.toString()}
            @change=${(e: Event) =>
              this.updateSetting('editor.fontSize', parseInt((e.target as HTMLInputElement).value))}
          />
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Word Wrap</div>
            <div class="setting-desc">Wrap lines that exceed the editor width</div>
          </div>
          <button
            class="toggle-switch"
            role="switch"
            aria-checked="${this.wordWrap}"
            @click=${() => this.updateSetting('editor.wordWrap', !this.wordWrap)}
          ></button>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Line Numbers</div>
            <div class="setting-desc">Show line numbers in source mode</div>
          </div>
          <button
            class="toggle-switch"
            role="switch"
            aria-checked="${this.lineNumbers}"
            @click=${() => this.updateSetting('editor.lineNumbers', !this.lineNumbers)}
          ></button>
        </div>
      </div>
    `
  }

  private renderFiles(): unknown {
    return html`
      <div class="section-title">Storage</div>
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">Vault Location</div>
            <div class="setting-desc" style="max-width: 400px; word-break: break-all;">
              ${this.vaultPath || 'Default Documents/WriteMd folder'}
            </div>
          </div>
          <button class="control-btn" @click=${this.handleVaultSelect}>Change</button>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Auto-save</div>
            <div class="setting-desc">Automatically write modifications to disk</div>
          </div>
          <button
            class="toggle-switch"
            role="switch"
            aria-checked="${this.autoSave}"
            @click=${() => this.updateSetting('files.autoSave', !this.autoSave)}
          ></button>
        </div>
      </div>
    `
  }

  private renderShortcuts(): unknown {
    const overrides = this.shortcutOverrides()
    const categories = [...new Set(COMMANDS.map((c) => c.category))]
    return html`
      <div class="section-title">Keyboard Shortcuts</div>
      <div class="section">
        <div class="setting-desc" style="margin-bottom: 8px;">
          Click a binding to rebind it. Backspace clears, Esc cancels.
        </div>
        ${
          this.conflictMsg
            ? html`<div class="setting-desc" style="color: var(--danger); margin-bottom: 8px;">
                ${this.conflictMsg}
              </div>`
            : ''
        }
      </div>
      ${categories.map(
        (cat) => html`
          <div class="section-title">${cat}</div>
          <div class="section">
            ${COMMANDS.filter((c) => c.category === cat).map((c) => {
              const binding = effectiveBinding(c.id, overrides)
              const capturing = this.capturingId === c.id
              return html`
                <div class="setting-row">
                  <div>
                    <div class="setting-label">${c.title}</div>
                  </div>
                  <button class="control-btn" @click=${() => (this.capturingId = c.id)}>
                    ${capturing ? 'Press keys...' : binding ? formatBinding(binding) : 'Not set'}
                  </button>
                </div>
              `
            })}
          </div>
        `
      )}
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">Reset Shortcuts</div>
            <div class="setting-desc">Restore all bindings to their defaults</div>
          </div>
          <button class="control-btn" @click=${this.handleResetShortcuts}>Reset All</button>
        </div>
      </div>
    `
  }

  private renderAdvanced(): unknown {
    return html`
      <div class="section-title">Features</div>
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">Enable Mermaid</div>
            <div class="setting-desc">Render Mermaid diagrams in live preview</div>
          </div>
          <button
            class="toggle-switch"
            role="switch"
            aria-checked="${this.enableMermaid}"
            @click=${() => this.updateSetting('advanced.enableMermaid', !this.enableMermaid)}
          ></button>
        </div>
      </div>

      <div class="section-title">Export</div>
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">PDF page size</div>
            <div class="setting-desc">Paper size for PDF export</div>
          </div>
          <select
            class="select-input"
            .value=${this.pdfPageSize}
            @change=${(e: Event) => this.updateSetting('export.pdfPageSize', (e.target as HTMLSelectElement).value)}
          >
            <option value="A4">A4</option>
            <option value="A5">A5</option>
            <option value="Letter">Letter</option>
            <option value="Legal">Legal</option>
            <option value="Tabloid">Tabloid</option>
          </select>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">PDF theme</div>
            <div class="setting-desc">Color scheme for exported documents</div>
          </div>
          <select
            class="select-input"
            .value=${this.pdfTheme}
            @change=${(e: Event) => this.updateSetting('export.pdfTheme', (e.target as HTMLSelectElement).value)}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">PDF margin</div>
            <div class="setting-desc">Page margin in millimeters</div>
          </div>
          <input
            type="number"
            class="text-input"
            style="width: 80px;"
            .value=${this.pdfMargin.toString()}
            @change=${(e: Event) => this.updateSetting('export.pdfMargin', Math.max(0, parseInt((e.target as HTMLInputElement).value, 10) || 0))}
          />
        </div>
      </div>

      <div class="section-title">Danger Zone</div>
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">Reset Preferences</div>
            <div class="setting-desc">Restore all options to their factory defaults</div>
          </div>
          <button class="control-btn danger-btn" @click=${this.handleReset}>Reset All</button>
        </div>
      </div>
    `
  }

  private renderAI(): unknown {
    return html`
      <div class="section-title">AI Assistant Config</div>
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">Provider</div>
            <div class="setting-desc">Select your AI backend provider</div>
          </div>
          <select
            class="select-input"
            .value=${this.aiProvider}
            @change=${this.handleProviderChange}
          >
            <option value="OpenAI">OpenAI</option>
            <option value="Anthropic">Anthropic</option>
            <option value="GoogleGemini">Google Gemini</option>
            <option value="Mistral">Mistral</option>
            <option value="Groq">Groq</option>
            <option value="OpenRouter">OpenRouter</option>
            <option value="DeepSeek">DeepSeek</option>
            <option value="xAI">xAI (Grok)</option>
            <option value="Ollama">Ollama (Local)</option>
          </select>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Model</div>
            <div class="setting-desc">
              Specify the model to use (e.g. gpt-4o, claude-3.5-sonnet, gemini-1.5-pro, llama3)
            </div>
          </div>
          <div style="display: flex; gap: 8px; flex-direction: column; align-items: flex-end;">
            <div style="display: flex; gap: 8px;">
              <select
                class="select-input"
                .value=${this.aiModel}
                @change=${(e: Event) => this.updateSetting('ai.model', (e.target as HTMLSelectElement).value)}
              >
                ${
                  this.availableModels.length > 0
                    ? this.availableModels.map(
                        (m) =>
                          html`<option value=${m} ?selected=${this.aiModel === m}>${m}</option>`
                      )
                    : html`<option value=${this.aiModel}>${this.aiModel}</option>`
                }
              </select>
              <button
                class="control-btn"
                @click=${this.fetchModels}
                ?disabled=${this.isFetchingModels}
              >
                ${this.isFetchingModels ? 'Loading...' : 'Fetch'}
              </button>
            </div>
            ${this.fetchError ? html`<div class="setting-desc" style="color: var(--danger);">${this.fetchError}</div>` : ''}
          </div>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">API Key</div>
            <div class="setting-desc">Your secret API key (saved locally)</div>
          </div>
          <input
            type="password"
            class="text-input"
            placeholder="sk-..."
            .value=${this.aiApiKey}
            @change=${(e: Event) => this.updateSetting('ai.apiKey', (e.target as HTMLInputElement).value)}
          />
        </div>
      </div>
    `
  }

  private renderAbout(): unknown {
    const statusText = (() => {
      switch (this.updateStatus) {
        case 'checking':
          return 'Checking for updates...'
        case 'available':
          return this.updateVersion ? `Update available: v${this.updateVersion}` : 'Update available'
        case 'downloading':
          return `Downloading... ${this.downloadProgress}%`
        case 'downloaded':
          return this.updateVersion ? `Update v${this.updateVersion} ready` : 'Update ready'
        case 'up-to-date':
          return 'You are up to date'
        case 'error':
          return this.updateError || 'Update check failed'
        default:
          return 'Check for new versions'
      }
    })()

    return html`
      <div class="section-title">About</div>
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">WriteMd Desktop</div>
            <div class="setting-desc">v${this.appVersion || '1.0.0'}</div>
          </div>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-label">Updates</div>
            <div class="setting-desc">${statusText}</div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            ${this.updateStatus === 'available'
              ? html`<button class="control-btn" @click=${this.handleDownloadUpdate}>Download</button>`
              : ''}
            ${this.updateStatus === 'downloaded'
              ? html`<button class="control-btn" style="background: var(--accent); color: var(--accent-text); border-color: var(--accent);" @click=${this.handleInstallUpdate}>Restart to update</button>`
              : ''}
            ${this.updateStatus === 'checking' || this.updateStatus === 'downloading'
              ? html`<button class="control-btn" disabled>
                  ${this.updateStatus === 'checking' ? 'Checking...' : `${this.downloadProgress}%`}
                </button>`
              : html`<button class="control-btn" @click=${this.handleCheckForUpdates}>Check for updates</button>`}
          </div>
        </div>
        ${this.updateStatus === 'error'
          ? html`<div class="setting-desc" style="color: var(--danger); padding: 8px 0 8px 0;">
              ${this.updateError}
            </div>`
          : ''}
      </div>
    `
  }
}
