import { css, html, LitElement, type TemplateResult } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { api } from '../../api'
import type { VaultTreeNode } from '../../../../shared/electron-api'
import { scrollbarStyles } from '../scrollbars'
import { icon } from '../icons'
import { aiActivityStyles, aiThinkingLabel, chromeIcon } from '../../design/icons'
import { controlStyles } from '../../design/controls'
import { menuStyles } from '../menu-styles'
import { emit, on } from '../../events/bus'
import type { AiAttachment } from './types'
import { SettingsStore } from '../../state/settings'
import { ChatgptState } from '../../state/chatgpt'
import { OpenCodeState } from '../../state/opencode'
import './ModelPicker'
import './ModelOptions'

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

interface SkillEntry {
  kind: 'skill'
  name: string
  description: string
}

type MentionEntry = FileEntry | SkillEntry

function isSkill(entry: MentionEntry): entry is SkillEntry {
  return 'kind' in entry
}

interface MentionState {
  /** Index of the `@` or `/` in the textarea value, or -1 when closed. */
  start: number
  query: string
  index: number
  matches: MentionEntry[]
  mode: 'files' | 'skills'
  /** Which trigger was used: `@` or `/`. */
  trigger: '@' | '/'
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
 * Where the `@` or `/` of a mention starts, or null.
 *
 * The character before the `@` or `/` has to be nothing or whitespace. Without that
 * check `someone@example.com` or `path/to/file` opens a file picker in the middle
 * of text, which is the single most annoying thing a mention autocomplete can
 * do to someone who types prose.
 */
export function mentionStartAt(
  value: string,
  caret: number
): { start: number; query: string; trigger: '@' | '/' } | null {
  const before = value.slice(0, caret)
  if (!before) return null

  // Find all valid @ positions
  const atPositions: number[] = []
  for (let i = before.indexOf('@'); i >= 0; i = before.indexOf('@', i + 1)) {
    if (i === 0 || /\s/.test(before[i - 1])) atPositions.push(i)
  }

  // Find all valid / positions
  const slashPositions: number[] = []
  for (let i = before.indexOf('/'); i >= 0; i = before.indexOf('/', i + 1)) {
    if (i === 0 || /\s/.test(before[i - 1])) slashPositions.push(i)
  }

  if (!atPositions.length && !slashPositions.length) return null

  // Pick the trigger closest to the caret (highest index)
  const lastAt = atPositions[atPositions.length - 1]
  const lastSlash = slashPositions[slashPositions.length - 1]

  // Prefer the one closer to the caret
  if (lastAt !== undefined && (!lastSlash || lastAt > lastSlash)) {
    const query = before.slice(lastAt + 1)
    if (/\s/.test(query)) return null
    return { start: lastAt, query, trigger: '@' }
  }
  if (lastSlash !== undefined) {
    const query = before.slice(lastSlash + 1)
    if (/\s/.test(query)) return null
    return { start: lastSlash, query, trigger: '/' }
  }
  return null
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
  @property({ type: Boolean }) disabled = false
  /** A single floating prompt bar: the one over the document, not the chat panel. */
  @property({ type: Boolean, reflect: true }) compact = false
  /**
   * The model picker takes the whole row in the chat panel, where there is
   * width to spend on it. The floating bar is attach, prompt and send on one
   * line with nothing spare, and the model is picked in the panel the bar hands
   * off to, so the bar leaves it out.
   */
  @property({ type: Boolean, attribute: 'model-picker', reflect: true }) modelPicker = true
  /**
   * The bar is waiting on a reply and says so in the prompt's place.
   *
   * A separate "Thinking" card above the bar did say something was happening,
   * but it left the bar itself looking ready: two things to read for one state,
   * stacked, with the gap between them looking like a seam. Taking the prompt's
   * place keeps the state and the only control that matters - stop - in one
   * row, which is what the reference bar does.
   */
  @property({ type: Boolean, reflect: true }) thinking = false
  /** Secondary line beside the thinking label, e.g. the web search step. */
  @property({ type: String }) thinkingStatus = ''
  @property({ type: String }) placeholder = ''
  /**
   * This conversation already has messages in it.
   *
   * The ChatGPT plan notice belongs to the empty state: it answers "what am I
   * being billed against?" before the first question. Once someone is talking,
   * it is a third card stacked on the transcript, and the answer it gives does
   * not change what they are reading. The dock owns this, since it owns the
   * messages.
   */
  @property({ type: Boolean }) started = false

  @state() private value = ''
  @state() private attachments: AiAttachment[] = []
  @state() private mention: MentionState | null = null
  @state() private files: FileEntry[] = []
  @state() private attachmentError = ''
  @state() private readingFiles = false
  private settings = SettingsStore.getInstance()
  private unsubscribe?: () => void
  private unsubscribeChatgpt?: () => void
  private chatgpt = ChatgptState.getInstance()
  private opencode = OpenCodeState.getInstance()
  private unsubscribeOpenCode?: () => void
  private unsubscribeMenu?: () => void
  @state() private switchingAccount = false
  @state() private accountError = ''
  @state() private accountMenuOpen = false
  @state() private accountMenuPosition = ''
  private attachmentToken = 0
  private skillsRequest: Promise<SkillEntry[]> | null = null

  connectedCallback(): void {
    super.connectedCallback()
    this.unsubscribeMenu = on('menu:open', ({ owner }) => {
      if (owner !== this) {
        this.shadowRoot?.querySelector<HTMLElement>('.account-menu')?.hidePopover?.()
        this.accountMenuOpen = false
      }
    })
    this.unsubscribe = this.settings.subscribe('ai', () => this.requestUpdate())
    this.unsubscribeChatgpt = this.chatgpt.subscribe(() => this.requestUpdate())
    this.unsubscribeOpenCode = this.opencode.subscribe(() => this.requestUpdate())
  }

  disconnectedCallback(): void {
    this.unsubscribe?.()
    this.unsubscribeMenu?.()
    this.unsubscribeChatgpt?.()
    this.unsubscribeOpenCode?.()
    this.mentionToken++
    this.attachmentToken++
    super.disconnectedCallback()
  }

  private async switchChatgptAccount(id: string): Promise<void> {
    this.closeAccountMenu()
    if (this.busy || this.disabled || this.switchingAccount || id === this.chatgpt.state().activeId)
      return
    this.switchingAccount = true
    this.accountError = ''
    try {
      const state = await api()?.ai?.chatgpt?.select(id)
      if (!state)
        throw new Error('Account switching is unavailable. Restart WriteMd after updating.')
      this.chatgpt.apply(state)
      if (state.connected) {
        const models = await this.chatgpt.models()
        if (
          this.chatgpt.state().activeId !== id ||
          this.settings.get<string>('ai.providerId', '') !== 'chatgpt' ||
          !this.isConnected
        )
          return
        this.settings.set(
          'ai.cachedModels',
          models.map((model) => model.id)
        )
        if (
          models.length &&
          !models.some((model) => model.id === this.settings.get('ai.model', ''))
        )
          this.settings.set('ai.model', models[0].id)
      }
    } catch (error) {
      this.accountError =
        error instanceof Error ? error.message : 'Could not switch ChatGPT accounts.'
    } finally {
      this.switchingAccount = false
    }
  }

  private get setupMessage(): string {
    if (!api()?.ai) return ''
    if (!this.settings.get('ai.enabled', false)) return 'Enable the assistant in Settings.'
    const provider = this.settings.get<string>('ai.providerId', 'openai')
    if (provider === 'chatgpt' && !this.chatgpt.state().connected)
      return 'Continue with ChatGPT in Settings.'
    if (provider === 'opencode' && !this.opencode.state().connected)
      return 'Continue with OpenCode in Settings.'
    if (
      !['ollama', 'lmstudio', 'chatgpt', 'opencode'].includes(provider) &&
      !this.settings.get('ai.apiKeySet', false)
    )
      return 'Add your API key in Settings.'
    if (!this.settings.get('ai.model', '').trim()) return 'Choose a model to start chatting.'
    return ''
  }

  setPrompt(text: string): void {
    this.mentionToken++
    this.mention = null
    this.value = text
    void this.updateComplete.then(() => {
      if (this.input) this.input.value = text
      this.resize()
      this.focus()
    })
  }

  resetDraft(): void {
    this.mentionToken++
    this.attachmentToken++
    this.value = ''
    this.attachments = []
    this.mention = null
    this.files = []
    this.readingFiles = false
    this.attachmentError = ''
    if (this.input) this.input.value = ''
    this.resize()
  }

  // No initializers: @query installs a getter, so assigning to it throws.
  @query('textarea') private input!: HTMLTextAreaElement | null
  @query('.file-input') private fileInput!: HTMLInputElement | null

  /** Bumped per keystroke, so a slow tree read cannot revive a stale mention. */
  private mentionToken = 0

  /**
   * Size the box before anyone types in it.
   *
   * The textarea carries a `rows` attribute, and that attribute is taller than
   * one line of prompt - so the bar opened as a two-line box with its controls
   * pushed down to the bottom-right instead of sitting in the row beside the
   * placeholder.
   */
  firstUpdated(): void {
    this.resize()
  }

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
    if (
      found.trigger === '/' &&
      found.start === 0 &&
      !found.query.includes('/') &&
      !found.query.startsWith('"') &&
      api()?.ai?.listSkills
    ) {
      if (this.mention?.mode !== 'skills' || !this.skillsRequest) {
        this.mention = { ...found, mode: 'skills', index: 0, matches: [] }
        this.skillsRequest = this.loadSkills()
      }
      const skills = await this.skillsRequest
      if (token !== this.mentionToken) return
      const query = found.query.toLowerCase()
      const matches = skills
        .filter(
          (skill) =>
            skill.name.toLowerCase().includes(query) ||
            skill.description.toLowerCase().includes(query)
        )
        .sort(
          (a, b) =>
            Number(!a.name.toLowerCase().startsWith(query)) -
              Number(!b.name.toLowerCase().startsWith(query)) || a.name.localeCompare(b.name)
        )
        .slice(0, 8)
      this.mention = { ...found, mode: 'skills', index: 0, matches }
      return
    }
    const files = await this.loadFiles()
    if (token !== this.mentionToken) return
    const matches = rankFiles(files, found.query).slice(0, 8)
    this.mention = {
      start: found.start,
      query: found.query,
      index: 0,
      matches,
      mode: 'files',
      trigger: found.trigger
    }
  }

