import { html, css, LitElement, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import type { ElectronAPI, VaultFile } from '../../../shared/electron-api'
import watermarkPng from '../../../../icons/Group 12.png'
import { SettingsStore } from '../state/settings'

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

interface RecentFile {
  name: string
  path: string
  fullPath: string
}

@customElement('writemd-welcome-screen')
export class WelcomeScreen extends LitElement {
  static styles = css`
    /* ───── Host: outer frame ───── */
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      min-width: 0;
      background: #0a0a0a;
      overflow: hidden;
      border-radius: 10px;
    }

    /* ───── Top Bar ───── */
    .top-bar {
      display: flex;
      align-items: flex-end;
      height: 43px;
      padding: 0 12px 6px 12px;
      flex-shrink: 0;
      -webkit-app-region: drag;
      user-select: none;
      gap: 0;
      box-sizing: border-box;
    }

    .top-bar-left {
      display: flex;
      align-items: center;
      gap: 4px;
      -webkit-app-region: no-drag;
      flex-shrink: 0;
    }

    .top-icon-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 20px;
      border: none;
      background: none;
      border-radius: 5px;
      cursor: pointer;
      padding: 1px 4px;
      -webkit-app-region: no-drag;
    }
    .top-icon-btn:hover {
      background: rgba(255, 255, 255, 0.05);
    }
    .top-icon-btn svg {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }

    /* ───── Tab Bar ───── */
    .tab-bar {
      display: flex;
      align-items: center;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      -webkit-app-region: no-drag;
      margin-left: 4px;
    }

    .tab {
      display: flex;
      align-items: center;
      height: 32px;
      min-width: 80px;
      max-width: 169px;
      flex: 0 1 169px;
      border-radius: 5px;
      padding: 0 11px;
      cursor: default;
      position: relative;
      gap: 8px;
      box-sizing: border-box;
      background: none;
      border: none;
      font-family: 'Geist Mono', monospace;
      font-size: 14px;
      line-height: 18px;
      color: #737373;
      font-weight: 400;
    }
    .tab .separator {
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 2px;
      height: 8px;
      background: #171717;
      border-radius: 1px;
    }
    .tab.active {
      background: rgba(255, 255, 255, 0.05);
      color: #d4d4d4;
      font-weight: 600;
    }
    .tab.active .separator {
      display: none;
    }
    .tab-label {
      white-space: nowrap;
      overflow: hidden;
      -webkit-mask-image: linear-gradient(to right, black 80%, transparent 100%);
      mask-image: linear-gradient(to right, black 80%, transparent 100%);
      flex: 1;
      min-width: 0;
    }
    .tab-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 12px;
      height: 12px;
      flex-shrink: 0;
    }
    .tab-close svg {
      width: 12px;
      height: 12px;
    }

    .tab-add {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 20px;
      flex-shrink: 0;
      color: #737373;
      cursor: pointer;
      border: none;
      background: none;
      border-radius: 5px;
      -webkit-app-region: no-drag;
      margin-left: 4px;
    }
    .tab-add:hover {
      background: rgba(255, 255, 255, 0.05);
      color: #d4d4d4;
    }
    .tab-add svg {
      width: 14px;
      height: 14px;
    }

    /* ───── Top Bar Right ───── */
    .top-bar-right {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
      flex-shrink: 0;
      -webkit-app-region: no-drag;
    }

    .window-controls {
      display: flex;
      gap: 4px;
    }
    .window-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 4px;
      color: #737373;
      border: none;
      background: none;
      cursor: pointer;
    }
    .window-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #d4d4d4;
    }
    .window-btn.close:hover {
      background: #d32f2f;
      color: #fff;
    }
    .window-btn svg {
      width: 12px;
      height: 12px;
    }

    /* ───── Split View Panel ───── */
    .split-view {
      flex: 1;
      margin: 0 5px 5px 5px;
      border-radius: 10px;
      background: #141414;
      position: relative;
      overflow: hidden;
      container-type: size;
    }
    /* Gradient border via pseudo-element */
    .split-view::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 10px;
      padding: 1px;
      background: linear-gradient(180deg, #282828 0%, #000000 100%);
      -webkit-mask:
        linear-gradient(#fff 0 0) content-box,
        linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
      z-index: 1;
    }

    /* ───── Gradient Fade at top of split view ───── */
    .fade-bar {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 49px;
      background: linear-gradient(180deg, #141414 76.4%, transparent 100%);
      z-index: 2;
      pointer-events: none;
    }

    /* ───── Watermark + App Title (PNG) ─────
       Pre-rendered image pinned to the bottom of the split view.
       Contains the "W" arches and "WriteMd" text. */
    .watermark {
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      pointer-events: none;
      user-select: none;
      z-index: 0;
      line-height: 0;
    }
    .watermark img {
      width: 100%;
      height: auto;
      display: block;
      object-fit: contain;
      object-position: bottom;
    }

    /* ───── Main Content ───── */
    .main-content {
      position: absolute;
      left: 50%;
      top: 75px;
      transform: translateX(-50%);
      width: 907px;
      max-width: 94%;
      display: flex;
      gap: 100px;
      align-items: flex-start;
      z-index: 3;
    }

    /* ───── Recent Files ───── */
    .recent-files {
      width: 401px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 46px;
      align-items: stretch;
    }
    .recent-header {
      font-family: 'Geist Mono', monospace;
      font-weight: 500;
      font-size: 20px;
      line-height: 26px;
      color: #ffffff;
    }
    .file-list {
      display: flex;
      flex-direction: column;
      gap: 41px;
    }
    .file-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      height: 21px;
      cursor: pointer;
    }
    .file-item:hover .file-name {
      color: #d4d4d4;
    }
    .file-name {
      font-family: 'Geist Mono', monospace;
      font-size: 16px;
      line-height: 21px;
      color: #ffffff;
      white-space: nowrap;
      overflow: hidden;
      -webkit-mask-image: linear-gradient(to right, black 80%, transparent 100%);
      mask-image: linear-gradient(to right, black 80%, transparent 100%);
      transition: color 100ms;
    }
    .file-path {
      font-family: 'Geist Mono', monospace;
      font-weight: 500;
      font-size: 14px;
      line-height: 18px;
      color: #404040;
      text-align: right;
      white-space: nowrap;
      overflow: hidden;
      -webkit-mask-image: linear-gradient(to right, black 80%, transparent 100%);
      mask-image: linear-gradient(to right, black 80%, transparent 100%);
      flex-shrink: 0;
      max-width: 55%;
    }
    .recent-empty {
      font-family: 'Geist Mono', monospace;
      font-size: 14px;
      line-height: 18px;
      color: #737373;
    }

    /* ───── Buttons ───── */
    .buttons {
      width: 406px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .buttons-row {
      display: flex;
      gap: 20px;
      align-items: center;
    }

    .btn-wrap {
      position: relative;
      border-radius: 5px;
    }
    .btn-wrap.w-160 {
      width: 160px;
      flex-shrink: 0;
    }
    .btn-wrap.w-46 {
      width: 46px;
      flex: 0 0 46px;
    }
    .btn-wrap.w-full {
      width: 100%;
    }

    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      height: 44px;
      padding: 10px;
      background: #161616;
      border: none;
      border-radius: 4px;
      color: #ffffff;
      font-family: 'Geist Mono', monospace;
      font-size: 14px;
      line-height: 18px;
      cursor: pointer;
      box-sizing: border-box;
      box-shadow:
        0 1px 2px rgba(0, 0, 0, 0.3),
        0 4px 12px rgba(0, 0, 0, 0.25);
    }
    .btn:hover {
      background: #1e1e1e;
      box-shadow:
        0 2px 4px rgba(0, 0, 0, 0.35),
        0 6px 16px rgba(0, 0, 0, 0.3);
    }
    .btn.vault {
      font-size: 16px;
      line-height: 21px;
    }
    .btn svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
    .btn span {
      white-space: nowrap;
      overflow: hidden;
      -webkit-mask-image: linear-gradient(to right, black 80%, transparent 100%);
      mask-image: linear-gradient(to right, black 80%, transparent 100%);
    }

    /* ───── Vertical panel ───── */
    .main-content.vertical {
      width: min(406px, 92%);
      flex-direction: column;
      gap: 48px;
    }
    .main-content.vertical .recent-files,
    .main-content.vertical .buttons {
      width: 100%;
    }

    /* ───── Responsive ───── */
    @container (max-width: 1000px) {
      .main-content {
        width: min(406px, 92%);
        flex-direction: column;
        gap: 48px;
      }
      .recent-files,
      .buttons {
        width: 100%;
      }
      .app-title {
        display: none;
      }
    }
  `

  @state() private recentFiles: RecentFile[] = []
  @state() private panelOrientation: 'horizontal' | 'vertical' = 'horizontal'
  private readonly watermarkUrl = watermarkPng as string
  private settingsStore = SettingsStore.getInstance()

  async connectedCallback(): Promise<void> {
    super.connectedCallback()
    this.panelOrientation = this.settingsStore.get('appearance.panelOrientation', 'horizontal') as 'horizontal' | 'vertical'
    this.settingsStore.subscribe('appearance.panelOrientation', (v) => {
      this.panelOrientation = (v as 'horizontal' | 'vertical') ?? 'horizontal'
    })
    try {
      await this.settingsStore.init()
      this.panelOrientation = this.settingsStore.get('appearance.panelOrientation', 'horizontal') as 'horizontal' | 'vertical'
      const storedRecent = this.settingsStore.get<string[]>('files.recentFiles', [])
      if (storedRecent && storedRecent.length > 0) {
        this.recentFiles = storedRecent.slice(0, 4).map((fullPath) => {
          const parts = fullPath.replace(/\\/g, '/').split('/')
          const fileName = parts.pop() || fullPath
          const folder = parts.pop() || ''
          return {
            name: fileName.replace(/\.md$/i, ''),
            path: folder ? `${folder}/${fileName}` : fileName,
            fullPath
          }
        })
      } else {
        const files: VaultFile[] = (await api()?.vault?.listFiles?.()) ?? []
        this.recentFiles = files.slice(0, 4).map((f) => {
          const parts = f.path.replace(/\\/g, '/').split('/')
          const fileName = parts.pop() ?? f.name
          const folder = parts.pop() ?? ''
          return {
            name: fileName.replace(/\.md$/i, ''),
            path: folder ? `${folder}/${fileName}` : fileName,
            fullPath: f.path
          }
        })
      }
    } catch {
      this.recentFiles = []
    }
  }

  private emit = (action: string, detail?: unknown): void => {
    this.dispatchEvent(new CustomEvent(action, { detail, bubbles: true, composed: true }))
  }

  private openRecent = (file: RecentFile): void => {
    this.emit('open-recent', { path: file.fullPath })
  }

  render(): unknown {
    return html`
      <!-- ═══ Top Bar ═══ -->
      <div class="top-bar">
        <div class="top-bar-left">
          <!-- Menu icon (Group.svg) -->
          <button class="top-icon-btn" aria-label="Menu" title="Menu">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path
                d="M15.0375 8.25H2.9625C2.569 8.25 2.25 8.569 2.25 8.9625V9.0375C2.25 9.431 2.569 9.75 2.9625 9.75H15.0375C15.431 9.75 15.75 9.431 15.75 9.0375V8.9625C15.75 8.569 15.431 8.25 15.0375 8.25Z"
                fill="#737373"
              />
              <path
                d="M15.0375 12H2.9625C2.569 12 2.25 12.319 2.25 12.7125V12.7875C2.25 13.181 2.569 13.5 2.9625 13.5H15.0375C15.431 13.5 15.75 13.181 15.75 12.7875V12.7125C15.75 12.319 15.431 12 15.0375 12Z"
                fill="#737373"
              />
              <path
                d="M15.0375 4.5H2.9625C2.569 4.5 2.25 4.819 2.25 5.2125V5.2875C2.25 5.681 2.569 6 2.9625 6H15.0375C15.431 6 15.75 5.681 15.75 5.2875V5.2125C15.75 4.819 15.431 4.5 15.0375 4.5Z"
                fill="#737373"
              />
            </svg>
          </button>
          <!-- Settings icon (Settings.svg) -->
          <button
            class="top-icon-btn"
            @click=${() => this.emit('open-settings')}
            aria-label="Settings"
            title="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path
                fill-rule="evenodd"
                clip-rule="evenodd"
                d="M8.5785 2.25C8.112 2.25 7.734 2.628 7.734 3.09375L7.63275 3.8025C7.61199 3.94748 7.55384 4.08456 7.46404 4.20026C7.37423 4.31595 7.25586 4.40628 7.12055 4.46235C6.98525 4.51843 6.83768 4.53832 6.69236 4.52006C6.54705 4.50181 6.40898 4.44604 6.29175 4.35825L5.71875 3.9285C5.6404 3.85015 5.54739 3.788 5.44502 3.7456C5.34265 3.70319 5.23293 3.68137 5.12213 3.68137C5.01132 3.68137 4.9016 3.70319 4.79923 3.7456C4.69686 3.788 4.60385 3.85015 4.5255 3.9285L3.9285 4.5255C3.5985 4.8555 3.5985 5.38875 3.9285 5.718L4.35825 6.29175C4.44603 6.40893 4.50181 6.54694 4.5201 6.6922C4.5384 6.83747 4.51857 6.98499 4.46258 7.12028C4.40659 7.25556 4.31636 7.37395 4.20076 7.4638C4.08516 7.55365 3.94817 7.61188 3.80325 7.63275L3.09375 7.73475C2.628 7.73475 2.25 8.112 2.25 8.57775V9.42225C2.25 9.88725 2.628 10.2653 3.09375 10.2653L3.8025 10.3673C3.94748 10.388 4.08456 10.4462 4.20026 10.536C4.31595 10.6258 4.40628 10.7441 4.46235 10.8794C4.51843 11.0147 4.53832 11.1623 4.52006 11.3076C4.50181 11.453 4.44604 11.591 4.35825 11.7083L3.9285 12.2812C3.5985 12.6112 3.5985 13.1452 3.9285 13.4745L4.5255 14.0715C4.8555 14.4015 5.38875 14.4015 5.718 14.0715L6.29175 13.6417C6.40893 13.554 6.54694 13.4982 6.6922 13.4799C6.83747 13.4616 6.98499 13.4814 7.12028 13.5374C7.25556 13.5934 7.37395 13.6836 7.4638 13.7992C7.55365 13.9148 7.61188 14.0518 7.63275 14.1968L7.73475 14.9062C7.73475 15.372 8.112 15.75 8.57775 15.75H9.42225C9.88725 15.75 10.2653 15.372 10.2653 14.9062L10.3673 14.1975C10.388 14.0525 10.4462 13.9154 10.536 13.7997C10.6258 13.684 10.7441 13.5937 10.8794 13.5376C11.0147 13.4816 11.1623 13.4617 11.3076 13.4799C11.453 13.4982 11.591 13.554 11.7083 13.6417L12.2812 14.0715C12.6112 14.4015 13.1452 14.4015 13.4745 14.0715L14.0715 13.4745C14.4007 13.1445 14.4007 12.6112 14.0715 12.282L13.6417 11.7083C13.554 11.5911 13.4982 11.4531 13.4799 11.3078C13.4616 11.1625 13.4814 11.015 13.5374 10.8797C13.5934 10.7444 13.6836 10.626 13.7992 10.5362C13.9148 10.4463 14.0518 10.3881 14.1968 10.3673L14.9062 10.2653C15.372 10.2653 15.75 9.888 15.75 9.42225V8.57775C15.75 8.11275 15.372 7.73475 14.9062 7.73475L14.1975 7.63275C14.0525 7.61199 13.9154 7.55384 13.7997 7.46404C13.684 7.37423 13.5937 7.25586 13.5376 7.12055C13.4816 6.98525 13.4617 6.83768 13.4799 6.69236C13.4982 6.54705 13.554 6.40898 13.6417 6.29175L14.0715 5.71875C14.4007 5.38875 14.4007 4.85475 14.0715 4.5255L13.4745 3.9285C13.3163 3.77049 13.1018 3.68174 12.8783 3.68174C12.6547 3.68174 12.4402 3.77049 12.282 3.9285L11.7083 4.35825C11.5911 4.44603 11.4531 4.50181 11.3078 4.5201C11.1625 4.5384 11.015 4.51857 10.8797 4.46258C10.7444 4.40659 10.626 4.31636 10.5362 4.20076C10.4463 4.08516 10.3881 3.94817 10.3673 3.80325L10.2653 3.09375C10.2653 2.628 9.888 2.25 9.42225 2.25H8.5785ZM9 10.6875C9.44755 10.6875 9.87677 10.5097 10.1932 10.1932C10.5097 9.87677 10.6875 9.44755 10.6875 9C10.6875 8.55245 10.5097 8.12323 10.1932 7.80676C9.87677 7.49029 9.44755 7.3125 9 7.3125C8.55245 7.3125 8.12323 7.49029 7.80676 7.80676C7.49029 8.12323 7.3125 8.55245 7.3125 9C7.3125 9.44755 7.49029 9.87677 7.80676 10.1932C8.12323 10.5097 8.55245 10.6875 9 10.6875Z"
                fill="#737373"
              />
            </svg>
          </button>
        </div>

        <div class="tab-bar">
          ${nothing /* Tabs are populated when files are open — empty on welcome */}
        </div>

        <div class="top-bar-right">
          <!-- Split view icon (Component 29 (1).svg) -->
          <button class="top-icon-btn" aria-label="Split view" title="Split view">
            <svg width="17" height="17" viewBox="-2.5 -2.5 22 22" fill="none">
              <path
                d="M15 0C16.1046 0 17 0.895431 17 2V15C17 16.0357 16.2128 16.887 15.2041 16.9893L15 17H2L1.7959 16.9893C0.854346 16.8938 0.1062 16.1457 0.0107422 15.2041L0 15V2C0 0.895431 0.895431 4.0266e-09 2 0H15ZM2 1C1.44772 1 1 1.44772 1 2V15C1 15.5523 1.44772 16 2 16H6V1H2ZM7 16H15C15.5523 16 16 15.5523 16 15V2C16 1.44772 15.5523 1 15 1H7V16Z"
                fill="#737373"
              />
            </svg>
          </button>

          <div class="window-controls">
            <button
              class="window-btn"
              @click=${() => void api()?.window?.minimize?.()}
              aria-label="Minimize"
            >
              <svg viewBox="0 0 10 10" fill="none">
                <path d="M0 5H10" stroke="currentColor" stroke-width="1" />
              </svg>
            </button>
            <button
              class="window-btn"
              @click=${() => void api()?.window?.maximize?.()}
              aria-label="Maximize"
            >
              <svg viewBox="0 0 10 10" fill="none">
                <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" stroke-width="1" />
              </svg>
            </button>
            <button
              class="window-btn close"
              @click=${() => void api()?.window?.close?.()}
              aria-label="Close"
            >
              <svg viewBox="0 0 10 10" fill="none">
                <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" stroke="currentColor" stroke-width="1" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- ═══ Split View Panel ═══ -->
      <div class="split-view">
        <div class="fade-bar"></div>
        <div class="watermark" aria-hidden="true">
          <img src="${this.watermarkUrl}" alt="" />
        </div>

        <div class="main-content ${this.panelOrientation === 'vertical' ? 'vertical' : ''}">
          <!-- Recent Files -->
          <div class="recent-files">
            <div class="recent-header">Recent files</div>
            ${
              this.recentFiles.length === 0
                ? html`<div class="recent-empty">No files yet. Create one to get started.</div>`
                : html`
                    <div class="file-list">
                      ${this.recentFiles.map(
                        (file) => html`
                          <div class="file-item" @click=${() => this.openRecent(file)}>
                            <span class="file-name">${file.name}</span>
                            <span class="file-path">${file.path}</span>
                          </div>
                        `
                      )}
                    </div>
                  `
            }
          </div>

          <!-- Buttons -->
          <div class="buttons">
            <div class="buttons-row">
              <div class="btn-wrap w-160">
                <button class="btn" @click=${() => this.emit('open-file')}>
                  <!-- bi_folder-fill.svg -->
                  <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M9.82805 3H13.8101C14.088 2.99997 14.3628 3.05787 14.6171 3.16999C14.8714 3.28212 15.0996 3.44601 15.287 3.65122C15.4744 3.85643 15.617 4.09845 15.7057 4.36184C15.7944 4.62524 15.8272 4.90422 15.802 5.181L15.165 12.181C15.1199 12.6779 14.8906 13.14 14.5223 13.4766C14.1539 13.8131 13.673 13.9998 13.174 14H2.82505C2.32609 13.9998 1.84522 13.8131 1.47685 13.4766C1.10847 13.14 0.879206 12.6779 0.83405 12.181L0.19705 5.181C0.155287 4.71785 0.27622 4.25463 0.53905 3.871L0.50005 3C0.50005 2.46957 0.710763 1.96086 1.08584 1.58579C1.46091 1.21071 1.96962 1 2.50005 1H6.17205C6.70244 1.00011 7.21106 1.2109 7.58605 1.586L8.41405 2.414C8.78903 2.7891 9.29766 2.99989 9.82805 3ZM1.50605 3.12C1.72072 3.04067 1.94872 3.00067 2.19005 3H7.58605L6.87905 2.293C6.69156 2.10545 6.43724 2.00006 6.17205 2H2.50005C2.23809 1.99995 1.98658 2.1027 1.79958 2.28614C1.61258 2.46959 1.50503 2.71909 1.50005 2.981L1.50605 3.12Z"
                      fill="currentColor"
                    />
                  </svg>
                  <span>Open file</span>
                </button>
              </div>
              <div class="btn-wrap w-160">
                <button class="btn" @click=${() => this.emit('new-file')}>
                  <!-- basil_edit-solid.svg -->
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M16.4771 3.004C16.6441 3.019 16.7171 3.223 16.5971 3.342L8.27712 11.662C8.18313 11.756 8.11583 11.8734 8.08212 12.002L7.08212 15.832C7.04911 15.9586 7.04977 16.0916 7.08405 16.2178C7.11833 16.344 7.18502 16.4591 7.27751 16.5516C7.37 16.6441 7.48508 16.7108 7.61131 16.7451C7.73755 16.7793 7.87055 16.78 7.99712 16.747L11.8261 15.747C11.9548 15.713 12.0722 15.6454 12.1661 15.551L20.6041 7.113C20.6305 7.0859 20.6641 7.06693 20.701 7.05833C20.7378 7.04974 20.7764 7.05188 20.812 7.06451C20.8477 7.07713 20.879 7.09971 20.9022 7.12957C20.9255 7.15943 20.9396 7.19533 20.9431 7.233C21.2944 10.5826 21.2742 13.9608 20.8831 17.306C20.6601 19.211 19.1291 20.706 17.2311 20.919C13.7548 21.3041 10.2465 21.3041 6.77012 20.919C4.87112 20.706 3.34012 19.211 3.11712 17.306C2.7051 13.781 2.7051 10.22 3.11712 6.695C3.34012 4.789 4.87112 3.294 6.77012 3.082C9.99463 2.72457 13.2473 2.69844 16.4771 3.004Z"
                      fill="currentColor"
                    />
                    <path
                      d="M17.8229 4.23702C17.8461 4.21374 17.8737 4.19527 17.9041 4.18266C17.9344 4.17006 17.967 4.16357 17.9999 4.16357C18.0328 4.16357 18.0653 4.17006 18.0957 4.18266C18.1261 4.19527 18.1537 4.21374 18.1769 4.23702L19.5909 5.65202C19.6376 5.69888 19.6638 5.76235 19.6638 5.82852C19.6638 5.89469 19.6376 5.95816 19.5909 6.00502L11.2979 14.3C11.2663 14.3315 11.227 14.3539 11.1839 14.365L9.26988 14.865C9.22769 14.876 9.18335 14.8758 9.14128 14.8644C9.0992 14.853 9.06084 14.8307 9.03001 14.7999C8.99918 14.7691 8.97695 14.7307 8.96552 14.6886C8.9541 14.6465 8.95388 14.6022 8.96488 14.56L9.46488 12.646C9.47601 12.6029 9.49845 12.5636 9.52988 12.532L17.8229 4.23702Z"
                      fill="currentColor"
                    />
                  </svg>
                  <span>New file</span>
                </button>
              </div>
              <div class="btn-wrap w-46">
                <button
                  class="btn"
                  @click=${() => this.emit('open-settings')}
                  aria-label="Settings"
                  title="Settings"
                >
                  <!-- Settings.svg -->
                  <svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                    <path
                      fill-rule="evenodd"
                      clip-rule="evenodd"
                      d="M8.5785 2.25C8.112 2.25 7.734 2.628 7.734 3.09375L7.63275 3.8025C7.61199 3.94748 7.55384 4.08456 7.46404 4.20026C7.37423 4.31595 7.25586 4.40628 7.12055 4.46235C6.98525 4.51843 6.83768 4.53832 6.69236 4.52006C6.54705 4.50181 6.40898 4.44604 6.29175 4.35825L5.71875 3.9285C5.6404 3.85015 5.54739 3.788 5.44502 3.7456C5.34265 3.70319 5.23293 3.68137 5.12213 3.68137C5.01132 3.68137 4.9016 3.70319 4.79923 3.7456C4.69686 3.788 4.60385 3.85015 4.5255 3.9285L3.9285 4.5255C3.5985 4.8555 3.5985 5.38875 3.9285 5.718L4.35825 6.29175C4.44603 6.40893 4.50181 6.54694 4.5201 6.6922C4.5384 6.83747 4.51857 6.98499 4.46258 7.12028C4.40659 7.25556 4.31636 7.37395 4.20076 7.4638C4.08516 7.55365 3.94817 7.61188 3.80325 7.63275L3.09375 7.73475C2.628 7.73475 2.25 8.112 2.25 8.57775V9.42225C2.25 9.88725 2.628 10.2653 3.09375 10.2653L3.8025 10.3673C3.94748 10.388 4.08456 10.4462 4.20026 10.536C4.31595 10.6258 4.40628 10.7441 4.46235 10.8794C4.51843 11.0147 4.53832 11.1623 4.52006 11.3076C4.50181 11.453 4.44604 11.591 4.35825 11.7083L3.9285 12.2812C3.5985 12.6112 3.5985 13.1452 3.9285 13.4745L4.5255 14.0715C4.8555 14.4015 5.38875 14.4015 5.718 14.0715L6.29175 13.6417C6.40893 13.554 6.54694 13.4982 6.6922 13.4799C6.83747 13.4616 6.98499 13.4814 7.12028 13.5374C7.25556 13.5934 7.37395 13.6836 7.4638 13.7992C7.55365 13.9148 7.61188 14.0518 7.63275 14.1968L7.73475 14.9062C7.73475 15.372 8.112 15.75 8.57775 15.75H9.42225C9.88725 15.75 10.2653 15.372 10.2653 14.9062L10.3673 14.1975C10.388 14.0525 10.4462 13.9154 10.536 13.7997C10.6258 13.684 10.7441 13.5937 10.8794 13.5376C11.0147 13.4816 11.1623 13.4617 11.3076 13.4799C11.453 13.4982 11.591 13.554 11.7083 13.6417L12.2812 14.0715C12.6112 14.4015 13.1452 14.4015 13.4745 14.0715L14.0715 13.4745C14.4007 13.1445 14.4007 12.6112 14.0715 12.282L13.6417 11.7083C13.554 11.5911 13.4982 11.4531 13.4799 11.3078C13.4616 11.1625 13.4814 11.015 13.5374 10.8797C13.5934 10.7444 13.6836 10.626 13.7992 10.5362C13.9148 10.4463 14.0518 10.3881 14.1968 10.3673L14.9062 10.2653C15.372 10.2653 15.75 9.888 15.75 9.42225V8.57775C15.75 8.11275 15.372 7.73475 14.9062 7.73475L14.1975 7.63275C14.0525 7.61199 13.9154 7.55384 13.7997 7.46404C13.684 7.37423 13.5937 7.25586 13.5376 7.12055C13.4816 6.98525 13.4617 6.83768 13.4799 6.69236C13.4982 6.54705 13.554 6.40898 13.6417 6.29175L14.0715 5.71875C14.4007 5.38875 14.4007 4.85475 14.0715 4.5255L13.4745 3.9285C13.3163 3.77049 13.1018 3.68174 12.8783 3.68174C12.6547 3.68174 12.4402 3.77049 12.282 3.9285L11.7083 4.35825C11.5911 4.44603 11.4531 4.50181 11.3078 4.5201C11.1625 4.5384 11.015 4.51857 10.8797 4.46258C10.7444 4.40659 10.626 4.31636 10.5362 4.20076C10.4463 4.08516 10.3881 3.94817 10.3673 3.80325L10.2653 3.09375C10.2653 2.628 9.888 2.25 9.42225 2.25H8.5785ZM9 10.6875C9.44755 10.6875 9.87677 10.5097 10.1932 10.1932C10.5097 9.87677 10.6875 9.44755 10.6875 9C10.6875 8.55245 10.5097 8.12323 10.1932 7.80676C9.87677 7.49029 9.44755 7.3125 9 7.3125C8.55245 7.3125 8.12323 7.49029 7.80676 7.80676C7.49029 8.12323 7.3125 8.55245 7.3125 9C7.3125 9.44755 7.49029 9.87677 7.80676 10.1932C8.12323 10.5097 8.55245 10.6875 9 10.6875Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              </div>
            </div>
            <div class="btn-wrap w-full">
              <button class="btn vault" @click=${() => this.emit('open-vault')}>
                <!-- fluent_vault-24-filled.svg -->
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M14 13.5C14.3978 13.5 14.7794 13.342 15.0607 13.0607C15.342 12.7794 15.5 12.3978 15.5 12C15.5 11.6022 15.342 11.2206 15.0607 10.9393C14.7794 10.658 14.3978 10.5 14 10.5C13.6022 10.5 13.2206 10.658 12.9393 10.9393C12.658 11.2206 12.5 11.6022 12.5 12C12.5 12.3978 12.658 12.7794 12.9393 13.0607C13.2206 13.342 13.6022 13.5 14 13.5ZM2 7.75C2 6.75544 2.39509 5.80161 3.09835 5.09835C3.80161 4.39509 4.75544 4 5.75 4H18.25C19.2446 4 20.1984 4.39509 20.9017 5.09835C21.6049 5.80161 22 6.75544 22 7.75V16.25C22 17.2446 21.6049 18.1984 20.9017 18.9017C20.1984 19.6049 19.2446 20 18.25 20H5.75C4.75544 20 3.80161 19.6049 3.09835 18.9017C2.39509 18.1984 2 17.2446 2 16.25V7.75ZM5.75 7C5.55109 7 5.36032 7.07902 5.21967 7.21967C5.07902 7.36032 5 7.55109 5 7.75V16.25C5 16.4489 5.07902 16.6397 5.21967 16.7803C5.36032 16.921 5.55109 17 5.75 17C5.94891 17 6.13968 16.921 6.28033 16.7803C6.42098 16.6397 6.5 16.4489 6.5 16.25V7.75C6.5 7.55109 6.42098 7.36032 6.28033 7.21967C6.13968 7.07902 5.94891 7 5.75 7ZM11.28 8.22C11.2113 8.14631 11.1285 8.08721 11.0365 8.04622C10.9445 8.00523 10.8452 7.98319 10.7445 7.98141C10.6438 7.97963 10.5438 7.99816 10.4504 8.03588C10.357 8.0736 10.2722 8.12974 10.201 8.20096C10.1297 8.27218 10.0736 8.35701 10.0359 8.4504C9.99816 8.54379 9.97963 8.64382 9.98141 8.74452C9.98318 8.84522 10.0052 8.94454 10.0462 9.03654C10.0872 9.12854 10.1463 9.21134 10.22 9.28L11.415 10.476C11.143 10.9378 10.9997 11.4641 11 12C11 12.556 11.151 13.077 11.415 13.524L10.22 14.72C10.1463 14.7887 10.0872 14.8715 10.0462 14.9635C10.0052 15.0555 9.98318 15.1548 9.98141 15.2555C9.97963 15.3562 9.99816 15.4562 10.0359 15.5496C10.0736 15.643 10.1297 15.7278 10.201 15.799C10.2722 15.8703 10.357 15.9264 10.4504 15.9641C10.5438 16.0018 10.6438 16.0204 10.7445 16.0186C10.8452 16.0168 10.9445 15.9948 11.0365 15.9538C11.1285 15.9128 11.2113 15.8537 11.28 15.78L12.476 14.585C12.923 14.849 13.444 15 14 15C14.556 15 15.077 14.849 15.524 14.585L16.72 15.78C16.7887 15.8537 16.8715 15.9128 16.9635 15.9538C17.0555 15.9948 17.1548 16.0168 17.2555 16.0186C17.3562 16.0204 17.4562 16.0018 17.5496 15.9641C17.643 15.9264 17.7278 15.8703 17.799 15.799C17.8703 15.7278 17.9264 15.643 17.9641 15.5496C18.0018 15.4562 18.0204 15.3562 18.0186 15.2555C18.0168 15.1548 17.9948 15.0555 17.9538 14.9635C17.9128 14.8715 17.8537 14.7887 17.78 14.72L16.585 13.524C16.849 13.077 17 12.556 17 12C17 11.444 16.849 10.923 16.585 10.476L17.78 9.28C17.9125 9.13783 17.9846 8.94978 17.9812 8.75548C17.9777 8.56118 17.899 8.37579 17.7616 8.23838C17.6242 8.10097 17.4388 8.02225 17.2445 8.01882C17.0502 8.0154 16.8622 8.08752 16.72 8.22L15.524 9.415C15.0622 9.14302 14.5359 8.99972 14 9C13.444 9 12.923 9.151 12.476 9.415L11.28 8.22Z"
                    fill="currentColor"
                  />
                </svg>
                <span>Open vault folder</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-welcome-screen': WelcomeScreen
  }
}
