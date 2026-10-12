import { css, html, LitElement } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { api } from '../../api'
import type { VaultTreeNode } from '../../../../shared/electron-api'
import { scrollbarStyles } from '../scrollbars'
import { icon } from '../icons'
import type { AiAttachment } from './types'

/**
 * The composer's size and attachment budget.
 *
 * The size cap is stated to the user rather than applied silently. An
 * attachment that quietly arrives truncated produces an answer about a file
 * that does not exist, and the user has no way to tell that happened.
 */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
export const MAX_ATTACHMENTS_TOTAL_BYTES = 12 * 1024 * 1024
export const MAX_COMPOSER_ROWS = 8

export interface QuickAction {
  id: string
  label: string
  prompt: string
}

/** Offered only when there is a selection to act on. Each is just a prompt. */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: 'fix',
    label: 'Fix',
    prompt: 'Fix the problems in the selection: spelling, grammar and clarity.'
  },
  {
    id: 'rewrite',
    label: 'Rewrite',
    prompt: 'Rewrite the selection so it reads better. Keep the meaning.'
  },
  {
    id: 'shorten',
    label: 'Shorten',
    prompt: 'Shorten the selection. Keep every fact, drop the padding.'
  },
  {
    id: 'continue',
    label: 'Continue',
    prompt: 'Continue writing from where the selection leaves off.'
  }
]

export interface ComposerSendDetail {
  text: string
  attachments: AiAttachment[]
}

interface FileEntry {
  /** Vault-relative, forward slashes. What a mention inserts. */
  relative: string
  name: string
}

interface MentionState {
  /** Index of the `@` in the textarea value, or -1 when closed. */
  start: number
  query: string
  index: number
  matches: FileEntry[]
}

const IMAGE_TYPES = /^image\//

/**
 * Flatten a vault tree into mentionable files, relative to the vault root.
 *
 * The tree carries absolute paths because the explorer needs them to open
 * things. A mention is inserted as a relative path because that is what the
 * model writes back, and what the user can read.
 */
export function vaultFiles(
  node: VaultTreeNode,
  root = node.path,
  out: FileEntry[] = []
): FileEntry[] {
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const walk = (current: VaultTreeNode): void => {
    if (!current.isDirectory) {
      if (!current.path) return
      const forward = current.path.replace(/\\/g, '/')
      const relative =
        base && forward.startsWith(base)
          ? forward.slice(base.length).replace(/^\/+/, '')
          : current.name
      out.push({ relative, name: current.name })
      return
    }
    for (const child of current.children ?? []) walk(child)
  }
  walk(node)
  return out
}

/** Case-insensitive, path-segment-aware ranking. Exact stem first, then prefix, then substring. */
export function rankFiles(files: readonly FileEntry[], query: string): FileEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...files]
  const scored: Array<{ entry: FileEntry; score: number }> = []
  for (const entry of files) {
    const path = entry.relative.toLowerCase()
    const name = entry.name.toLowerCase()
    const stem = name.replace(/\.[^/.]+$/, '')
    let score = -1
    if (stem === q || path === q) score = 0
    else if (stem.startsWith(q) || name.startsWith(q)) score = 1
    else if (path.startsWith(q)) score = 2
    else if (path.includes(`/${q}`)) score = 3
    else if (stem.includes(q)) score = 4
    else if (path.includes(q)) score = 5
    if (score >= 0) scored.push({ entry, score })
  }
  scored.sort((a, b) => a.score - b.score || a.entry.relative.localeCompare(b.entry.relative))
  return scored.map((s) => s.entry)
}

/**
 * Where the `@` of a mention starts, or null.
 *
 * The character before the `@` has to be nothing or whitespace. Without that
 * check `someone@example.com` opens a file picker in the middle of an email
 * address, which is the single most annoying thing a mention autocomplete can
 * do to someone who types prose.
 */
export function mentionStartAt(
  value: string,
  caret: number
): { start: number; query: string } | null {
  const before = value.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(before[at - 1])) return null
  const query = before.slice(at + 1)
  if (/\s/.test(query)) return null
  return { start: at, query }
}