  private async loadSkills(): Promise<SkillEntry[]> {
    try {
      const view = await api()?.ai?.listSkills?.()
      return (view?.skills ?? []).map((skill) => ({ ...skill, kind: 'skill' }))
    } catch (error) {
      console.error('Could not list AI skills:', error)
      return []
    }
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

  /** Replace the `@query` or `/query` run with the chosen path. */
  private commitMention(entry: MentionEntry): void {
    const mention = this.mention
    if (!mention) return
    const caret = this.input?.selectionStart ?? this.value.length
    const path = isSkill(entry)
      ? entry.name
      : /\s/.test(entry.relative)
        ? `"${entry.relative}"`
        : entry.relative
    const insertion = `${isSkill(entry) ? '/' : mention.trigger}${path} `
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
    if (e.isComposing) return
    if (e.key === 'Escape') {
      this.mentionToken++
      if (this.mention) {
        e.preventDefault()
        e.stopPropagation()
        this.mention = null
      }
      return
    }
    if (this.mention?.matches.length) {
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
    if (
      !text ||
      this.busy ||
      this.disabled ||
      this.switchingAccount ||
      this.setupMessage ||
      this.readingFiles
    )
      return
    const attachments = this.attachments
    this.value = ''
    this.attachments = []
    this.attachmentError = ''
    this.mention = null
    this.mentionToken++
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
    if (this.busy || this.disabled || this.setupMessage) return
    this.value = action.prompt
    void this.updateComplete.then(() => {
      this.resize()
      this.submit()
    })
  }

  private onPickFiles = (): void => {
    this.fileInput?.click()
  }

  /**
   * The attach control.
   *
   * Rendered in two places on purpose. The chat panel keeps it in the action row
   * beside the model picker and send, where there is a row to put it in; the
   * floating bar leads with it, because a bar that opens on the placeholder and
   * hides its add control behind a send button makes attaching the last thing
   * you try.
   */
  private renderAttach(): TemplateResult {
    return html`<button
      class="icon-btn"
      aria-label="Attach a file"
      title="Attach a file"
      ?disabled=${this.busy || this.disabled || this.readingFiles}
      @click=${this.onPickFiles}
    >
      ${chromeIcon('plus')}
    </button>`
  }

  private onFilesChosen = (e: Event): void => {
    const input = e.target as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    if (!files.length) return
    void this.addFiles(files)
  }

  private async addFiles(files: readonly File[]): Promise<void> {
    if (this.busy || this.disabled || this.readingFiles) return
    this.readingFiles = true
    const token = ++this.attachmentToken
    this.attachmentError = ''
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
        if (token !== this.attachmentToken || !this.isConnected) return
        this.attachments = [...this.attachments, attachment]
        total += file.size
      } catch (err) {
        if (token !== this.attachmentToken || !this.isConnected) return
        this.attachmentError = `Could not read ${file.name}: ${
          err instanceof Error ? err.message : String(err)
        }`
      }
    }
    this.readingFiles = false
  }

