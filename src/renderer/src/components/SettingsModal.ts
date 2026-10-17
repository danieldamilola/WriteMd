import { OpenCodeState } from '../state/opencode'
import './ai/ModelOptions'
import { providerIcon } from './ai/provider-icons'
import { EMPTY_OPENCODE_AUTH, type OpenCodeAuthView } from '../../../shared/ai/opencode'
import { html, css, LitElement, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import './BackgroundControls'
import './Background'
import './IconButton'
import './SearchBar'
import { controlStyles, settingsSelectStyles } from '../design/controls'
import type WaSelect from '@awesome.me/webawesome/dist/components/select/select.js'
import '@awesome.me/webawesome/dist/components/select/select.js'
import { chromeIcon } from '../design/icons'
import './Modal'
import { nativeModalAvailable } from './Modal'
import { api } from '../api'
import type { ProviderPresetView } from '../../../shared/electron-api'
import type { AiSkillsView } from '../../../shared/ai/skills'
import { deepActiveElement } from '../utils/links'
import { MOTION_LABELS, MOTION_PREFERENCES, type MotionPreference } from '../utils/motion'
import { SettingsStore } from '../state/settings'
import { FileState } from '../state/file-state'
import { ChatgptState } from '../state/chatgpt'
import { EMPTY_CHATGPT_AUTH, type ChatgptAuthView } from '../../../shared/ai/chatgpt'
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
  SETTINGS_NAV_GROUPS,
  exactSettingsTab,
  resolveSettingsTab,
  searchSettingsRows,
  searchSettingsTabs,
  searchTargetTab,
  searchTokens,
  type SettingsTab
} from '../state/settings-search'

const SKILLS_RESTART_MESSAGE = 'Restart WriteMd to finish enabling skills, then try again.'

function skillsErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error)
  return /No handler registered for ['"]?ai:(?:open-skills-folder|list-skills)/i.test(message)
    ? SKILLS_RESTART_MESSAGE
    : fallback
}

/**
 * The element that actually holds focus, descending through open shadow roots.
 *
 * `document.activeElement` only ever reports the outermost host, so capturing it
 * and calling focus() on it later restores nothing: the host is not focusable
 * and focus falls back to body. The settings button that opens this modal lives
 * inside `writemd-top-bar`'s shadow root, so the real target is two levels down.
 */

const FONT_FAMILIES = [
  { id: 'Inter', name: 'Inter', type: 'Sans-serif' },
  { id: 'Manrope', name: 'Manrope', type: 'Sans-serif' },
  { id: 'DM Sans', name: 'DM Sans', type: 'Sans-serif' },
  { id: 'Space Grotesk', name: 'Space Grotesk', type: 'Sans-serif' },
  { id: 'JetBrains Mono', name: 'JetBrains Mono', type: 'Monospace' },
  { id: 'Geist Mono', name: 'Geist Mono', type: 'Monospace' }
]

const NAV_ICONS: Record<SettingsTab, string> = {
  export: 'download',
  skills: 'file-text',
  editor: 'pencil',
  files: 'folder-open',
  appearance: 'palette',
  ai: 'ai',
  shortcuts: 'keyboard',
  system: 'settings',
  about: 'info'
}

interface ThemeDefinition {
  id: string
  name: string
  c1: string
  c2: string
}

