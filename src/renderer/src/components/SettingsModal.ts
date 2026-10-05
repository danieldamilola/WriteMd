import { html, css, LitElement, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { api } from '../api'
import { deepActiveElement } from '../utils/links'
import { MOTION_LABELS, MOTION_PREFERENCES, type MotionPreference } from '../utils/motion'
import { DEFAULT_AI_SYSTEM_PROMPT } from '../../../shared/settings-schema'
import { SettingsStore } from '../state/settings'
import { emit } from '../events/bus'
import { showConfirm } from './ConfirmDialog'
import { icon } from './icons'
import { scrollbarStyles } from './scrollbars'
import { summarizeNotesForVersion } from '../services/whats-new'
import {
  COMMANDS,
  commandTitle,
  effectiveBinding,
  findConflict,
  formatBinding,
  normalizeBinding,
  parseBinding
} from '../state/shortcuts'
import {
  TAB_LABELS,
  searchSettingsRows,
  searchSettingsTabs,
  searchTargetTab,
  searchTokens,
  type SettingsTab
} from '../state/settings-search'

/**
 * The element that actually holds focus, descending through open shadow roots.
 *
 * `document.activeElement` only ever reports the outermost host, so capturing it
 * and calling focus() on it later restores nothing: the host is not focusable
 * and focus falls back to body. The settings button that opens this modal lives
 * inside `writemd-top-bar`'s shadow root, so the real target is two levels down.
 */

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
  { id: 'JetBrains Mono', name: 'JetBrains Mono', type: 'Monospace' },
  { id: 'Geist Mono', name: 'Geist Mono', type: 'Monospace' }
]

/**
 * Known models per provider, shown until the live list arrives. This lived as
 * two identical literals inside the class; a third partial copy sits in the
 * shared schema. One definition, referenced by both call sites.
 */