  private attachmentBytes(): number {
    let total = 0
    for (const attachment of this.attachments) {
      total +=
        attachment.kind === 'image'
          ? (attachment.data?.length ?? 0) * 0.75
          : new TextEncoder().encode(attachment.text ?? '').byteLength
    }
    return total
  }

  private removeAttachment(index: number): void {
    this.attachments = this.attachments.filter((_, i) => i !== index)
  }

  private closeAccountMenu(): void {
    this.shadowRoot?.querySelector<HTMLElement>('.account-menu')?.hidePopover?.()
    this.accountMenuOpen = false
    this.shadowRoot?.querySelector<HTMLButtonElement>('.account-picker')?.focus()
  }

  private async toggleAccountMenu(): Promise<void> {
    if (this.busy || this.disabled || this.switchingAccount) return
    if (this.accountMenuOpen) return this.closeAccountMenu()
    emit('menu:open', { owner: this })
    const bounds = this.shadowRoot?.querySelector('.account-picker')?.getBoundingClientRect()
    if (!bounds) return
    const width = Math.min(300, window.innerWidth - 16)
    const left = Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8))
    const above = bounds.top >= window.innerHeight - bounds.bottom
    this.accountMenuPosition = `left:${left}px; width:${width}px; ${above ? `bottom:${window.innerHeight - bounds.top + 4}px` : `top:${bounds.bottom + 4}px`}; max-height:${Math.max(40, Math.min(280, (above ? bounds.top : window.innerHeight - bounds.bottom) - 16))}px`
    this.accountMenuOpen = true
    await this.updateComplete
    if (!this.accountMenuOpen) return
    const menu = this.shadowRoot?.querySelector<HTMLElement>('.account-menu')
    menu?.showPopover?.()
    menu?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
  }

  private accountMenuKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.closeAccountMenu()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = [
      ...(this.shadowRoot?.querySelectorAll<HTMLButtonElement>('[data-account-id]') ?? [])
    ]
    const index = items.indexOf(this.shadowRoot?.activeElement as HTMLButtonElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
    items[next]?.scrollIntoView?.({ block: 'nearest' })
  }

  protected updated(): void {
    if (
      this.accountMenuOpen &&
      (this.busy || this.disabled || this.settings.get<string>('ai.providerId', '') !== 'chatgpt')
    ) {
      this.shadowRoot?.querySelector<HTMLElement>('.account-menu')?.hidePopover?.()
      this.accountMenuOpen = false
    }
  }

  private renderConnectionControls(): TemplateResult {
    return html`
      ${
        this.modelPicker &&
        this.settings.get<string>('ai.providerId', '') === 'chatgpt' &&
        this.chatgpt.state().accounts.length > 1
          ? html` <button
                class="account-picker"
                aria-label="Switch ChatGPT account"
                aria-haspopup="menu"
                aria-expanded=${this.accountMenuOpen}
                title=${this.chatgpt.state().accounts.find((account) => account.id === this.chatgpt.state().activeId)?.label ?? 'Switch ChatGPT account'}
                ?disabled=${this.busy || this.disabled || this.switchingAccount}
                @click=${this.toggleAccountMenu}
              >
                <span
                  >${this.chatgpt.state().accounts.find((account) => account.id === this.chatgpt.state().activeId)?.label ?? 'Account'}</span
                >${icon('chevron-down', 12)}
              </button>
              <div
                class="account-menu m-panel"
                popover="auto"
                role="menu"
                aria-label="ChatGPT accounts"
                style=${this.accountMenuPosition}
                @toggle=${(event: ToggleEvent) => {
                  this.accountMenuOpen = event.newState === 'open'
                }}
                @keydown=${this.accountMenuKeyDown}
              >
                ${this.chatgpt
                  .state()
                  .accounts.map(
                    (account) =>
                      html`<button
                        class="m-item"
                        data-account-id=${account.id}
                        role="menuitemradio"
                        aria-checked=${account.id === this.chatgpt.state().activeId}
                        ?disabled=${this.busy || this.disabled || this.switchingAccount}
                        @click=${() => void this.switchChatgptAccount(account.id)}
                      >
                        <span class="account-label">${account.label}</span
                        >${account.id === this.chatgpt.state().activeId ? icon('check', 14) : null}
                      </button>`
                  )}
              </div>`
          : null
      }
      ${
        this.modelPicker
          ? html`<writemd-ai-model-picker
              .disabled=${this.busy || this.disabled || this.switchingAccount}
            ></writemd-ai-model-picker>`
          : null
      }
      ${this.modelPicker ? html`<writemd-ai-model-options .disabled=${this.busy || this.disabled || this.switchingAccount}></writemd-ai-model-options>` : null}
    `
  }

  private renderSend(canSend: boolean): TemplateResult {
    return html`
      ${
        this.busy
          ? html`
              <button
                class="send stop"
                aria-label="Stop response"
                title="Stop response"
                @click=${this.onStop}
              >
                <span class="stop-symbol"></span>
              </button>
            `
          : html`
              <button
                class="send"
                aria-label="Send message"
                title="Send message (Enter)"
                ?disabled=${!canSend || this.switchingAccount}
                @click=${this.submit}
              >
                ${icon('arrow-up', 18)}
              </button>
            `
      }
    `
  }

  render(): unknown {
    const hasText = this.value.trim().length > 0
    const canSend =
      hasText && !this.busy && !this.disabled && !this.setupMessage && !this.readingFiles
    const showQuick =
      !this.compact &&
      !hasText &&
      this.hasSelection &&
      !this.busy &&
      !this.disabled &&
      !this.setupMessage
    return html`
      <div
        class="composer"
        @dragover=${(event: DragEvent) => {
          if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
        }}
        @drop=${(event: DragEvent) => {
          const files = Array.from(event.dataTransfer?.files ?? [])
          if (!files.length) return
          event.preventDefault()
          event.stopPropagation()
          void this.addFiles(files)
        }}
      >
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
                        ${chromeIcon('file', 14)}
                        <span class="chip-name">${attachment.name}</span>
                        <button
                          class="chip-remove"
                          aria-label=${`Remove ${attachment.name}`}
                          @click=${() => this.removeAttachment(index)}
                        >
                          ${chromeIcon('x', 12)}
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
                <div
                  class="mention m-panel"
                  id="file-suggestions"
                  role="listbox"
                  aria-label=${this.mention.mode === 'skills' ? 'Skills' : 'Files'}
                >
                  ${this.mention.matches.map(
                    (entry, index) => html`
                      <button
                        class="mention-item m-item"
                        id=${`file-suggestion-${index}`}
                        title=${isSkill(entry) ? entry.description : entry.relative}
                        role="option"
                        aria-selected=${index === this.mention?.index ? 'true' : 'false'}
                        tabindex="-1"
                        @mousedown=${(e: Event) => {
                          e.preventDefault()
                          this.commitMention(entry)
                        }}
                      >
                        <span class="mention-name"
                          >${isSkill(entry) ? `/${entry.name}` : entry.name}</span
                        >
                        <span class="mention-path"
                          >${isSkill(entry) ? entry.description : entry.relative}</span
                        >
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
          ${this.compact && !this.thinking ? this.renderAttach() : null}
          ${
            this.thinking
              ? html`<div class="waiting" role="status">
                  ${aiThinkingLabel()}${
                    this.thinkingStatus
                      ? html`<span class="waiting-status">${this.thinkingStatus}</span>`
                      : null
                  }
                </div>`
              : null
          }
          <textarea
            class="input"
            rows="1"
            placeholder=${this.placeholder || (this.hasSelection ? 'Ask about your selection…' : 'Ask WriteMd…')}
            title="/ for skills, @ for notes"
            aria-label="Message"
            ?hidden=${this.thinking}
            aria-controls="file-suggestions"
            aria-activedescendant=${this.mention?.matches.length ? `file-suggestion-${this.mention.index}` : ''}
            ?disabled=${this.disabled}
            .value=${this.value}
            aria-expanded=${this.mention && this.mention.matches.length ? 'true' : 'false'}
            @input=${this.onInput}
            @focus=${() => {
              this.files = []
            }}
            @click=${() => {
              if (this.input) void this.refreshMention(this.value, this.input.selectionStart)
            }}
            @keyup=${(event: KeyboardEvent) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) && this.input)
                void this.refreshMention(this.value, this.input.selectionStart)
            }}
            @keydown=${this.onKeyDown}
            @paste=${(e: ClipboardEvent) => {
              const files = Array.from(e.clipboardData?.files ?? [])
              if (files.length) {
                e.preventDefault()
                void this.addFiles(files)
              }
            }}
          ></textarea>
          ${this.compact ? html`<div class="actions">${this.renderConnectionControls()}${this.renderSend(canSend)}</div>` : this.renderSend(canSend)}
        </div>
        ${this.compact ? null : html`<div class="actions">${this.renderAttach()}<span class="actions-spacer"></span>${this.renderConnectionControls()}</div>`}
        ${this.readingFiles ? html`<div class="reading" role="status">Reading attachments…</div>` : null}
        ${
          !this.started &&
          this.settings.get<string>('ai.providerId', '') === 'chatgpt' &&
          this.chatgpt.state().connected
            ? html`<div class="setup plan-status">
                <span>Using ChatGPT plan</span
                ><button
                  @click=${() => void api()?.shell?.openExternal?.('https://chatgpt.com/settings/usage')}
                >
                  Manage usage
                </button>
              </div>`
            : null
        }
        ${this.setupMessage ? html`<div class="setup" role="status">${this.setupMessage}<button @click=${() => emit('settings:open', { tab: 'ai' })}>Settings</button></div>` : null}
        ${this.accountError ? html`<div class="warn" role="alert">${this.accountError}</div>` : null}
        ${this.attachmentError ? html`<div class="warn" role="alert">${this.attachmentError}</div>` : null}
      </div>
    `
  }

  private onStop = (): void => {
    this.dispatchEvent(new CustomEvent('composer-stop', { bubbles: true, composed: true }))
  }

  static styles = [
    aiActivityStyles,
    scrollbarStyles,
    controlStyles,
    menuStyles,
    css`
      :host {
        display: block;
        flex-shrink: 0;
        font-family: var(--font-ui);
      }

      .composer {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
      }

      :host([compact]) .composer {
        padding: 0;
        gap: 6px;
      }
      /*
       * The bar is one row: attach, prompt, send. It grows upward as the prompt
       * wraps, which is why the row is bottom-aligned rather than centred - a
       * centred row drifts the buttons up the middle of a tall prompt.
       */
      /* The same radius the reply card uses, so the bar and the card above it read
         as one piece. A fully rounded pill made the bar look like a different
         control from the card it belongs with. */
      :host([compact]) .field {
        flex-direction: row;
        align-items: flex-end;
        gap: 4px;
        padding: 8px;
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-2);
      }
      :host([compact]) .input {
        flex: 1 1 auto;
        min-height: 26px;
        font-size: 14px;
        line-height: 22px;
        padding: 4px 2px 0;
      }
      :host([compact]) .actions {
        width: auto;
        margin-left: auto;
        height: 26px;
        gap: 2px;
      }
      :host([compact]) .send,
      :host([compact]) .icon-btn {
        width: 26px;
        height: 26px;
      }
      :host([compact]) writemd-ai-model-picker {
        height: 26px;
      }
      /* The suggestion list belongs to the prompt, so it tracks its width and
         right edge rather than stretching the full bar. */
      :host([compact]) .mention {
        width: min(420px, 100%);
        margin-left: auto;
        max-height: 240px;
      }
      /* Setup notices and attachment errors describe the bar rather than
         sitting under it, so they move above it in the column. */
      :host([compact]) .setup,
      :host([compact]) .warn,
      :host([compact]) .reading {
        order: -1;
        align-self: flex-start;
        max-width: 100%;
        padding: 6px 10px;
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-lg);
        background: var(--bg-elevated);
        box-shadow: var(--shadow-2);
      }

      .quick {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }

      .quick-btn {
        font: inherit;
        font-size: 11px;
        color: var(--text-secondary);
        background: var(--bg-hover);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-full);
        padding: 4px 8px;
        cursor: pointer;
      }

      .quick-btn:hover {
        color: var(--text);
        background: var(--bg-active);
      }

      .chips {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }

      /* The waiting state replaces the prompt inside the bar, on the bar's own
         line-height so the artwork sits where the text would have been. */
      .waiting {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1 1 auto;
        min-width: 0;
        min-height: 26px;
        padding: 2px;
      }
      .waiting-status {
        color: var(--text-muted);
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        max-width: 100%;
        padding: 4px 8px;
        border-radius: var(--radius-full);
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
        position: relative;
        min-width: 0;
        max-width: 100%;
        max-height: 220px;
        box-sizing: border-box;
        overflow-y: auto;
        overflow-x: hidden;
      }

      .mention-item {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
        text-align: left;
        font-family: inherit;
        border: none;
        background: none;
      }

      .mention-item[aria-selected='true'] {
        background: var(--bg-active);
        color: var(--text);
      }

      .mention-name {
        flex: 1;
        min-width: 0;
        color: var(--text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .mention-path {
        flex: 1;
        min-width: 0;
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--text-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .field {
        display: flex;
        flex-direction: row;
        align-items: flex-end;
        gap: 8px;
        /*
         * One prompt field look for both surfaces. The chat panel and the
         * floating bar are the same input in two places, so they share a fill,
         * a border and a focus step: a solid raised surface with a hairline,
         * brightening to --border on focus. A translucent --bg-hover reads as a
         * grey slab over a pane and disappears into a bar that floats.
         */
        background: var(--bg-elevated);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-lg);
        padding: 8px;
      }

      .field:focus-within {
        border-color: var(--border);
      }

      .input {
        box-sizing: border-box;
        flex: 1;
        width: 100%;
        min-height: 26px;
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
        padding: 4px;
      }

      .input::placeholder {
        color: var(--text-muted);
      }

      .actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
        width: 100%;
      }

      .account-picker {
        display: flex;
        align-items: center;
        gap: 4px;
        width: 120px;
        max-width: 40%;
        flex: 0 1 120px;
        height: 28px;
        border: 0;
        padding: 0 8px;
        border-radius: var(--radius-full);
        background: transparent;
        color: var(--text-secondary);
        font-size: 12px;
      }
      .account-picker span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .account-picker:hover:not(:disabled) {
        background: var(--bg-hover);
      }
      .account-menu {
        position: fixed;
        inset: auto;
        margin: 0;
        box-sizing: border-box;
        min-width: 0;
        overflow-y: auto;
      }
      .account-menu .m-item {
        box-sizing: border-box;
        width: 100%;
        border: 0;
        background: transparent;
        text-align: left;
        white-space: normal;
      }
      .account-menu .m-item:hover,
      .account-menu .m-item:focus-visible {
        background: var(--bg-active);
      }
      .account-label {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .actions-spacer {
        flex: 1;
        min-width: 0;
      }
      :host(:not([compact])) .field .send {
        border-radius: var(--radius-sm);
      }
      writemd-ai-model-picker {
        flex: 0 1 auto;
        max-width: 50%;
        min-width: 0;
      }
      .reading {
        font-size: 11px;
        line-height: 16px;
        color: var(--text-muted);
        text-align: left;
        padding: 4px;
      }
      .setup {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        line-height: 1.5;
        color: var(--text-muted);
      }
      .setup button {
        margin-left: auto;
        border: 0;
        border-radius: var(--radius-full);
        padding: 4px 8px;
        background: var(--bg-hover);
        color: var(--text);
        font: inherit;
        cursor: pointer;
      }
      button:focus-visible {
        outline: 2px solid var(--border-focus);
        outline-offset: 2px;
      }
      .stop-symbol {
        display: block;
        width: 12px;
        height: 12px;
        background: currentColor;
        border-radius: 2px;
      }

      .icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        flex-shrink: 0;
        border: none;
        border-radius: var(--radius-full);
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
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        flex-shrink: 0;
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        color: var(--text);
        background: var(--bg-active);
        border: none;
        border-radius: var(--radius-full);
        padding: 4px;
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