/** Read a dropped or picked file into the shape the bridge takes. */
export function readAsAttachment(file: File): Promise<AiAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = (): void => reject(reader.error ?? new Error('Could not read the file.'))
    reader.onload = (): void => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      if (IMAGE_TYPES.test(file.type)) {
        // readAsDataURL prefixes `data:<mime>;base64,`. The bridge wants the
        // payload alone, and the mime goes in its own field.
        const comma = result.indexOf(',')
        resolve({
          name: file.name,
          kind: 'image',
          data: comma >= 0 ? result.slice(comma + 1) : result,
          mimeType: file.type || 'image/png'
        })
        return
      }
      resolve({ name: file.name, kind: 'text', text: result })
    }
    if (IMAGE_TYPES.test(file.type)) reader.readAsDataURL(file)
    else reader.readAsText(file)
  })
}

/**
 * The message box: text, `@` file mentions, attachments and quick actions.
 *
 * It owns no turn state. Everything it does it reports upwards through
 * `composer-send`, which carries the prompt and the attachments, so the dock
 * stays the one place that decides what a turn is.
 */
@customElement('writemd-ai-composer')
export class AiComposer extends LitElement {
  /** Streaming. Swaps Send for Stop and refuses to start a second turn. */
  @property({ type: Boolean }) busy = false
  /** Gates the quick actions: they are all "do something to this". */
  @property({ type: Boolean }) hasSelection = false

  @state() private value = ''
  @state() private attachments: AiAttachment[] = []
  @state() private mention: MentionState | null = null
  @state() private files: FileEntry[] = []
  @state() private attachmentError = ''

  // No initializers: @query installs a getter, so assigning to it throws.
  @query('textarea') private input!: HTMLTextAreaElement | null
  @query('.file-input') private fileInput!: HTMLInputElement | null

  /** Bumped per keystroke, so a slow tree read cannot revive a stale mention. */
  private mentionToken = 0

  focus(): void {
    this.input?.focus()
  }

  get text(): string {
    return this.value
  }

  /** Grow with the content, up to a height where the transcript stays visible. */
  private resize(): void {
    const el = this.input
    if (!el) return
    el.style.height = 'auto'
    const line = parseFloat(getComputedStyle(el).lineHeight) || 18
    el.style.height = `${Math.min(el.scrollHeight || line, line * MAX_COMPOSER_ROWS)}px`
  }

  private onInput = (): void => {
    const el = this.input
    if (!el) return
    this.value = el.value
    this.resize()
    void this.refreshMention(el.value, el.selectionStart ?? el.value.length)
  }

  /** Load the vault once, then filter from memory on every keystroke. */
  private async refreshMention(value: string, caret: number): Promise<void> {
    const found = mentionStartAt(value, caret)
    if (!found) {
      this.mentionToken++
      this.mention = null
      return
    }
    const token = ++this.mentionToken
    const files = await this.loadFiles()
    if (token !== this.mentionToken) return
    const matches = rankFiles(files, found.query).slice(0, 8)
    this.mention = { start: found.start, query: found.query, index: 0, matches }
  }

  private async loadFiles(): Promise<FileEntry[]> {
    if (this.files.length) return this.files
    try {
      const tree = await api()?.vault?.getTree?.()
      if (tree) this.files = vaultFiles(tree)
    } catch (err) {
      console.error('Could not read the vault tree for mentions:', err)
    }
    return this.files
  }

  /** Replace the `@query` run with the chosen path. */
  private commitMention(entry: FileEntry): void {
    const mention = this.mention
    if (!mention) return
    const caret = this.input?.selectionStart ?? this.value.length
    const insertion = `@${entry.relative} `
    const next = this.value.slice(0, mention.start) + insertion + this.value.slice(caret)
    this.value = next
    this.mention = null
    void this.updateComplete.then(() => {
      const el = this.input
      if (!el) return
      el.value = next
      const pos = mention.start + insertion.length
      el.focus()
      el.setSelectionRange(pos, pos)
      this.resize()
    })
  }