const PROVIDER_MODEL_DEFAULTS: Record<string, string[]> = {
  OpenAI: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  Anthropic: ['claude-3-5-sonnet-20240620', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
  GoogleGemini: ['gemini-1.5-pro', 'gemini-1.5-flash'],
  Mistral: ['mistral-large-latest', 'open-mixtral-8x22b'],
  Groq: ['llama3-70b-8192', 'llama3-8b-8192', 'mixtral-8x7b-32768'],
  DeepSeek: ['deepseek-chat', 'deepseek-coder'],
  xAI: ['grok-2', 'grok-2-mini'],
  OpenRouter: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-1.5-pro'],
  // Local CLI: model is free-text provider/model (or empty for CLI default).
  OpenCode: [],
  Nvidia: [
    'meta/llama-3.3-70b-instruct',
    'deepseek-ai/deepseek-r1',
    'qwen/qwen2.5-coder-32b-instruct',
    'nvidia/llama-3.1-nemotron-70b-instruct',
    'mistralai/mixtral-8x22b-instruct-v0.1'
  ],
  Ollama: ['llama3', 'mistral', 'phi3']
}

@customElement('writemd-settings-modal')
export class SettingsModal extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 300;
      background: var(--bg-frame);
    }

    .modal-dialog {
      width: 100%;
      height: 100%;
      display: flex;
      background: var(--bg-elevated);
      border: none;
      border-radius: 0;
      box-shadow: none;
      overflow: hidden;
      color: var(--text);
    }

    /* Sidebar Navigation */
    .sidebar {
      width: 250px;
      flex-shrink: 0;
      background: var(--bg-elevated);
      border-right: 1px solid var(--border-subtle);
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

    .search-status {
      font-size: 11px;
      color: var(--text-muted);
      padding: 6px 2px 0 2px;
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

    /* The hidden attribute loses to the class display rule without this. */
    .nav-btn[hidden] {
      display: none;
    }

    /* Classic popup: centered dialog over a dimmed app, no shell chrome. */
    :host(.classic) {
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.5);
    }
    :host(.classic) .modal-dialog {
      width: min(900px, 94vw);
      height: min(700px, 90vh);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      box-shadow: var(--shadow-3);
    }
    :host(.classic) .sidebar {
      width: 230px;
    }
    :host(.classic) .sidebar-footer,
    :host(.classic) .win-controls {
      display: none;
    }
    :host(.classic) .main-header {
      padding: 0 24px;
    }
    .modal-dialog .close-btn {
      display: none;
      width: 32px;
      height: 32px;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      color: var(--text-secondary);
      border-radius: 6px;
      cursor: pointer;
    }
    .modal-dialog .close-btn:hover {
      background: var(--bg-hover);
      color: var(--text);
    }
    :host(.classic) .modal-dialog .close-btn {
      display: flex;
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
      padding: 0 8px 0 24px;
      flex-shrink: 0;
      -webkit-app-region: drag;
    }

    .main-header h2 {
      font-size: 15px;
      font-weight: 600;
      margin: 0;
      color: var(--text);
    }

    /* Window controls mirror the top bar: no new visual language. */
    .win-controls {
      display: flex;
      align-items: stretch;
      align-self: stretch;
      -webkit-app-region: no-drag;
    }
    .win-btn {
      width: 46px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
    }
    .win-btn:hover {
      background: var(--bg-hover);
      color: var(--text);
    }
    .win-btn.close:hover {
      background: #e81123;
      color: #fff;
    }

    /* Back lives in the sidebar footer, beside the window chrome of the app. */
    .sidebar-footer {
      padding: 12px;
      border-top: 1px solid var(--border-subtle);
    }
    .back-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      background: transparent;
      border: none;
      cursor: pointer;
      text-align: left;
    }
    .back-btn:hover {
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

    .beta-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--accent-text);
      background: var(--accent);
      border-radius: 99px;
      padding: 2px 8px;
      margin-left: 8px;
      vertical-align: 2px;
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

    .setting-row.search-hit,
    .section-title.search-hit {
      background: var(--bg-hover);
      box-shadow: inset 3px 0 0 var(--accent);
    }
    .setting-row.search-hit-active,
    .section-title.search-hit-active {
      background: var(--bg-active);
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
    textarea.text-input.prompt-input {
      width: 100%;
      min-height: 160px;
      resize: vertical;
      line-height: 1.5;
      font-family: inherit;
      box-sizing: border-box;
      flex-shrink: 1;
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
  @state() private searchQuery = ''

  /** Jump to a tab from outside, e.g. the AI panel's "not configured" state. */
  @property({ type: String }) initialTab: SettingsTab = 'general'

  /**
   * `willUpdate`, not `connectedCallback`: Lit commits `.prop` bindings when it
   * renders the element, which is after `connectedCallback` has already run, so
   * reading `initialTab` there always saw the default.
   */
  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('initialTab')) this.tab = this.initialTab
  }

  // Settings State
  @state() private vaultPath = ''
  @state() private theme = 'graphite'
  @state() private accentColor = '#f24e1e'
  @state() private fontFamily = 'Inter'
  @state() private fontSize = 15
  @state() private wordWrap = true
  @state() private autoSave = true
  @state() private lineNumbers = false
  @state() private enableMermaid = true
  @state() private defaultNewFileName = 'Untitled.md'
  @state() private pdfPageSize = 'A4'
  @state() private pdfTheme = 'light'
  @state() private pdfMargin = 24
  @state() private appVersion = ''
  @state() private autoCheckForUpdates = true
  @state() private panelOrientation: 'horizontal' | 'vertical' = 'horizontal'
  @state() private motion: MotionPreference = 'system'
  @state() private newSettingsDesign = true
  @state() private updateStatus:
    'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error' =
    'idle'
  @state() private updateVersion = ''
  @state() private updateError = ''
  @state() private downloadProgress = 0
  /** Set once a check reports the newest release was declined earlier. */
  @state() private skippedVersion = ''
  @state() private capturingId: string | null = null
  @state() private conflictMsg = ''

  private updaterUnsubs: Array<() => void> = []

  // AI State
  @state() private aiProvider = 'OpenAI'
  @state() private aiModel = 'gpt-4o'
  @state() private aiApiKey = ''
  @state() private aiKeyStored = false
  @state() private aiKeyUndecryptable = false
  @state() private aiSystemPrompt = DEFAULT_AI_SYSTEM_PROMPT
  @state() private availableModels: string[] = []
  @state() private isFetchingModels = false
  @state() private fetchError = ''
  @state() private opencodeCliFound: boolean | null = null
  @state() private opencodeCliPath: string | null = null
  @state() private opencodeCliVersion: string | null = null
  @state() private opencodeLoginCommand = 'opencode auth login opencode'
  @state() private opencodeAuthLoggedIn: boolean | null = null
  @state() private opencodeAuthDetail = ''
  @state() private opencodeCopied = false
  @state() private opencodeCustomPath = ''
  @state() private opencodeManagedUp: boolean | null = null
  @state() private opencodeDebug: string[] = []
  @state() private opencodeChecking = false
  @state() private webSearchEnabled = false

  private settingsStore = SettingsStore.getInstance()

  connectedCallback(): void {
    super.connectedCallback()
    this.loadCurrentSettings()
    this.previouslyFocused = deepActiveElement() as HTMLElement | null
    window.addEventListener('keydown', this.handleKeyDown, true)
    void api()
      ?.app?.getVersion?.()
      .then((v) => (this.appVersion = v))
      .catch(() => undefined)
    void this.checkOpencodeStatus()

    const updater = api()?.updater
    if (updater) {
      void updater
        .getState()
        .then((state) => {
          if (state.status === 'idle') return
          this.updateStatus = state.status
          this.updateVersion = state.version
          this.downloadProgress = state.percent
          this.updateError = state.error
        })
        .catch(() => undefined)
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
    window.removeEventListener('keydown', this.handleKeyDown, true)
    this.updaterUnsubs.forEach((fn) => fn())
    this.updaterUnsubs = []
    const target = this.previouslyFocused
    this.previouslyFocused = null
    super.disconnectedCallback()
    // Hand focus back to whatever opened the modal instead of dropping it on
    // the body at the top of the document.
    if (target?.isConnected) target.focus()
  }

  private loadCurrentSettings(): void {
    const s = this.settingsStore
    this.theme = s.get('appearance.theme', 'graphite')
    this.accentColor = s.get('appearance.accentColor', '#f24e1e')
    this.fontFamily = s.get('editor.fontFamily', 'Inter')
    this.fontSize = s.get('editor.fontSize', 15)
    this.wordWrap = s.get('editor.wordWrap', true)
    this.autoSave = s.get('editor.autoSave', true)
    this.lineNumbers = s.get('editor.showLineNumbers', false)
    this.vaultPath = s.get('files.vaultPath', '')
    this.enableMermaid = s.get('advanced.enableMermaid', true)
    this.defaultNewFileName = s.get('files.defaultNewFileName', 'Untitled.md')
    this.pdfPageSize = s.get('export.pdfPageSize', 'A4')
    this.pdfTheme = s.get('export.pdfTheme', 'light')
    this.pdfMargin = s.get('export.pdfMargin', 24)
    this.panelOrientation = s.get('appearance.panelOrientation', 'horizontal') as
      'horizontal' | 'vertical'
    this.newSettingsDesign = s.get<boolean>('appearance.newSettingsDesign', true)
    this.motion = s.get('appearance.motion', 'system') as MotionPreference
    this.aiProvider = s.get('ai.provider', 'OpenAI')
    this.aiModel = s.get('ai.model', 'gpt-4o')
    this.aiApiKey = s.get('ai.apiKey', '')
    this.aiKeyStored = s.get<boolean>('ai.apiKeySet', false)
    this.aiKeyUndecryptable = s.get<boolean>('ai.apiKeyUndecryptable', false)
    this.aiSystemPrompt = s.get('ai.systemPrompt', DEFAULT_AI_SYSTEM_PROMPT)
    this.opencodeCustomPath = s.get('ai.opencodeCliPath', '')
    this.webSearchEnabled = s.get<boolean>('ai.webSearchEnabled', false)
    this.autoCheckForUpdates = s.get('updates.autoCheckForUpdates', true)

    if (this.availableModels.length === 0) {
      this.availableModels = [...(PROVIDER_MODEL_DEFAULTS[this.aiProvider] ?? [])]
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
    if (e.key === 'Escape') {
      // Capture phase via the window listener above is shared with
      // ConflictDialog; stopImmediatePropagation keeps one Escape from
      // resolving both.
      e.stopImmediatePropagation()
      this.close()
      return
    }
    if (e.key === 'Tab') this.trapFocus(e)
  }

  /** Keep Tab inside the dialog; the document behind it is not inert. */
  private trapFocus(e: KeyboardEvent): void {
    const focusable = Array.from(
      this.renderRoot?.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ) ?? []
    ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = (this.shadowRoot as ShadowRoot | null)?.activeElement
    if (e.shiftKey && (active === first || !active)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  private previouslyFocused: HTMLElement | null = null

  /** Enter/Space on a theme / accent / font card. */
  private handleCardKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).click()
  }

  /**
   * Route the query to the section that actually holds the match. Auto-save
   * lives under Files, so section keywords alone kept sending it to Editor,
   * where nothing matched.
   */
  private handleSearchInput = (e: InputEvent): void => {
    this.searchQuery = (e.target as HTMLInputElement).value
    this.hitIndex = 0
    const target = searchTargetTab(this.searchQuery)
    if (target && target !== this.tab) this.tab = target
  }

  /** Enter / ArrowDown step through the matches in the open panel. */
  private handleSearchKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    if (this.searchTokens().length === 0) return
    if (this.hitRows.length === 0) {
      const target = searchTargetTab(this.searchQuery)
      if (target) this.tab = target
      return
    }
    const step = e.key === 'ArrowUp' ? -1 : 1
    const next = (this.hitIndex + step + this.hitRows.length) % this.hitRows.length
    this.hitIndex = next
    this.paintHits()
  }

  /** Tabs worth showing for the current query: section words or row matches. */
  private matchingTabs(): SettingsTab[] {
    if (this.searchTokens().length === 0) return searchSettingsTabs('')
    const sections = searchSettingsTabs(this.searchQuery)
    const rows = searchSettingsRows(this.searchQuery).map((r) => r.tab)
    const all = [...new Set([...rows, ...sections])]
    // Nothing matched: keep the whole nav usable instead of blanking the panel
    // behind a sidebar of nothing.
    return all.length > 0 ? all : searchSettingsTabs('')
  }

  private searchTokens(): string[] {
    return searchTokens(this.searchQuery)
  }

  /** What the search box found, counted the same way the nav filters it. */
  private matchStatus(): string {
    const rows = searchSettingsRows(this.searchQuery).length
    if (rows > 0) return rows === 1 ? '1 matching setting' : `${rows} matching settings`
    const sections = searchSettingsTabs(this.searchQuery).length
    if (sections === 1) return '1 matching section'
    return sections > 1 ? `${sections} matching sections` : 'No matches'
  }

  private hitsInPanel(): HTMLElement[] {
    const tokens = this.searchTokens()
    if (tokens.length === 0) return []
    const panel = this.renderRoot.querySelector('.content-panel')
    if (!panel) return []
    const rows = Array.from(panel.querySelectorAll<HTMLElement>('.setting-row'))
    const matched = rows.filter((row) => {
      const text = `${row.textContent ?? ''}`.toLowerCase()
      return tokens.every((t) => text.includes(t))
    })
    if (matched.length > 0) return matched
    // Descriptions and option values are not in the row index (the system
    // prompt has no row at all), so fall back to section titles and index
    // labels before giving up.
    const titles = Array.from(panel.querySelectorAll<HTMLElement>('.section-title')).filter((el) =>
      tokens.every((t) => `${el.textContent ?? ''}`.toLowerCase().includes(t))
    )
    if (titles.length > 0) return titles
    const labels = searchSettingsRows(this.searchQuery)
      .filter((r) => r.tab === this.tab)
      .map((r) => r.label.toLowerCase())
    return rows.filter((row) => {
      const text = `${row.textContent ?? ''}`.toLowerCase()
      return labels.some((l) => text.includes(l))
    })
  }

  /**
   * Highlight matches after every render. Classes are applied here rather than
   * through the templates because a match depends on the text of whatever the
   * panel ended up rendering, including rows built from data (shortcuts).
   */
  protected updated(changed: Map<string, unknown>): void {
    super.updated(changed)
    this.hitRows = this.hitsInPanel()
    if (this.hitIndex >= this.hitRows.length) this.hitIndex = 0
    this.paintHits()
  }

  private hitRows: HTMLElement[] = []
  private hitIndex = 0
  private lastHitKey = ''
  private paintedHits: HTMLElement[] = []

  private paintHits(): void {
    // Lit reuses row nodes across renders, so last pass's marks have to be
    // taken off before the new set goes on.
    for (const el of this.paintedHits) {
      el.classList.remove('search-hit', 'search-hit-active')
    }
    this.paintedHits = this.hitRows
    for (let i = 0; i < this.hitRows.length; i++) {
      this.hitRows[i].classList.add('search-hit')
      this.hitRows[i].classList.toggle('search-hit-active', i === this.hitIndex)
    }
    // Follow the match only when the query, the section, or the active hit
    // moved: a re-render from toggling a switch must not yank the panel.
    const key = `${this.tab}|${this.searchQuery}|${this.hitIndex}`
    if (key === this.lastHitKey) return
    this.lastHitKey = key
    this.hitRows[this.hitIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  /** Sections the search box has not filtered out. */
  private get visibleTabs(): SettingsTab[] {
    return this.matchingTabs()
  }

  /** A nav header with no buttons left under it is just noise. */
  private groupVisible(tabs: SettingsTab[]): boolean {
    return tabs.some((t) => this.visibleTabs.includes(t))
  }

  firstUpdated(): void {
    this.renderRoot?.querySelector<HTMLElement>('input, button')?.focus()
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
      const chosen = result.filePaths[0]
      // `vault:set-path` validates the root with `isSaneVaultRoot` and clears
      // the main process's cache. Writing `files.vaultPath` directly skipped
      // both, which left every path guard measuring against the old root.
      try {
        await electron.vault.setPath(chosen)
        this.vaultPath = chosen
        // The main process already persisted it; this mirrors it into the
        // renderer's local copy so the field shows the new value immediately.
        this.settingsStore.set('files.vaultPath', chosen)
      } catch (err) {
        this.conflictMsg = err instanceof Error ? err.message : 'Could not use that folder'
      }
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

  /**
   * The stored key is never readable, so the field is write-only: an empty
   * input leaves the existing key alone, and typing one replaces it. Clearing
   * the field does not delete the key, because there is no way to confirm the
   * intent without being able to see the value.
   */
  private handleApiKeyInput = (e: Event): void => {
    const value = (e.target as HTMLInputElement).value.trim()
    if (!value) {
      ;(e.target as HTMLInputElement).value = ''
      return
    }
    this.aiApiKey = ''
    this.updateSetting('ai.apiKey', value)
  }

  private async fetchModels(): Promise<void> {
    this.fetchError = ''
    if (
      !this.aiApiKey &&
      !this.aiKeyStored &&
      this.aiProvider !== 'Ollama' &&
      this.aiProvider !== 'OpenCode'
    ) {
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
        emit('ai:models-updated', { models })
        if (!this.availableModels.includes(this.aiModel)) {
          this.aiModel = this.availableModels[0]
          this.updateSetting('ai.model', this.aiModel)
        }
      } else if (this.aiProvider === 'OpenCode') {
        // The CLI model field is free-text (provider/model, or empty for the
        // CLI default); an empty list is not a failure.
        this.availableModels = this.aiModel ? [this.aiModel] : []
        this.fetchError = ''
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

  private async checkOpencodeStatus(customPath?: string): Promise<void> {
    const electron = api()
    const getStatus = electron?.opencode?.getStatus
    if (!getStatus) return
    this.opencodeChecking = true
    try {
      const s = await getStatus(customPath ?? this.opencodeCustomPath ?? '')
      this.opencodeCliFound = s.cliFound
      this.opencodeCliPath = s.cliPath
      this.opencodeCliVersion = s.cliVersion
      this.opencodeLoginCommand = s.loginCommand ?? this.opencodeLoginCommand
      this.opencodeAuthLoggedIn = s.auth?.loggedIn ?? null
      this.opencodeAuthDetail = s.auth?.detail ?? ''
      this.opencodeManagedUp = s.managedServerUp ?? null
      this.opencodeDebug = Array.isArray(s.debug) ? s.debug : []
    } catch {
      this.opencodeCliFound = false
      this.opencodeCliPath = null
      this.opencodeAuthLoggedIn = null
    } finally {
      this.opencodeChecking = false
    }
  }

  /** Copy the Console login command; runs in the user's own terminal (browser flow). */
  private async handleOpencodeCopyLogin(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.opencodeLoginCommand)
      this.opencodeCopied = true
      window.setTimeout(() => (this.opencodeCopied = false), 2000)
    } catch {
      // Clipboard unavailable (permissions); the command is still visible to type.
      this.opencodeCopied = false
    }
  }

  /** Open the Console (opencode.ai) where the login session starts. */
  private handleOpencodeOpenConsole(): void {
    void api()?.shell?.openExternal?.('https://opencode.ai')
  }

  /** Let the user point at opencode.cmd directly (npm global bin not on PATH). */
  private async handleOpencodeBrowse(): Promise<void> {
    const electron = api()
    const dialog = electron?.dialog?.showOpenDialog
    if (!dialog) return
    try {
      const result = await dialog({
        properties: ['openFile'],
        filters: [
          { name: 'Executables', extensions: ['cmd', 'exe', 'bat', '*'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
      if (!result.canceled && result.filePaths[0]) {
        this.opencodeCustomPath = result.filePaths[0]
        this.updateSetting('ai.opencodeCliPath', result.filePaths[0])
        await this.checkOpencodeStatus(result.filePaths[0])
      }
    } catch (e) {
      console.error('Failed to pick opencode binary:', e)
    }
  }

  private handleProviderChange(e: Event): void {
    const provider = (e.target as HTMLSelectElement).value
    this.updateSetting('ai.provider', provider)

    // Show known models immediately so the dropdown is not empty while the
    // network fetch for the live list is in flight.
    this.availableModels = [...(PROVIDER_MODEL_DEFAULTS[provider] ?? [])]
    if (this.availableModels.length > 0) {
      this.updateSetting('ai.model', this.availableModels[0])
    }
    void this.fetchModels()
  }

  private async handleCheckForUpdates(): Promise<void> {
    const updater = api()?.updater
    if (!updater) return
    this.updateStatus = 'checking'
    this.updateError = ''
    try {
      const result = await updater.check()
      if (result && 'error' in result) {
        this.updateStatus = 'error'
        this.updateError = result.error
      } else if (result && 'skipped' in result) {
        // An update exists but this one was declined earlier. Saying so beats
        // "up to date", which would be a lie.
        this.updateStatus = 'up-to-date'
        this.updateVersion = ''
        this.skippedVersion = result.skipped
      } else if (!result || !result.updateInfo) {
        this.updateStatus = 'up-to-date'
      }
    } catch (e) {
      this.updateStatus = 'error'
      this.updateError = e instanceof Error ? e.message : String(e)
    }
  }

  /** Stop offering the current version; the next release prompts again. */
  private handleSkipUpdate(): void {
    const version = this.updateVersion
    if (!version) return
    this.settingsStore.set('updates.skippedVersion', version)
    this.skippedVersion = version
    this.updateStatus = 'up-to-date'
    this.updateVersion = ''
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

  private async handleInstallUpdate(): Promise<void> {
    const updater = api()?.updater
    if (!updater) return
    // quitAndInstall throws when there is no downloaded update to apply, which
    // is the normal case on an unsigned build. Without the catch this surfaced
    // as an unhandled rejection with no UI feedback.
    try {
      await updater.install?.()
    } catch (e) {
      this.updateStatus = 'error'
      this.updateError = e instanceof Error ? e.message : String(e)
    }
  }

  private async handleShowWhatsNew(): Promise<void> {
    const { showCurrentWhatsNew } = await import('../services/whats-new')
    await showCurrentWhatsNew()
  }

  render(): unknown {
    this.classList.toggle('classic', !this.newSettingsDesign)
    return html`
      <div
        class="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        @click=${(e: MouseEvent) => e.stopPropagation()}
      >
        <!-- Sidebar Navigation -->
        <div class="sidebar">
          <div class="sidebar-search">
            <input
              type="text"
              aria-label="Search settings"
              placeholder="Search settings..."
              @keydown=${this.handleSearchKey}
              @input=${this.handleSearchInput}
            />
            ${this.searchQuery.trim() ? html`<div class="search-status">${this.matchStatus()}</div>` : ''}
          </div>
          <div class="sidebar-nav">
            <div class="nav-group" ?hidden=${!this.groupVisible(['general', 'editor', 'files'])}>
              Workspace
            </div>
            <button
              class="nav-btn ${this.tab === 'general' ? 'active' : ''}"
              ?hidden=${!this.visibleTabs.includes('general')}
              @click=${() => (this.tab = 'general')}
            >
                ${icon('sliders')} General
              </button>
              <button
                class="nav-btn ${this.tab === 'editor' ? 'active' : ''}"
                ?hidden=${!this.visibleTabs.includes('editor')}
                @click=${() => (this.tab = 'editor')}
              >
                ${icon('pencil')} Editor
              </button>
              <button
                class="nav-btn ${this.tab === 'files' ? 'active' : ''}"
                ?hidden=${!this.visibleTabs.includes('files')}
                @click=${() => (this.tab = 'files')}
              >
                ${icon('folder-open')} Files & Vault
              </button>
              <div class="nav-group" ?hidden=${!this.groupVisible(['appearance', 'shortcuts', 'advanced'])}>
              Application
            </div>
              <button
                class="nav-btn ${this.tab === 'appearance' ? 'active' : ''}"
                ?hidden=${!this.visibleTabs.includes('appearance')}
                @click=${() => (this.tab = 'appearance')}
              >
                ${icon('palette')} Appearance
              </button>
              <button
                class="nav-btn ${this.tab === 'shortcuts' ? 'active' : ''}"
                ?hidden=${!this.visibleTabs.includes('shortcuts')}
                @click=${() => (this.tab = 'shortcuts')}
              >
                ${icon('keyboard')} Shortcuts
              </button>
              <button
                class="nav-btn ${this.tab === 'advanced' ? 'active' : ''}"
                ?hidden=${!this.visibleTabs.includes('advanced')}
                @click=${() => (this.tab = 'advanced')}
              >
                ${icon('settings')} Advanced
              </button>
              <div class="nav-group" ?hidden=${!this.groupVisible(['ai', 'about'])}>Plugins</div>
              <button
                class="nav-btn ${this.tab === 'ai' ? 'active' : ''}"
                ?hidden=${!this.visibleTabs.includes('ai')}
                @click=${() => (this.tab = 'ai')}
              >
                ${icon('sparkle')} AI Assistant
              </button>
              <button
                class="nav-btn ${this.tab === 'about' ? 'active' : ''}"
                ?hidden=${!this.visibleTabs.includes('about')}
                @click=${() => (this.tab = 'about')}
              >
                ${icon('info')} About
              </button>
            </div>
            <div class="sidebar-footer">
              <button class="back-btn" @click=${this.close} aria-label="Back to editor">
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
                Back
              </button>
            </div>
          </div>

          <!-- Main Area -->
          <div class="main-area">
            <div class="main-header">
              <h2>${this.tab === 'files' ? 'Files & Vault' : TAB_LABELS[this.tab]}</h2>
              <button class="close-btn" aria-label="Close settings" @click=${this.close}>
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
              <div class="win-controls">
                <button
                  class="win-btn"
                  aria-label="Minimize"
                  title="Minimize"
                  @click=${() => void api()?.window?.minimize?.()}
                >
                  <svg viewBox="0 0 10 10" width="10" height="10" fill="none">
                    <path d="M0 5H10" stroke="currentColor" stroke-width="1" />
                  </svg>
                </button>
                <button
                  class="win-btn"
                  aria-label="Maximize"
                  title="Maximize"
                  @click=${() => void api()?.window?.maximize?.()}
                >
                  <svg viewBox="0 0 10 10" width="10" height="10" fill="none">
                    <rect
                      x="0.5"
                      y="0.5"
                      width="9"
                      height="9"
                      stroke="currentColor"
                      stroke-width="1"
                    />
                  </svg>
                </button>
                <button
                  class="win-btn close"
                  aria-label="Close window"
                  title="Close"
                  @click=${() => void api()?.window?.close?.()}
                >
                  <svg viewBox="0 0 10 10" width="10" height="10" fill="none">
                    <path
                      d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5"
                      stroke="currentColor"
                      stroke-width="1"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <div class="content-panel" data-tab=${this.tab}>
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
                role="radio"
                tabindex="0"
                aria-checked=${this.theme === t.id}"
                aria-label=${t.name + ' theme'}
                @keydown=${this.handleCardKey}
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
                role="radio"
                tabindex="0"
                aria-checked=${this.accentColor === c}
                aria-label=${c + ' accent'}
                @keydown=${this.handleCardKey}
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
            <div class="setting-label">Vertical tabs</div>
            <div class="setting-desc">Show tabs in a side rail instead of the top bar</div>
          </div>
          <button
            class="toggle-switch"
            role="switch"
            aria-checked="${this.panelOrientation === 'vertical'}"
            @click=${() => this.updateSetting('appearance.panelOrientation', this.panelOrientation === 'vertical' ? 'horizontal' : 'vertical')}
          ></button>
        </div>
      </div>

      <div class="section-title">Motion</div>
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">Animation</div>
            <div class="setting-desc">
              Match system follows the Windows animation setting. Always and never override it.
            </div>
          </div>
          <select
            class="select-input"
            aria-label="Animation"
            .value=${this.motion}
            @change=${(e: Event) =>
              this.updateSetting('appearance.motion', (e.target as HTMLSelectElement).value)}
          >
            ${MOTION_PREFERENCES.map(
              (p) =>
                html`<option value=${p} ?selected=${p === this.motion}>${MOTION_LABELS[p]}</option>`
            )}
          </select>
        </div>
      </div>

      <div class="section-title">Settings Window</div>
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">New Design <span class="beta-badge">Beta</span></div>
            <div class="setting-desc">
              Full-screen settings shell. Off restores the classic popup dialog.
            </div>
          </div>
          <button
            class="toggle-switch"
            role="switch"
            aria-checked="${this.newSettingsDesign}"
            aria-label="New settings design"
            @click=${() => this.updateSetting('appearance.newSettingsDesign', !this.newSettingsDesign)}
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
                role="radio"
                tabindex="0"
                aria-checked=${this.fontFamily === f.id}
                aria-label=${f.name}
                @keydown=${this.handleCardKey}
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
            @click=${() => this.updateSetting('editor.showLineNumbers', !this.lineNumbers)}
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
            @click=${() => this.updateSetting('editor.autoSave', !this.autoSave)}
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
            <option value="OpenCode">OpenCode (Console login)</option>
            <option value="Nvidia">Nvidia</option>
            <option value="DeepSeek">DeepSeek</option>
            <option value="xAI">xAI (Grok)</option>
            <option value="Ollama">Ollama (Local)</option>
          </select>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Web search</div>
            <div class="setting-desc">
              Ground answers with a keyless web search before sending. Works with any provider.
            </div>
          </div>
          <button
            class="toggle-switch"
            role="switch"
            aria-checked="${this.webSearchEnabled}"
            aria-label="Web search"
            @click=${() => this.updateSetting('ai.webSearchEnabled', !this.webSearchEnabled)}
          ></button>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Model</div>
            <div class="setting-desc">
              ${
                this.aiProvider === 'OpenCode'
                  ? 'provider/model from your CLI (e.g. opencode/big-pickle), or empty for its default. Fetch lists `opencode models` when available.'
                  : 'Specify the model to use (e.g. gpt-4o, claude-3.5-sonnet, gemini-1.5-pro, llama3)'
              }
            </div>
          </div>
          <div style="display: flex; gap: 8px; flex-direction: column; align-items: flex-end;">
            <div style="display: flex; gap: 8px;">
              ${
                this.aiProvider === 'OpenCode'
                  ? html`
                      <input
                        type="text"
                        class="text-input"
                        list="ai-model-suggestions"
                        placeholder="opencode/big-pickle or empty"
                        .value=${this.aiModel}
                        @change=${(e: Event) => {
                          const v = (e.target as HTMLInputElement).value.trim()
                          this.aiModel = v
                          this.updateSetting('ai.model', v)
                        }}
                      />
                      <datalist id="ai-model-suggestions">
                        ${this.availableModels.map((m) => html`<option value=${m}></option>`)}
                      </datalist>
                    `
                  : html`
                      <select
                        class="select-input"
                        .value=${this.aiModel}
                        @change=${(e: Event) => this.updateSetting('ai.model', (e.target as HTMLSelectElement).value)}
                      >
                        ${
                          this.availableModels.length > 0
                            ? this.availableModels.map(
                                (m) =>
                                  html`<option value=${m} ?selected=${this.aiModel === m}>
                                    ${m}
                                  </option>`
                              )
                            : html`<option value=${this.aiModel}>${this.aiModel}</option>`
                        }
                      </select>
                    `
              }
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
            <div class="setting-desc">
              ${
                this.aiKeyUndecryptable
                  ? html`<span style="color: var(--warning)"
                      >A key is stored but this install cannot decrypt it. Type a new one to replace
                      it.</span
                    >`
                  : this.aiKeyStored
                    ? 'A key is stored on this machine. Type a new one to replace it.'
                    : 'Your secret API key (saved locally)'
              }
            </div>
          </div>
          <input
            type="password"
            class="text-input"
            placeholder=${this.aiKeyStored ? 'stored - type to replace' : 'sk-...'}
            autocomplete="off"
            .value=${this.aiApiKey}
            @change=${this.handleApiKeyInput}
          />
        </div>
        ${
          this.aiProvider === 'OpenCode'
            ? html`<div class="setting-row">
                  <div>
                    <div class="setting-label">Connect via Console</div>
                    <div class="setting-desc">
                      ${
                        this.opencodeAuthLoggedIn
                          ? `Logged in - ${this.opencodeAuthDetail}.`
                          : this.opencodeAuthDetail
                            ? `${this.opencodeAuthDetail}.`
                            : 'Login happens in your browser: open the Console, sign in, then run the command in a terminal.'
                      }
                      1) Open console.opencode.ai and sign in. 2) Run the command, complete the
                      browser login. 3) Back here, Recheck, then /models in the CLI to pick a model.
                    </div>
                  </div>
                  <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                    <code
                      class="text-input"
                      style="padding: 8px 12px; font-size: 12px; user-select: all;"
                      >${this.opencodeLoginCommand}</code
                    >
                    <button class="control-btn" @click=${this.handleOpencodeCopyLogin}>
                      ${this.opencodeCopied ? 'Copied' : 'Copy'}
                    </button>
                    <button class="control-btn" @click=${this.handleOpencodeOpenConsole}>
                      Open console
                    </button>
                  </div>
                </div>
                <div class="setting-row">
                  <div>
                    <div class="setting-label">CLI path</div>
                    <div class="setting-desc">
                      ${
                        this.opencodeChecking
                          ? 'Checking…'
                          : this.opencodeCliFound
                            ? `Found: ${this.opencodeCliPath ?? 'opencode'}${this.opencodeCliVersion ? ` (${this.opencodeCliVersion})` : ''}. Chat runs through a managed server WriteMd starts itself - no manual serve needed, no API key needed.`
                            : 'Not found. npm installs land at %APPDATA%\\npm\\opencode.cmd - pick it below if it is not on PATH.'
                      }
                      ${this.opencodeManagedUp ? ' Managed server running.' : ''}
                    </div>
                  </div>
                  <div style="display: flex; gap: 8px; align-items: center;">
                    <button class="control-btn" @click=${this.handleOpencodeBrowse}>
                      ${this.opencodeCustomPath ? 'Change…' : 'Browse…'}
                    </button>
                    <button
                      class="control-btn"
                      @click=${() => void this.checkOpencodeStatus()}
                      ?disabled=${this.opencodeChecking}
                    >
                      ${this.opencodeChecking ? 'Checking…' : 'Recheck'}
                    </button>
                  </div>
                </div>
                ${
                  !this.opencodeCliFound && this.opencodeDebug.length > 0
                    ? html`<div class="setting-row">
                        <div>
                          <div class="setting-label">Why wasn't it found?</div>
                          <div
                            class="setting-desc"
                            style="font-family: var(--font-mono); font-size: 11px; white-space: pre-wrap;"
                          >
                            ${this.opencodeDebug.join('\n')}
                          </div>
                        </div>
                      </div>`
                    : ''
                }`
            : ''
        }
      </div>

      <div class="section-title">System Prompt</div>
      <div class="section">
        <div class="setting-desc" style="margin-bottom: 8px;">
          Instructions sent with every request. The open file's content is appended automatically.
        </div>
        <textarea
          class="text-input prompt-input"
          rows="10"
          .value=${this.aiSystemPrompt}
          @change=${(e: Event) => {
            const v = (e.target as HTMLTextAreaElement).value
            this.aiSystemPrompt = v
            this.updateSetting('ai.systemPrompt', v)
          }}
        ></textarea>
        <div style="display: flex; justify-content: flex-end; margin-top: 8px;">
          <button
            class="control-btn"
            @click=${() => {
              this.aiSystemPrompt = DEFAULT_AI_SYSTEM_PROMPT
              this.updateSetting('ai.systemPrompt', DEFAULT_AI_SYSTEM_PROMPT)
            }}
          >
            Reset to default
          </button>
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
          return this.updateVersion
            ? `Update available: v${this.updateVersion}`
            : 'Update available'
        case 'downloading':
          return `Downloading... ${this.downloadProgress}%`
        case 'downloaded':
          return this.updateVersion ? `Update v${this.updateVersion} ready` : 'Update ready'
        case 'up-to-date':
          // "Up to date" would be false if the user declined this release, so
          // say what actually happened.
          return this.skippedVersion ? `v${this.skippedVersion} skipped` : 'You are up to date'
        case 'error':
          return 'Update check failed'
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
            <div class="setting-desc">
              ${this.appVersion ? `v${this.appVersion}` : 'Version unavailable'}
            </div>
          </div>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-label">Auto-check for updates</div>
            <div class="setting-desc">Quietly check for updates in the background</div>
          </div>
          <button
            class="toggle-switch"
            role="switch"
            aria-checked="${this.autoCheckForUpdates}"
            @click=${() => this.updateSetting('updates.autoCheckForUpdates', !this.autoCheckForUpdates)}
          ></button>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-label">Release notes</div>
            <div class="setting-desc">See what changed in this version</div>
          </div>
          <button class="control-btn" @click=${this.handleShowWhatsNew}>What's new</button>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-label">Updates</div>
            <div class="setting-desc" role="status" aria-live="polite">${statusText}</div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            ${
              this.updateStatus === 'available'
                ? html`<button class="control-btn" @click=${this.handleDownloadUpdate}>
                    Download
                  </button>`
                : ''
            }
            ${
              this.updateStatus === 'downloaded'
                ? html`<button
                    class="control-btn"
                    style="background: var(--accent); color: var(--accent-text); border-color: var(--accent);"
                    @click=${this.handleInstallUpdate}
                  >
                    Restart to update
                  </button>`
                : ''
            }
            ${
              this.updateStatus === 'checking' || this.updateStatus === 'downloading'
                ? html`<button class="control-btn" disabled>
                    ${this.updateStatus === 'checking' ? 'Checking...' : `${this.downloadProgress}%`}
                  </button>`
                : html`<button class="control-btn" @click=${this.handleCheckForUpdates}>
                    Check for updates
                  </button>`
            }
          </div>
        </div>
        ${
          this.updateStatus === 'error'
            ? html`<div class="setting-desc" style="color: var(--danger); padding: 8px 0 8px 0;">
                ${this.updateError}
              </div>`
            : ''
        }
        ${this.renderIncomingNotes()}
      </div>
    `
  }

  /**
   * What the pending update contains. The notes ship in the bundle, so this
   * works offline and needs no GitHub round trip; a release with no notes file
   * simply renders nothing.
   */
  private renderIncomingNotes(): unknown {
    if (this.updateStatus !== 'available' || !this.updateVersion) return ''
    const notes = summarizeNotesForVersion(this.updateVersion)
    if (notes.length === 0) return ''
    return html`
      <div class="setting-desc" style="padding: 0 0 8px 0;">
        <div style="color: var(--text-secondary); margin-bottom: 4px;">
          What's new in v${this.updateVersion}
        </div>
        <ul style="margin: 0; padding-left: 18px;">
          ${notes.map((note) => html`<li style="margin-bottom: 3px;">${note}</li>`)}
        </ul>
        <button class="control-btn" style="margin-top: 8px;" @click=${this.handleSkipUpdate}>
          Skip this version
        </button>
      </div>
    `
  }
}