const THEME_PREVIEWS: ThemeDefinition[] = [
  { id: 'dark', name: 'Dark', c1: 'var(--preview-dark-base)', c2: 'var(--preview-dark-raised)' },
  {
    id: 'graphite',
    name: 'Graphite',
    c1: 'var(--preview-graphite-base)',
    c2: 'var(--preview-graphite-raised)'
  },
  { id: 'nord', name: 'Nord', c1: 'var(--preview-nord-base)', c2: 'var(--preview-nord-raised)' },
  {
    id: 'midnight',
    name: 'Midnight',
    c1: 'var(--preview-midnight-base)',
    c2: 'var(--preview-midnight-raised)'
  },
  {
    id: 'light',
    name: 'Light',
    c1: 'var(--preview-light-base)',
    c2: 'var(--preview-light-raised)'
  },
  {
    id: 'paper',
    name: 'Paper',
    c1: 'var(--preview-paper-base)',
    c2: 'var(--preview-paper-raised)'
  },
  {
    id: 'dracula',
    name: 'Dracula',
    c1: 'var(--preview-dracula-base)',
    c2: 'var(--preview-dracula-raised)'
  }
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

@customElement('writemd-settings-modal')
export class SettingsModal extends LitElement {
  static styles = [
    controlStyles,
    settingsSelectStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 300;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--dialog-backdrop);
      }
      * {
        box-sizing: border-box;
      }

      .modal-dialog {
        width: min(980px, calc(100vw - 32px));
        height: min(600px, calc(100vh - 92px));
        display: flex;
        background: var(--bg-elevated);
        border: none;
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-3);
        box-sizing: border-box;
        font-family: var(--font-ui);
        overflow: hidden;
        color: var(--text);
      }

      /* Sidebar Navigation */
      .sidebar {
        width: 200px;
        flex-shrink: 0;
        background: var(--bg-elevated);
        border: 0;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .sidebar-search {
        padding: 12px 8px 0;
        flex-shrink: 0;
      }

      .search-status {
        font-size: 11px;
        color: var(--text-muted);
        padding: 6px 2px 0 2px;
      }

      .sidebar-nav {
        padding: 20px 8px;
        display: flex;
        flex-direction: column;
        gap: 24px;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
      }

      .nav-section {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .nav-group {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted);
        padding: 0 8px 4px;
      }

      .nav-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 34px;
        padding: 8px;
        border-radius: var(--radius-sm);
        font-size: 14px;
        font-weight: 500;
        color: var(--text-secondary);
        background: transparent;
        border: none;
        cursor: pointer;
        text-align: left;
        transition:
          background var(--motion-fast),
          color var(--motion-fast);
      }

      .nav-btn svg {
        width: var(--icon-size, 18px);
        height: var(--icon-size, 18px);
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
      .nav-btn:focus-visible,
      .back-btn:focus-visible,
      .close-btn:focus-visible {
        outline: 1px solid var(--border-focus);
        outline-offset: -1px;
      }

      /* The hidden attribute loses to the class display rule without this. */
      .nav-btn[hidden] {
        display: none;
      }

      .modal-dialog .close-btn {
        display: flex;
        width: 32px;
        height: 32px;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        color: var(--text-secondary);
        border-radius: 6px;
        cursor: pointer;
        -webkit-app-region: no-drag;
      }
      .modal-dialog .close-btn:hover {
        background: var(--bg-hover);
        color: var(--text);
      }
      /* Main Area */
      .main-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
      }

      .main-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 56px;
        padding: 0 20px 0 24px;
        flex-shrink: 0;
      }

      .main-header h2 {
        font-size: 15px;
        font-weight: 600;
        margin: 0;
        color: var(--text);
      }

      /* Return to the document without adding another window title bar. */
      .sidebar-footer {
        padding: 8px;
        border: 0;
        flex-shrink: 0;
      }
      .back-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        min-height: 34px;
        padding: 8px;
        border-radius: var(--radius-sm);
        font-size: 14px;
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
        padding: clamp(16px, 3vw, 32px);
        overflow-y: auto;
        min-height: 0;
        scrollbar-gutter: stable;
        container-type: inline-size;
        container-name: settings;
      }

      /* Card sections */
      .section {
        background: var(--bg-card);
        border: none;
        border-radius: var(--radius-md);
        padding: 16px;
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
        flex-wrap: wrap;
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
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
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
        gap: 12px;
        min-width: 0;
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
        min-width: 0;
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
        border-bottom: none;
        flex-wrap: wrap;
      }
      .setting-row:last-child {
        padding-bottom: 0;
      }
      .setting-row:first-child {
        padding-top: 0;
      }
      .setting-row > :first-child {
        flex: 1 1 220px;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .setting-row > :last-child {
        max-width: 100%;
      }
      .control-stack {
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 0 1 280px;
        min-width: 0;
      }
      .control-group {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .control-group wa-select,
      .control-group .text-input {
        flex: 1 1 160px;
        min-width: 0;
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
        min-height: 34px;
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

      .ai-settings .section {
        margin-bottom: 20px;
      }
      .ai-settings .setting-row {
        flex-wrap: nowrap;
        gap: 20px;
        padding: 12px 0;
      }
      .ai-settings .setting-row:first-child {
        padding-top: 0;
      }
      .ai-settings .setting-row:last-child {
        padding-bottom: 0;
      }
      .ai-settings .setting-row > :first-child {
        flex: 1 1 0;
      }
      .ai-settings .setting-row > .control-group,
      .ai-settings .setting-row > .control-stack,
      .ai-settings .setting-row > wa-select,
      .ai-settings .setting-row > input[type='url'] {
        flex: 0 1 300px;
        width: 300px;
        min-width: 0;
      }
      .ai-settings .control-stack > wa-select,
      .ai-settings .control-stack > .control-btn {
        width: 100%;
        flex: 0 0 auto;
      }
      .ai-settings .control-group .control-btn {
        white-space: nowrap;
      }
      .ai-settings .setting-row > .toggle-switch {
        flex: 0 0 36px;
      }
      .ai-skills-actions {
        justify-content: flex-end;
      }
      .ai-skills-path {
        overflow-wrap: anywhere;
        font-size: 12px;
        margin-top: 12px;
      }
      .ai-skill-list {
        list-style: none;
        margin: 12px 0 0;
        padding: 0;
      }
      .ai-skill-list li {
        padding: 8px 0;
        overflow-wrap: anywhere;
      }
      .ai-skill-list .setting-desc {
        margin-top: 2px;
      }
      .ai-message {
        overflow-wrap: anywhere;
        color: var(--danger);
      }
      .ai-skill-warning {
        overflow-wrap: anywhere;
        color: var(--warning);
      }
      .chatgpt-welcome {
        width: 360px;
        max-width: calc(100vw - 32px);
        padding: 24px;
        background: var(--bg-elevated);
        color: var(--text);
      }
      .chatgpt-welcome p {
        color: var(--text-secondary);
        line-height: 1.5;
      }
      .text-input {
        width: 220px;
        min-height: 34px;
        max-width: 100%;
        min-width: 0;
        background: var(--bg-hover);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 6px 10px;
        color: var(--text);
        font-size: 13px;
        outline: none;
        flex: 0 1 220px;
      }
      .text-input:focus {
        border-color: var(--border-focus);
      }
      .text-input[type='number'] {
        flex: 0 0 88px;
        width: 88px;
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
        flex-shrink: 0;
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

      /* Settings fills the window, so it takes the app's surface tokens: rail like
         the app's rail, content like a document pane, and a clear host so what
         shows through is the workspace rather than a second solid layer. Cards
         below keep --bg-card and read as objects on top, as in Windows Settings. */
      :host(.embedded) {
        position: absolute;
        inset: 0;
        z-index: 6;
        background: transparent;
      }
      :host(.embedded) .modal-dialog {
        width: 100%;
        height: 100%;
        border-radius: 0;
        box-shadow: none;
        background: transparent;
      }
      :host(.embedded) .sidebar {
        width: var(--shell-sidebar-width);
        background: var(--frame-surface);
        backdrop-filter: blur(var(--surface-blur, 0px));
      }
      :host(.embedded) .main-area {
        position: relative;
        isolation: isolate;
        background: var(--editor-surface);
        backdrop-filter: blur(var(--surface-blur, 0px));
        margin-top: var(--shell-header-height);
      }
      :host(.embedded) .content-panel {
        position: relative;
        z-index: 1;
      }
      :host(.embedded) .main-header {
        display: none;
      }
      :host(.embedded) .content-panel {
        padding-bottom: 48px;
      }
      .content-inner {
        width: 100%;
        max-width: 768px;
        margin-inline: auto;
      }
      .section-title {
        font-size: 13px;
        margin-bottom: 10px;
      }
      .setting-label {
        font-size: 13px;
      }
      .setting-desc {
        font-size: 13px;
        color: var(--text-secondary);
      }
      @container settings (width < 560px) {
        .setting-row {
          flex-wrap: wrap;
          gap: 12px;
        }
        .text-input {
          max-width: 100%;
        }
        .ai-settings .setting-row {
          flex-wrap: wrap;
          gap: 10px;
        }
        .ai-settings .setting-row > :first-child {
          flex-basis: 100%;
        }
        .ai-settings .setting-row:has(> .toggle-switch) {
          flex-wrap: nowrap;
        }
        .ai-settings .setting-row:has(> .toggle-switch) > :first-child {
          flex-basis: 0;
        }
        .ai-settings .setting-row > .control-group,
        .ai-settings .setting-row > .control-stack,
        .ai-settings .setting-row > wa-select,
        .ai-settings .setting-row > input[type='url'] {
          flex-basis: 100%;
          width: 100%;
        }
        .ai-skills-actions {
          justify-content: flex-start;
        }
      }
      @container settings (width < 440px) {
        .theme-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    `
  ]

  @state() private tab: SettingsTab = 'editor'
  @state() private searchQuery = ''

  /** Jump to a tab from outside, e.g. a deep link from another component. */
  @property({ type: Boolean }) embedded = false
  @property({ type: String }) initialTab: SettingsTab | 'general' | 'advanced' = 'editor'

  /**
   * `willUpdate`, not `connectedCallback`: Lit commits `.prop` bindings when it
   * renders the element, which is after `connectedCallback` has already run, so
   * reading `initialTab` there always saw the default.
   */
  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('initialTab')) this.tab = resolveSettingsTab(this.initialTab)
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
  @state() private showFilePath = true
  @state() private enableMermaid = true
  @state() private hardwareAcceleration = true
  @state() private startupHardwareAcceleration: boolean | null = null
  @state() private restarting = false
  @state() private restartError = ''
  @state() private defaultNewFileName = 'Untitled.md'
  @state() private pdfPageSize = 'A4'
  @state() private pdfTheme = 'light'
  @state() private pdfMargin = 24
  @state() private appVersion = ''
  @state() private autoCheckForUpdates = true
  @state() private panelOrientation: 'horizontal' | 'vertical' = 'vertical'
  @state() private motion: MotionPreference = 'system'
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

  // AI assistant
  @state() private aiEnabled = false
  @state() private aiAutoAcceptEdits = false
  @state() private aiProviderId = 'openai'
  @state() private aiBaseUrl = ''
  @state() private aiModel = ''
  @state() private aiKeySet = false
  @state() private aiKeyUnreadable = false
  @state() private aiKeyInput = ''
  @state() private aiHistoryTurns = 8
  @state() private aiMaxOutputTokens = 0
  @state() private aiModels: string[] = []
  @state() private aiPresets: ProviderPresetView[] = []
  @state() private aiFetchingModels = false
  @state() private aiFetchError = ''
  @state() private aiChatgptState: ChatgptAuthView = { ...EMPTY_CHATGPT_AUTH }
  private chatgptState = ChatgptState.getInstance()
  @state() private aiOpenCodeState: OpenCodeAuthView = { ...EMPTY_OPENCODE_AUTH }
  private openCodeState = OpenCodeState.getInstance()
  @state() private aiSkills: AiSkillsView | null = null
  @state() private aiSkillsError = ''
  private aiModelRequest = 0
  private aiSkillsRequest = 0

  private updaterUnsubs: Array<() => void> = []

  private settingsStore = SettingsStore.getInstance()
  private settingsSubscriptions: (() => void)[] = []

  connectedCallback(): void {
    super.connectedCallback()
    this.loadCurrentSettings()
    void api()
      ?.app?.getHardwareAccelerationSetting?.()
      .then((enabled) => (this.startupHardwareAcceleration = enabled))
      .catch(() => undefined)
    void this.loadAiPresets()
    void this.loadAiSkills()
    this.settingsSubscriptions = [
      this.openCodeState.subscribe(() => {
        const before = this.aiOpenCodeState
        this.aiOpenCodeState = this.openCodeState.state()
        if (
          this.aiProviderId === 'opencode' &&
          (before.connectionId !== this.aiOpenCodeState.connectionId ||
            before.connected !== this.aiOpenCodeState.connected)
        ) {
          this.invalidateAiModels()
          if (this.aiOpenCodeState.connected) void this.fetchAiModels()
        }
      }),
      this.chatgptState.subscribe(() => {
        const before = this.aiChatgptState
        this.aiChatgptState = this.chatgptState.state()
        if (
          this.aiProviderId === 'chatgpt' &&
          (before.activeId !== this.aiChatgptState.activeId ||
            before.connected !== this.aiChatgptState.connected)
        ) {
          this.invalidateAiModels()
          if (this.aiChatgptState.connected) void this.fetchAiModels()
        }
      }),
      this.settingsStore.subscribeSaveStatus(() => this.requestUpdate()),
      this.settingsStore.subscribe('advanced', () => this.loadCurrentSettings()),
      this.settingsStore.subscribe('ai', () => {
        const changed =
          this.aiProviderId !== this.settingsStore.get('ai.providerId', 'openai') ||
          this.aiBaseUrl !== this.settingsStore.get('ai.baseUrl', '') ||
          this.aiKeySet !== this.settingsStore.get('ai.apiKeySet', false)
        this.loadCurrentSettings()
        if (changed) this.invalidateAiModels()
      }),
      this.settingsStore.subscribe('appearance', () => {
        this.loadCurrentSettings()
        this.requestUpdate()
      })
    ]
    this.previouslyFocused = deepActiveElement() as HTMLElement | null
    window.addEventListener('keydown', this.handleKeyDown, true)
    void api()
      ?.app?.getVersion?.()
      .then((v) => (this.appVersion = v))
      .catch(() => undefined)

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
    this.aiModelRequest++
    this.aiSkillsRequest++
    this.settingsSubscriptions.forEach((unsubscribe) => unsubscribe())
    this.settingsSubscriptions = []
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
    this.showFilePath = s.get('editor.showFilePath', true)
    this.vaultPath = s.get('files.vaultPath', '')
    this.enableMermaid = s.get('advanced.enableMermaid', true)
    this.hardwareAcceleration = s.get('advanced.hardwareAcceleration', true)
    this.defaultNewFileName = s.get('files.defaultNewFileName', 'Untitled.md')
    this.pdfPageSize = s.get('export.pdfPageSize', 'A4')
    this.pdfTheme = s.get('export.pdfTheme', 'light')
    this.pdfMargin = s.get('export.pdfMargin', 24)
    this.panelOrientation = s.get('appearance.panelOrientation', 'vertical') as
      'horizontal' | 'vertical'
    this.motion = s.get('appearance.motion', 'system') as MotionPreference
    this.autoCheckForUpdates = s.get('updates.autoCheckForUpdates', true)
    this.aiEnabled = s.get('ai.enabled', false)
    this.aiAutoAcceptEdits = s.get('ai.autoAcceptEdits', false)
    this.aiProviderId = s.get('ai.providerId', 'openai')
    this.aiBaseUrl = s.get('ai.baseUrl', '')
    this.aiModel = s.get('ai.model', '')
    this.aiKeySet = s.get('ai.apiKeySet', false)
    this.aiHistoryTurns = s.get('ai.historyTurns', 8)
    this.aiMaxOutputTokens = s.get('ai.maxOutputTokens', 0)
    this.aiModels = s.get('ai.cachedModels', [])
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
      if (
        e
          .composedPath()
          .some((node) => node instanceof HTMLElement && node.localName === 'writemd-popover')
      )
        return
      const select = e
        .composedPath()
        .find(
          (node) =>
            node instanceof HTMLElement && node.localName === 'wa-select' && (node as WaSelect).open
        ) as WaSelect | undefined
      if (select) {
        e.stopImmediatePropagation()
        void select.hide()
        return
      }
      if (!this.embedded && nativeModalAvailable()) return
      if (e.composedPath().some((node) => node instanceof HTMLDialogElement && node.open)) return
      // Capture phase via the window listener above is shared with
      // ConflictDialog; stopImmediatePropagation keeps one Escape from
      // resolving both.
      e.stopImmediatePropagation()
      this.close()
      return
    }
    if (e.key === 'Tab') if (!nativeModalAvailable()) this.trapFocus(e)
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
  private handleSearchQuery = (e: CustomEvent<{ query: string }>): void => {
    this.applySearchQuery(e.detail.query)
  }

  private applySearchQuery(query: string): void {
    this.searchQuery = query
    this.hitIndex = 0
    const target = searchTargetTab(this.searchQuery)
    if (target && target !== this.tab) this.tab = target
  }

  /** Enter / ArrowDown step through the matches in the open panel. */
  private navigateSearch(key: string): void {
    if (key !== 'Enter' && key !== 'ArrowDown' && key !== 'ArrowUp') return
    if (this.searchTokens().length === 0) return
    if (this.hitRows.length === 0) {
      const target = searchTargetTab(this.searchQuery)
      if (target) this.tab = target
      return
    }
    const step = key === 'ArrowUp' ? -1 : 1
    const next = (this.hitIndex + step + this.hitRows.length) % this.hitRows.length
    this.hitIndex = next
    this.paintHits()
  }

  /** Tabs worth showing for the current query: section words or row matches. */
  private matchingTabs(): SettingsTab[] {
    if (this.searchTokens().length === 0) return searchSettingsTabs('')
    const category = exactSettingsTab(this.searchQuery)
    if (category) return [category]
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
    if (exactSettingsTab(this.searchQuery)) return '1 matching section'
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
    if (changed.has('tab'))
      this.dispatchEvent(
        new CustomEvent('settings-section-change', {
          detail: { tab: this.tab },
          bubbles: true,
          composed: true
        })
      )
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
    const search = this.renderRoot.querySelector('writemd-search-bar')
    if (search) {
      void search.updateComplete.then(() => {
        if (this.isConnected) search.shadowRoot?.querySelector<HTMLInputElement>('input')?.focus()
      })
    }
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
    this.classList.toggle('embedded', this.embedded)
    const content = html`
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
            <writemd-search-bar
              filter
              placeholder="Search settings"
              aria-label="Search settings"
              .value=${this.searchQuery}
              @search-query=${this.handleSearchQuery}
              @search-navigate=${(e: CustomEvent<{ key: string }>) =>
                this.navigateSearch(e.detail.key)}
            ></writemd-search-bar>
            ${
              this.searchQuery.trim()
                ? html`<div class="search-status" role="status">${this.matchStatus()}</div>`
                : ''
            }
            ${
              this.settingsStore.saveStatus === 'error'
                ? html`<div class="search-status" role="alert">
                    Settings could not be saved. ${this.settingsStore.saveError}
                    <button @click=${() => this.settingsStore.retrySave()}>Retry</button>
                  </div>`
                : ''
            }
          </div>
          <div class="sidebar-nav" role="navigation" aria-label="Settings categories">
            ${SETTINGS_NAV_GROUPS.map(
              (group) => html`
                <div class="nav-section" ?hidden=${!this.groupVisible(group.tabs)}>
                  <div class="nav-group">${group.label}</div>
                  ${group.tabs.map(
                    (tab) => html`
                      <button
                        class="nav-btn ${this.tab === tab ? 'active' : ''}"
                        ?hidden=${!this.visibleTabs.includes(tab)}
                        aria-current=${this.tab === tab ? 'page' : 'false'}
                        @click=${() => (this.tab = tab)}
                      >
                        ${chromeIcon(NAV_ICONS[tab])} ${TAB_LABELS[tab]}
                      </button>
                    `
                  )}
                </div>
              `
            )}
          </div>
          <div class="sidebar-footer">
            <button class="back-btn" @click=${this.close} aria-label="Back to editor">
              ${chromeIcon('arrow-left')} Back to editor
            </button>
          </div>
        </div>

        <!-- Main Area -->
        <div class="main-area">
          ${this.embedded ? html`<writemd-background target="workspace"></writemd-background>` : null}
          <div class="main-header">
            <h2>${TAB_LABELS[this.tab]}</h2>
            <writemd-icon-button class="close-btn" title="Close settings" @click=${this.close}
              >${icon('x')}</writemd-icon-button
            >
          </div>

          <div class="content-panel" data-tab=${this.tab}>
            <div class="content-inner">
              ${this.tab === 'export' ? this.renderExport() : ''}
              ${this.tab === 'appearance' ? this.renderAppearance() : ''}
              ${this.tab === 'editor' ? this.renderEditor() : ''}
              ${this.tab === 'files' ? this.renderFiles() : ''}
              ${this.tab === 'ai' ? this.renderAi() : ''}
              ${this.tab === 'shortcuts' ? this.renderShortcuts() : ''}
              ${this.tab === 'system' ? this.renderSystem() : ''}
              ${this.tab === 'skills' ? this.renderSkills() : ''}
              ${this.tab === 'about' ? this.renderAbout() : ''}
            </div>
          </div>
        </div>
      </div>
    `
    return this.embedded
      ? content
      : html`<writemd-modal label="Settings" @modal-dismiss=${this.close}
          >${content}</writemd-modal
        >`
  }

  private renderNewNoteDefaults(): unknown {
    return html`
      <div class="setting-row">
        <div>
          <div class="setting-label">Default file name</div>
          <div class="setting-desc">Name used for new vault files</div>
        </div>
        <input
          type="text"
          class="text-input"
          aria-label="Default file name"
          .value=${this.defaultNewFileName}
          @change=${(e: Event) =>
            this.updateSetting('files.defaultNewFileName', (e.target as HTMLInputElement).value)}
        />
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
                aria-checked=${this.theme === t.id}
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

      <div class="section-title">Accent color</div>
      <div class="section">
        <div class="color-row">
          ${ACCENT_COLORS.map(
            (c, i) => html`
              <div
                class="color-circle-wrapper ${this.accentColor === c ? 'active' : ''}"
                role="radio"
                tabindex="0"
                aria-checked=${this.accentColor === c}
                aria-label=${i === 0 ? 'Monochrome accent' : c + ' accent'}
                @keydown=${this.handleCardKey}
                @click=${() => this.updateSetting('appearance.accentColor', c)}
              >
                <div class="color-circle" style="background: var(--accent-choice-${i})">
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

      <writemd-background-controls></writemd-background-controls>
      <div class="section-title">Layout</div>
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">Panel orientation</div>
            <div class="setting-desc">
              Vertical uses the document sidebar. Horizontal puts documents in the title bar.
            </div>
          </div>
          <wa-select
            size="small"
            label="Panel orientation"
            aria-label="Panel orientation"
            .value=${this.panelOrientation}
            @change=${(event: Event) => this.updateSetting('appearance.panelOrientation', String((event.currentTarget as WaSelect).value ?? ''))}
          >
            <wa-option value="vertical"> Vertical </wa-option>
            <wa-option value="horizontal"> Horizontal </wa-option>
          </wa-select>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-label">Motion</div>
            <div class="setting-desc">Follow system preferences or choose animation behavior.</div>
          </div>
          <wa-select
            size="small"
            label="Motion"
            aria-label="Motion"
            .value=${this.motion}
            @change=${(event: Event) => this.updateSetting('appearance.motion', String((event.currentTarget as WaSelect).value ?? ''))}
          >
            ${MOTION_PREFERENCES.map((preference) => html`<wa-option value=${preference}>${MOTION_LABELS[preference]}</wa-option>`)}
          </wa-select>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-label">File Path</div>
            <div class="setting-desc">Show the document path on the left of the footer</div>
          </div>
          <button
            class="toggle-switch"
            role="switch"
            aria-checked="${this.showFilePath}"
            aria-label="File path"
            @click=${() => this.updateSetting('editor.showFilePath', !this.showFilePath)}
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
      </div>

      <div class="section-title">Editing</div>
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">Word Wrap</div>
            <div class="setting-desc">Wrap lines that exceed the editor width</div>
          </div>
          <button
            class="toggle-switch"
            role="switch"
            aria-checked="${this.wordWrap}"
            aria-label="Word wrap"
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
            aria-label="Line numbers"
            @click=${() => this.updateSetting('editor.showLineNumbers', !this.lineNumbers)}
          ></button>
        </div>
      </div>

      <div class="section-title">Markdown preview</div>
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
            aria-label="Enable Mermaid"
            @click=${() => this.updateSetting('advanced.enableMermaid', !this.enableMermaid)}
          ></button>
        </div>
      </div>
    `
  }

  private renderFiles(): unknown {
    return html`
      <div class="section-title">Vault</div>
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">Vault Location</div>
            <div class="setting-desc">${this.vaultPath || 'Default Documents/WriteMd folder'}</div>
          </div>
          <button class="control-btn" @click=${this.handleVaultSelect}>Change</button>
        </div>
      </div>

      <div class="section-title">Notes</div>
      <div class="section">
        ${this.renderNewNoteDefaults()}
        <div class="setting-row">
          <div>
            <div class="setting-label">Auto-save</div>
            <div class="setting-desc">Automatically write modifications to disk</div>
          </div>
          <button
            class="toggle-switch"
            role="switch"
            aria-checked="${this.autoSave}"
            aria-label="Auto-save"
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
      <div class="section-title">Keyboard shortcuts</div>
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

  /**
   * Which provider is selected, and what its defaults are.
   *
   * The list arrives from main because presets carry an endpoint and a default
   * model, and hardcoding those in the renderer would let the two drift.
   */
  private activeAiPreset(): ProviderPresetView | undefined {
    return this.aiPresets.find((p) => p.id === this.aiProviderId)
  }

  private async loadAiPresets(): Promise<void> {
    const presets = await api()
      ?.ai?.presets?.()
      .catch(() => [])
    this.aiPresets = presets ?? []
    const state = await api()
      ?.ai?.keyState?.()
      .catch(() => 'empty' as const)
    this.aiKeySet = state === 'stored'
    this.aiKeyUnreadable = state === 'unavailable'
  }

  private selectAiProvider(id: string): void {
    const preset = this.aiPresets.find((p) => p.id === id)
    this.updateSetting('ai.providerId', id)
    if (preset) {
      this.updateSetting('ai.baseUrl', preset.defaultBaseUrl)
      this.updateSetting('ai.model', preset.defaultModel)
    }
    this.aiFetchError = ''
    this.aiModels = []
    this.updateSetting('ai.cachedModels', [])
  }

  private async saveAiKey(): Promise<void> {
    const key = this.aiKeyInput.trim()
    if (!key) return
    const result = await api()?.ai?.setKey?.(key)
    this.aiKeyInput = ''
    this.aiKeySet = result?.state === 'stored'
    this.aiKeyUnreadable = result?.state === 'unavailable'
    if (result && !result.stored) this.aiFetchError = result.reason ?? 'Could not save the key.'
    else if (result) {
      this.invalidateAiModels()
      this.updateSetting('ai.apiKeySet', true)
    }
  }

  private async clearAiKey(): Promise<void> {
    const result = await api()?.ai?.clearKey?.()
    this.aiKeySet = result?.state === 'stored'
    this.aiKeyUnreadable = false
    if (result) {
      this.invalidateAiModels()
      this.updateSetting('ai.apiKeySet', false)
    }
  }

  private invalidateAiModels(): void {
    this.aiModelRequest++
    this.aiFetchingModels = false
    this.aiFetchError = ''
    this.aiModels = []
    if (this.settingsStore.get<string[]>('ai.cachedModels', []).length) {
      this.settingsStore.set('ai.cachedModels', [])
    }
  }

  /**
   * Ask the provider what models this key can reach.
   *
   * The key argument is only a fallback for a first-time setup: once one is
   * stored, the typed field is blank by design and main uses the stored one. The
   * list is cached in settings so the picker is populated on reopening Settings
   * without another round trip.
   */
  private async fetchAiModels(): Promise<void> {
    const request = ++this.aiModelRequest
    const key = this.aiKeyInput.trim()
    this.aiFetchError = ''
    this.aiFetchingModels = true
    try {
      const models =
        this.aiProviderId === 'chatgpt'
          ? (await this.chatgptState.models()).map((model) => model.id)
          : this.aiProviderId === 'opencode'
            ? (await this.openCodeState.models()).map((model) => model.id)
            : await api()?.ai?.fetchModels?.(this.aiProviderId, this.aiBaseUrl, key)
      if (request !== this.aiModelRequest || key !== this.aiKeyInput.trim()) return
      if (!models || models.length === 0) {
        this.aiFetchError = 'No models returned for this endpoint.'
        return
      }
      this.aiModels = models
      this.updateSetting('ai.cachedModels', models)
      // Keep the current model if it is still offered; otherwise fall to the
      // first, so the picker is never left pointing at something unavailable.
      if (!models.includes(this.aiModel)) {
        const first = models[0]
        this.updateSetting('ai.model', first)
      }
    } catch (e) {
      if (request === this.aiModelRequest)
        this.aiFetchError = e instanceof Error ? e.message : String(e)
    } finally {
      if (request === this.aiModelRequest) this.aiFetchingModels = false
    }
  }

  private async loadAiSkills(): Promise<void> {
    const request = ++this.aiSkillsRequest
    const list = api()?.ai?.listSkills
    if (!list) {
      if (this.isConnected) this.aiSkillsError = SKILLS_RESTART_MESSAGE
      return
    }
    try {
      const view = await list()
      if (!this.isConnected || request !== this.aiSkillsRequest) return
      this.aiSkills = view ?? null
      this.aiSkillsError = ''
    } catch (error) {
      if (this.isConnected && request === this.aiSkillsRequest)
        this.aiSkillsError = skillsErrorMessage(
          error,
          'Could not read skills. Try Refresh skills again.'
        )
    }
  }

  private async openAiSkillsFolder(): Promise<void> {
    const open = api()?.ai?.openSkillsFolder
    if (!open) {
      if (this.isConnected) this.aiSkillsError = SKILLS_RESTART_MESSAGE
      return
    }
    try {
      const folder = await open()
      if (!folder) throw new Error('The skills folder is available in the desktop app.')
      await this.loadAiSkills()
    } catch (error) {
      if (this.isConnected)
        this.aiSkillsError = skillsErrorMessage(
          error,
          'Could not open the Skills folder. Open Skills in your vault, or try again.'
        )
    }
  }

  private async chatgptAction(action: () => Promise<ChatgptAuthView> | undefined): Promise<void> {
    this.aiFetchError = ''
    try {
      const state = await action()
      if (!state) throw new Error('ChatGPT sign-in is unavailable. Restart WriteMd after updating.')
      this.chatgptState.apply(state)
    } catch (error) {
      this.aiFetchError = error instanceof Error ? error.message : 'ChatGPT sign-in failed.'
    }
  }

  private renderChatgptCredentials(): unknown {
    const state = this.aiChatgptState
    const bridge = api()?.ai?.chatgpt
    return html`
      <div class="setting-row">
        <div>
          <div class="setting-label">ChatGPT account</div>
          <div class="setting-desc">
            ${state.connected ? 'Using your ChatGPT plan.' : 'Sign in to use your ChatGPT plan.'} No
            API key needed.
          </div>
        </div>
        <div class="control-stack">
          ${
            state.accounts.length
              ? html` <wa-select
                  class="select-input"
                  size="small"
                  aria-label="ChatGPT account"
                  .value=${state.activeId ?? ''}
                  @change=${(event: Event) => void this.chatgptAction(() => bridge?.select(String((event.currentTarget as WaSelect).value)))}
                >
                  ${state.accounts.map((account) => html`<wa-option value=${account.id}>${account.label}</wa-option>`)}
                </wa-select>`
              : null
          }
          ${
            state.pending
              ? html`<button
                  class="control-btn"
                  @click=${() => void this.chatgptAction(() => bridge?.cancel())}
                >
                  Cancel sign-in
                </button>`
              : !state.connected
                ? html`<button
                    class="control-btn"
                    @click=${() => void this.chatgptAction(() => bridge?.login())}
                  >
                    Continue with ChatGPT
                  </button>`
                : null
          }
          ${
            state.accounts.length
              ? html` <div class="control-group">
                  <button
                    class="control-btn"
                    ?disabled=${state.pending}
                    @click=${() => void this.chatgptAction(() => bridge?.login(true))}
                  >
                    Add account
                  </button>
                  <button
                    class="control-btn"
                    ?disabled=${!state.connected}
                    @click=${() => void this.chatgptAction(() => bridge?.logout())}
                  >
                    Sign out
                  </button>
                  <button
                    class="control-btn"
                    @click=${() => void api()?.shell?.openExternal?.('https://chatgpt.com/settings/usage')}
                  >
                    Manage usage
                  </button>
                </div>`
              : null
          }
        </div>
      </div>
      ${state.pending ? html`<div class="setting-desc" role="status">Finish sign-in in your browser.</div>` : null}
      ${state.error ? html`<div class="setting-desc" role="alert">${state.error}</div>` : null}
      ${state.sessionOnly ? html`<div class="setting-desc">Secure storage is unavailable. This connection lasts for this app session.</div>` : null}
      ${
        state.needsWelcome
          ? html` <writemd-modal
              label="You're using your ChatGPT plan"
              @modal-dismiss=${() => void this.chatgptAction(() => bridge?.acknowledgePlan())}
            >
              <div
                class="section chatgpt-welcome"
                role="dialog"
                aria-label="You're using your ChatGPT plan"
              >
                <h2>You're using your ChatGPT plan</h2>
                <p>
                  Eligible AI requests in WriteMd use your ChatGPT plan. Manage usage and this app's
                  access in ChatGPT Settings.
                </p>
                <button
                  class="control-btn"
                  @click=${() => void api()?.shell?.openExternal?.('https://chatgpt.com/settings/usage')}
                >
                  Manage usage
                </button>
                <button
                  class="control-btn"
                  @click=${() => void this.chatgptAction(() => bridge?.acknowledgePlan())}
                >
                  Got it
                </button>
              </div>
            </writemd-modal>`
          : null
      }
    `
  }

  private async openCodeAction(action: () => Promise<OpenCodeAuthView> | undefined): Promise<void> {
    this.aiFetchError = ''
    try {
      const state = await action()
      if (!state)
        throw new Error('OpenCode sign-in is unavailable. Restart WriteMd after updating.')
      this.openCodeState.apply(state)
    } catch (error) {
      this.aiFetchError = error instanceof Error ? error.message : 'OpenCode sign-in failed.'
    }
  }

  private renderOpenCodeCredentials(): unknown {
    const state = this.aiOpenCodeState
    const bridge = api()?.ai?.opencode
    return html`
      <div class="setting-row">
        <div>
          <div class="setting-label">OpenCode account</div>
          <div class="setting-desc">
            ${state.connected ? 'Connected to your OpenCode workspace.' : 'Sign in and choose a workspace in your browser.'}
            No API key needed.
          </div>
        </div>
        <div class="control-stack">
          ${
            state.pending
              ? html` <div class="setting-desc" role="status">
                    Enter code <strong>${state.userCode}</strong> in your browser.
                  </div>
                  <div class="control-group">
                    <button
                      class="control-btn"
                      @click=${() => state.verificationUri && void api()?.shell?.openExternal?.(state.verificationUri)}
                    >
                      Open sign-in page
                    </button>
                    <button
                      class="control-btn"
                      @click=${() => void this.openCodeAction(() => bridge?.cancel())}
                    >
                      Cancel sign-in
                    </button>
                  </div>`
              : html` <button
                  class="control-btn"
                  @click=${() => void this.openCodeAction(() => bridge?.login())}
                >
                  ${state.connected ? 'Change workspace' : 'Continue with OpenCode'}
                </button>`
          }
          ${
            state.connected
              ? html` <div class="control-group">
                  <button
                    class="control-btn"
                    @click=${() => void this.openCodeAction(() => bridge?.logout())}
                  >
                    Sign out
                  </button>
                  <button
                    class="control-btn"
                    @click=${() => void api()?.shell?.openExternal?.('https://opencode.ai/console')}
                  >
                    Open Console
                  </button>
                </div>`
              : null
          }
        </div>
      </div>
      ${state.error ? html`<div class="setting-desc ai-message" role="alert">${state.error}</div>` : null}
      ${state.sessionOnly ? html`<div class="setting-desc ai-message">Secure storage is unavailable. Sign in again after restarting WriteMd.</div>` : null}
    `
  }

  private renderAi(): unknown {
    const preset = this.activeAiPreset()
    const needsKey = preset?.keyRequired ?? true
    const chatgpt = this.aiProviderId === 'chatgpt'
    const opencode = this.aiProviderId === 'opencode'
    return html`
      <div class="ai-settings">
        <div class="section-title">Assistant</div>
        <div class="section">
          <div class="setting-row">
            <div>
              <div class="setting-label">Enable AI assistant</div>
              <div class="setting-desc">Chat about your notes and make changes you can undo.</div>
            </div>
            <button
              class="toggle-switch"
              role="switch"
              aria-checked="${this.aiEnabled}"
              aria-label="Enable AI assistant"
              @click=${() => this.updateSetting('ai.enabled', !this.aiEnabled)}
            ></button>
          </div>
        </div>

        <div class="section-title">Connection</div>
        <div class="section">
          <div class="setting-row">
            <div>
              <div class="setting-label">Provider</div>
              <div class="setting-desc">Choose the service that runs your assistant.</div>
            </div>
            <wa-select
              size="small"
              class="select-input"
              label="Provider"
              aria-label="Provider"
              .value=${this.aiProviderId}
              @change=${(e: Event) =>
                this.selectAiProvider(String((e.currentTarget as WaSelect).value ?? ''))}
            >
              <span slot="start">${providerIcon(this.aiProviderId, 16)}</span>
              ${this.aiPresets.map((p) => html`<wa-option value=${p.id}><span slot="start">${providerIcon(p.id, 16)}</span>${p.label}</wa-option>`)}
            </wa-select>
          </div>

          ${
            chatgpt
              ? this.renderChatgptCredentials()
              : opencode
                ? this.renderOpenCodeCredentials()
                : html`
                    <div class="setting-row">
                      <div>
                        <div class="setting-label">API Key</div>
                        <div class="setting-desc">
                          ${
                            this.aiKeyUnreadable
                              ? html`<span style="color: var(--warning)"
                                  >A key is stored but this install cannot decrypt it. Type a new
                                  one to replace it.</span
                                >`
                              : this.aiKeySet
                                ? 'A key is stored on this machine, encrypted with your OS keychain.'
                                : needsKey
                                  ? 'Your secret API key'
                                  : 'Not needed for this provider'
                          }
                          ${preset?.keyHint ? html` &middot; ${preset.keyHint}` : ''}
                        </div>
                      </div>
                      <div class="control-group">
                        <input
                          type="password"
                          class="text-input"
                          aria-label="API Key"
                          placeholder=${needsKey ? 'Paste your API key' : 'Not needed'}
                          .value=${this.aiKeyInput}
                          @input=${(e: Event) => {
                            this.aiKeyInput = (e.currentTarget as HTMLInputElement).value
                          }}
                        />
                        <button
                          class="control-btn"
                          @click=${() => void this.saveAiKey()}
                          ?disabled=${!this.aiKeyInput.trim()}
                        >
                          Save
                        </button>
                        ${
                          this.aiKeySet
                            ? html`<button
                                class="control-btn"
                                @click=${() => void this.clearAiKey()}
                              >
                                Clear
                              </button>`
                            : ''
                        }
                      </div>
                    </div>
                  `
          }
          ${
            !chatgpt && !opencode
              ? html`
                  <div class="setting-row">
                    <div>
                      <div class="setting-label">Endpoint</div>
                      <div class="setting-desc">
                        ${
                          needsKey && !this.aiBaseUrl.startsWith('https://') && this.aiBaseUrl
                            ? 'An API key will not be sent over plain http to a remote host.'
                            : chatgpt
                              ? 'ChatGPT account requests use the official OpenAI service.'
                              : 'Edit this for a proxy or a self-hosted server.'
                        }
                      </div>
                    </div>
                    <input
                      type="url"
                      class="text-input"
                      aria-label="Endpoint"
                      placeholder="https://api.openai.com/v1"
                      .value=${this.aiBaseUrl}
                      ?disabled=${chatgpt}
                      @change=${(e: Event) =>
                        this.updateSetting(
                          'ai.baseUrl',
                          (e.currentTarget as HTMLInputElement).value.trim()
                        )}
                    />
                  </div>
                `
              : null
          }
          <div class="setting-row">
            <div>
              <div class="setting-label">Model</div>
              <div class="setting-desc">
                ${
                  this.aiModels.length
                    ? `${this.aiModels.length} available`
                    : chatgpt
                      ? 'Load the models available to your account.'
                      : 'Load the models available from your provider.'
                }
              </div>
            </div>
            <div class="control-group">
              <wa-select
                size="small"
                class="select-input"
                label="Model"
                aria-label="Model"
                .value=${this.aiModel}
                @change=${(e: Event) =>
                  this.updateSetting('ai.model', String((e.currentTarget as WaSelect).value ?? ''))}
              >
                <span slot="start">${providerIcon(this.aiProviderId, 14)}</span>
                ${(this.aiModels.length ? this.aiModels : this.aiModel ? [this.aiModel] : []).map(
                  (m) =>
                    html`<wa-option value=${m}
                      >${chatgpt ? this.chatgptState.label(m) : opencode ? this.openCodeState.label(m) : m}</wa-option
                    >`
                )}
              </wa-select>
              <button
                class="control-btn"
                aria-label="Fetch models"
                ?disabled=${this.aiFetchingModels}
                @click=${() => void this.fetchAiModels()}
              >
                ${this.aiFetchingModels ? 'Loading...' : 'Fetch'}
              </button>
            </div>
          </div>
          ${
            this.aiFetchError
              ? html`<div class="setting-desc ai-message" role="alert">${this.aiFetchError}</div>`
              : ''
          }
          <div class="setting-row">
            <div>
              <div class="setting-label">Model options</div>
              <div class="setting-desc">Saved separately for each model.</div>
            </div>
            <writemd-ai-model-options .settingsMode=${true}></writemd-ai-model-options>
          </div>
        </div>

        <div class="section-title">Conversation</div>
        <div class="section">
          <div class="setting-row">
            <div>
              <div class="setting-label">Automatically accept AI edits</div>
              <div class="setting-desc">
                Apply completed floating-bar edits without pressing Accept. The side panel already
                applies edits automatically.
              </div>
            </div>
            <button
              class="toggle-switch"
              role="switch"
              aria-checked=${this.aiAutoAcceptEdits}
              aria-label="Automatically accept AI edits"
              @click=${() => this.updateSetting('ai.autoAcceptEdits', !this.aiAutoAcceptEdits)}
            ></button>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">Output limit</div>
              <div class="setting-desc">
                Maximum tokens per reply, including reasoning.
                ${
                  preset?.kind === 'anthropic'
                    ? 'Automatic uses 4,096 tokens for Anthropic, which requires an explicit limit.'
                    : 'Automatic uses the provider default.'
                }
              </div>
            </div>
            <wa-select
              size="small"
              class="select-input"
              label="Output limit"
              aria-label="Output limit"
              .value=${String(this.aiMaxOutputTokens)}
              @change=${(e: Event) => this.updateSetting('ai.maxOutputTokens', Number((e.currentTarget as WaSelect).value))}
            >
              ${[0, 4096, 8192, 16384, 32768, 65536, 131072].map(
                (value) => html`
                  <wa-option value=${String(value)}
                    >${value === 0 ? 'Automatic' : `${value.toLocaleString('en-US')} tokens`}</wa-option
                  >
                `
              )}
            </wa-select>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">Chat history</div>
              <div class="setting-desc">
                Previous turns included with each message. Set to 0 to start fresh. Your open
                document is attached to the latest message.
              </div>
            </div>
            <input
              type="number"
              class="text-input"
              aria-label="Chat history"
              min="0"
              max="50"
              step="1"
              style="max-width: 90px"
              .value=${String(this.aiHistoryTurns)}
              @change=${(e: Event) =>
                this.updateSetting(
                  'ai.historyTurns',
                  Math.max(
                    0,
                    Math.min(50, Number((e.currentTarget as HTMLInputElement).value) || 0)
                  )
                )}
            />
          </div>
        </div>

        <div class="section-title">Privacy</div>
        <div class="section">
          <div class="setting-desc">
            Messages, your open document, and selections are sent to your chosen provider.
            Credentials stay encrypted on this machine. Use a local provider such as Ollama to keep
            your notes on your device.
          </div>
        </div>
      </div>
    `
  }

  private renderSkills(): unknown {
    return html`<div class="ai-settings">
      <div class="section-title">Skills</div>
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">Personal skills</div>
            <div class="setting-desc">
              Add <code>proofread.md</code> or <code>proofread/SKILL.md</code> in your vault's
              <code>Skills</code> folder. Start a prompt with <code>/proofread</code> to use it.
              Instructions only; scripts are not run.
            </div>
          </div>
          <div class="control-group ai-skills-actions">
            <button class="control-btn" @click=${() => void this.openAiSkillsFolder()}>
              Open skills folder
            </button>
            <button class="control-btn" @click=${() => void this.loadAiSkills()}>
              Refresh skills
            </button>
          </div>
        </div>
        ${
          this.aiSkills
            ? html`<div class="setting-desc ai-skills-path">${this.aiSkills.folder}</div>
                ${
                  this.aiSkills.skills.length
                    ? html`<ul class="ai-skill-list" aria-label="Available skills">
                        ${this.aiSkills.skills.map(
                          (skill) =>
                            html` <li>
                              <div class="setting-label"><code>/${skill.name}</code></div>
                              <div class="setting-desc">${skill.description}</div>
                            </li>`
                        )}
                      </ul>`
                    : html`<div class="setting-desc">
                        No skills added yet. Files are read fresh when you send a prompt.
                      </div>`
                }
                ${this.aiSkills.warnings.map((warning) => html`<div class="setting-desc ai-skill-warning" role="status">${warning}</div>`)}`
            : ''
        }
        ${this.aiSkillsError ? html`<div class="setting-desc" role="alert">${this.aiSkillsError}</div>` : ''}
      </div>
    </div>`
  }

  private async restartForGraphics(): Promise<void> {
    if (this.restarting) return
    this.restarting = true
    this.restartError = ''
    try {
      if (!(await this.settingsStore.whenSaved())) {
        this.restartError = 'Settings could not be saved. Retry saving before restarting.'
        return
      }
      const files = FileState.getInstance().getState()
      if (files.dirty || files.tabs.some((tab) => tab.dirty) || files.secondaryDoc?.dirty) {
        this.restartError = 'Save your notes before restarting WriteMd.'
        return
      }
      const restart = api()?.app?.restart
      if (!restart) throw new Error('Restart is unavailable')
      await restart()
    } catch {
      this.restartError = 'Could not restart WriteMd. Close and reopen it to apply this change.'
    } finally {
      this.restarting = false
    }
  }

  private renderSystem(): unknown {
    return html`
      <div class="section-title">Performance</div>
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">Hardware acceleration</div>
            <div class="setting-desc">
              Use the GPU to render the interface. Turn off to troubleshoot graphics issues.
              Requires a restart.
            </div>
          </div>
          <button
            class="toggle-switch"
            role="switch"
            aria-checked=${this.hardwareAcceleration}
            aria-label="Hardware acceleration"
            ?disabled=${this.restarting}
            @click=${() => {
              this.restartError = ''
              this.updateSetting('advanced.hardwareAcceleration', !this.hardwareAcceleration)
            }}
          ></button>
        </div>
        ${
          this.startupHardwareAcceleration !== null &&
          this.hardwareAcceleration !== this.startupHardwareAcceleration
            ? html`<div class="setting-row">
                <div class="setting-desc" role="status">Restart WriteMd to apply this change.</div>
                <button
                  class="control-btn"
                  ?disabled=${this.restarting}
                  @click=${this.restartForGraphics}
                >
                  ${this.restarting ? 'Restarting…' : 'Restart WriteMd'}
                </button>
              </div>`
            : ''
        }
        ${
          this.restartError
            ? html`<div class="setting-desc" role="alert">${this.restartError}</div>`
            : ''
        }
      </div>

      <div class="section-title">Reset preferences</div>
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

  private renderExport(): unknown {
    return html`
      <div class="section-title">PDF export</div>
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">PDF page size</div>
            <div class="setting-desc">Paper size for PDF export</div>
          </div>
          <wa-select
            size="small"
            class="select-input"
            label="PDF page size"
            aria-label="PDF page size"
            .value=${this.pdfPageSize}
            @change=${(e: Event) => this.updateSetting('export.pdfPageSize', String((e.currentTarget as WaSelect).value ?? ''))}
          >
            <wa-option value="A4">A4</wa-option>
            <wa-option value="A5">A5</wa-option>
            <wa-option value="Letter">Letter</wa-option>
            <wa-option value="Legal">Legal</wa-option>
            <wa-option value="Tabloid">Tabloid</wa-option>
          </wa-select>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">PDF theme</div>
            <div class="setting-desc">Color scheme for exported documents</div>
          </div>
          <wa-select
            size="small"
            class="select-input"
            label="PDF theme"
            aria-label="PDF theme"
            .value=${this.pdfTheme}
            @change=${(e: Event) => this.updateSetting('export.pdfTheme', String((e.currentTarget as WaSelect).value ?? ''))}
          >
            <wa-option value="light">Light</wa-option>
            <wa-option value="dark">Dark</wa-option>
          </wa-select>
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
            <div class="setting-label">Release notes</div>
            <div class="setting-desc">See what changed in this version</div>
          </div>
          <button class="control-btn" @click=${this.handleShowWhatsNew}>What's new</button>
        </div>
      </div>

      <div class="section-title">Updates</div>
      <div class="section">
        <div class="setting-row">
          <div>
            <div class="setting-label">Auto-check for updates</div>
            <div class="setting-desc">Quietly check for updates in the background</div>
          </div>
          <button
            class="toggle-switch"
            role="switch"
            aria-checked="${this.autoCheckForUpdates}"
            aria-label="Auto-check for updates"
            @click=${() => this.updateSetting('updates.autoCheckForUpdates', !this.autoCheckForUpdates)}
          ></button>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-label">Updates</div>
            <div class="setting-desc" role="status" aria-live="polite">${statusText}</div>
          </div>
          <div class="control-group">
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