  private moveMention(delta: number): void {
    const mention = this.mention
    if (!mention?.matches.length) return
    const count = mention.matches.length
    this.mention = { ...mention, index: (mention.index + delta + count) % count }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.mention) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        this.moveMention(1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        this.moveMention(-1)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        this.mention = null
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const entry = this.mention.matches[this.mention.index]
        if (!entry) return
        e.preventDefault()
        this.commitMention(entry)
        return
      }
    }
    if (e.key !== 'Enter' || e.shiftKey) return
    // IME composition: Enter confirms the candidate, it does not send.
    if (e.isComposing) return
    e.preventDefault()
    this.submit()
  }

  private submit(): void {
    const text = this.value.trim()
    if (!text || this.busy) return
    const attachments = this.attachments
    this.value = ''
    this.attachments = []
    this.attachmentError = ''
    this.mention = null
    // Written to the element rather than left to the `.value` binding: typing
    // then Enter inside one task coalesces into a single render, where the
    // binding sees '' equal to the '' it last committed and writes nothing. The
    // typed text would sit in the box next to the message that was just sent.
    const el = this.input
    if (el) {
      el.value = ''
      el.setSelectionRange(0, 0)
    }
    this.resize()
    this.dispatchEvent(
      new CustomEvent<ComposerSendDetail>('composer-send', {
        detail: { text, attachments },
        bubbles: true,
        composed: true
      })
    )
  }

  private onQuickAction = (action: QuickAction): void => {
    if (this.busy) return
    this.value = action.prompt
    void this.updateComplete.then(() => {
      this.resize()
      this.submit()
    })
  }

  private onPickFiles = (): void => {
    this.fileInput?.click()
  }

  private onFilesChosen = (e: Event): void => {
    const input = e.target as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    if (!files.length) return
    void this.addFiles(files)
  }

  private async addFiles(files: readonly File[]): Promise<void> {
    let total = this.attachmentBytes()
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        this.attachmentError = `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(
          MAX_ATTACHMENT_BYTES
        )} per file.`
        continue
      }
      if (total + file.size > MAX_ATTACHMENTS_TOTAL_BYTES) {
        this.attachmentError = `Attachments are capped at ${formatBytes(
          MAX_ATTACHMENTS_TOTAL_BYTES
        )} in total. Remove one to add another.`
        continue
      }
      try {
        const attachment = await readAsAttachment(file)
        this.attachments = [...this.attachments, attachment]
        this.attachmentError = ''
        total += file.size
      } catch (err) {
        this.attachmentError = `Could not read ${file.name}: ${
          err instanceof Error ? err.message : String(err)
        }`
      }
    }
  }

  private attachmentBytes(): number {
    let total = 0
    for (const attachment of this.attachments) {
      total +=
        attachment.kind === 'image'
          ? (attachment.data?.length ?? 0) * 0.75
          : (attachment.text?.length ?? 0)
    }
    return total
  }

  private removeAttachment(index: number): void {
    this.attachments = this.attachments.filter((_, i) => i !== index)
  }

  render(): unknown {
    const hasText = this.value.trim().length > 0
    const canSend = hasText && !this.busy
    const showQuick = !hasText && this.hasSelection && !this.busy
    return html`
      <div class="composer">
        ${
          showQuick
            ? html`
                <div class="quick" role="group" aria-label="Quick actions">
                  ${QUICK_ACTIONS.map(
                    (action) => html`
                      <button class="quick-btn" @click=${() => this.onQuickAction(action)}>
                        ${action.label}
                      </button>
                    `
                  )}
                </div>
              `
            : null
        }
        ${
          this.attachments.length
            ? html`
                <div class="chips">
                  ${this.attachments.map(
                    (attachment, index) => html`
                      <span class="chip" title=${attachment.name}>
                        ${icon('file', 12)}
                        <span class="chip-name">${attachment.name}</span>
                        <button
                          class="chip-remove"
                          aria-label=${`Remove ${attachment.name}`}
                          @click=${() => this.removeAttachment(index)}
                        >
                          ${icon('x', 12)}
                        </button>
                      </span>
                    `
                  )}
                </div>
              `
            : null
        }
        ${
          this.mention && this.mention.matches.length
            ? html`
                <div class="mention" role="listbox" aria-label="Files">
                  ${this.mention.matches.map(
                    (entry, index) => html`
                      <button
                        class="mention-item"
                        role="option"
                        aria-selected=${index === this.mention?.index ? 'true' : 'false'}
                        tabindex="-1"
                        @mousedown=${(e: Event) => {
                          e.preventDefault()
                          this.commitMention(entry)
                        }}
                      >
                        <span class="mention-name">${entry.name}</span>
                        <span class="mention-path">${entry.relative}</span>
                      </button>
                    `
                  )}
                </div>
              `
            : null
        }
        <div class="field">
          <input
            class="file-input"
            type="file"
            multiple
            hidden
            aria-hidden="true"
            tabindex="-1"
            @change=${this.onFilesChosen}
          />
          <textarea
            class="input"
            rows="1"
            placeholder="Ask, or @ to reference a file"
            aria-label="Message"
            .value=${this.value}
            aria-expanded=${this.mention && this.mention.matches.length ? 'true' : 'false'}
            @input=${this.onInput}
            @keydown=${this.onKeyDown}
            @paste=${(e: ClipboardEvent) => {
              const files = Array.from(e.clipboardData?.files ?? [])
              if (files.length) {
                e.preventDefault()
                void this.addFiles(files)
              }
            }}
          ></textarea>
          <div class="actions">
            <button
              class="icon-btn"
              aria-label="Attach a file"
              title="Attach a file"
              ?disabled=${this.busy}
              @click=${this.onPickFiles}
            >
              ${icon('insert', 16)}
            </button>
            ${
              this.busy
                ? html` <button class="send stop" @click=${this.onStop}>Stop</button> `
                : html`
                    <button class="send" ?disabled=${!canSend} @click=${this.submit}>Send</button>
                  `
            }
          </div>
        </div>
        ${this.attachmentError ? html`<div class="warn" role="alert">${this.attachmentError}</div>` : null}
      </div>
    `
  }

  private onStop = (): void => {
    this.dispatchEvent(new CustomEvent('composer-stop', { bubbles: true, composed: true }))
  }

  static styles = [
    scrollbarStyles,
    css`
      :host {
        display: block;
        flex-shrink: 0;
        border-top: 1px solid var(--border-subtle);
        background: var(--bg);
        font-family: var(--font-ui);
      }

      .composer {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px;
      }

      .quick {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .quick-btn {
        font: inherit;
        font-size: 11px;
        color: var(--text-secondary);
        background: var(--bg-hover);
        border: 1px solid var(--border-subtle);
        border-radius: 999px;
        padding: 3px 10px;
        cursor: pointer;
      }

      .quick-btn:hover {
        color: var(--text);
        background: var(--bg-active);
      }

      .chips {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        max-width: 100%;
        padding: 2px 4px 2px 7px;
        border-radius: 5px;
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        font-size: 11px;
        color: var(--text-secondary);
      }

      .chip-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 140px;
      }

      .chip-remove {
        display: inline-flex;
        border: none;
        background: none;
        padding: 0 1px;
        color: var(--text-muted);
        cursor: pointer;
      }

      .chip-remove:hover {
        color: var(--text);
      }

      .mention {
        max-height: 220px;
        overflow-y: auto;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--menu-bg);
        box-shadow: var(--shadow-2);
        padding: 2px;
      }

      .mention-item {
        display: flex;
        align-items: baseline;
        gap: 8px;
        width: 100%;
        text-align: left;
        font: inherit;
        font-size: 12px;
        padding: 5px 8px;
        border: none;
        border-radius: 4px;
        background: none;
        color: var(--text-secondary);
        cursor: pointer;
      }

      .mention-item[aria-selected='true'] {
        background: var(--bg-active);
        color: var(--text);
      }

      .mention-name {
        flex-shrink: 0;
        color: var(--text);
      }

      .mention-path {
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--text-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .field {
        display: flex;
        align-items: flex-end;
        gap: 6px;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 6px 6px 6px 10px;
      }

      .field:focus-within {
        border-color: var(--border-focus);
      }

      .input {
        flex: 1;
        min-width: 0;
        border: none;
        outline: none;
        resize: none;
        background: transparent;
        color: var(--text);
        font-family: var(--font-ui);
        font-size: 13px;
        line-height: 1.5;
        max-height: 160px;
        overflow-y: auto;
        padding: 2px 0;
      }

      .input::placeholder {
        color: var(--text-muted);
      }

      .actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }

      .icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border: none;
        border-radius: 5px;
        background: none;
        color: var(--text-muted);
        cursor: pointer;
      }

      .icon-btn:hover:not(:disabled) {
        background: var(--bg-hover);
        color: var(--text);
      }

      .icon-btn:disabled {
        opacity: 0.4;
        cursor: default;
      }

      .send {
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        color: var(--accent-text);
        background: var(--accent);
        border: none;
        border-radius: 5px;
        padding: 5px 12px;
        cursor: pointer;
      }

      .send:disabled {
        opacity: 0.4;
        cursor: default;
      }

      .send.stop {
        color: var(--text);
        background: var(--bg-hover);
        border: 1px solid var(--border);
      }

      .warn {
        font-size: 11px;
        color: var(--danger);
      }
    `
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-ai-composer': AiComposer
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
