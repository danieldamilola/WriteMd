import type { ReactiveController, ReactiveControllerHost } from 'lit'
import { api } from '../api'
import { SettingsStore } from '../state/settings'
import { DEFAULT_AI_SYSTEM_PROMPT } from '../../../shared/settings-schema'
import type { AttachedFile, ChatMessage, ChatSessionSummary } from '../../../shared/electron-api'
import type { AiMessage } from '../components/AiPanel'

function describeAiError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const wrapped = /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?([\s\S]*)$/
  const match = wrapped.exec(raw)
  return (match ? match[1] : raw).trim() || 'The request failed.'
}

/**
 * How much of the open file rides along with an AI question.
 *
 * The full document used to be embedded in every request. That is a 6 MB string
 * copy per question on a large note, and a payload no provider accepts, so the
 * context is capped and the model is told the file was cut rather than left to
 * assume it saw all of it. About 200 000 characters, roughly 50k tokens.
 */
export const AI_DOC_CONTEXT_LIMIT = 200_000

export function documentContextFor(content: string): { text: string; note: string } {
  if (content.length <= AI_DOC_CONTEXT_LIMIT) return { text: content, note: '' }
  let cut = AI_DOC_CONTEXT_LIMIT
  // Never end on half a surrogate pair: a lone surrogate in a request is
  // invalid UTF-16 and some providers reject the whole payload over it.
  const next = content.charCodeAt(cut)
  if (next >= 0xdc00 && next <= 0xdfff) cut -= 1
  const kept = content.slice(0, cut)
  const totalMb = Math.round(content.length / (1024 * 1024))
  return {
    text: kept,
    note: `Only the first ${Math.round(cut / 1024)} KB of this ${totalMb} MB file are shown below.\n\n`
  }
}

interface DocumentContext {
  path(): string | null
  content(): string
  closeHistory(): void
  replace(content: string, path: string | null): Promise<boolean>
}

/** Session and stream ownership is independent of CodeMirror and workspace layout. */
export class AiSessionController implements ReactiveController {
  constructor(
    private host: ReactiveControllerHost,
    private context: DocumentContext
  ) {
    host.addController(this)
  }
  hostDisconnected(): void {
    this.loadRevision++
  }
  private loadRevision = 0
  private settingsStore = SettingsStore.getInstance()
  private get filePath(): string | null {
    return this.context.path()
  }
  private get content(): string {
    return this.context.content()
  }
  private set aiHistoryOpen(_value: boolean) {
    this.context.closeHistory()
  }
  private get aiModel(): string {
    return this.settingsStore.get('ai.model', '')
  }
  private applyAiReplacement(content: string, path: string | null): Promise<boolean> {
    return this.context.replace(content, path)
  }
  private aiMemorySessions = new Map<
    string,
    { messages: AiMessage[]; isLoading: boolean; streamIndex: number; docPath: string | null }
  >()
  private tabActiveAiSessions = new Map<string, string>()
  private _isAiConfigured: boolean = false
  get isAiConfigured(): boolean {
    return this._isAiConfigured
  }
  set isAiConfigured(value: boolean) {
    this._isAiConfigured = value
    this.host.requestUpdate()
  }
  private _aiMessages: AiMessage[] = []
  get aiMessages(): AiMessage[] {
    return this._aiMessages
  }
  set aiMessages(value: AiMessage[]) {
    this._aiMessages = value
    this.host.requestUpdate()
  }
  private _aiIsLoading: boolean = false
  get aiIsLoading(): boolean {
    return this._aiIsLoading
  }
  set aiIsLoading(value: boolean) {
    this._aiIsLoading = value
    this.host.requestUpdate()
  }
  private _aiSessionId: string | null = null
  get aiSessionId(): string | null {
    return this._aiSessionId
  }
  set aiSessionId(value: string | null) {
    this._aiSessionId = value
    this.host.requestUpdate()
  }
  private _aiSessions: ChatSessionSummary[] = []
  get aiSessions(): ChatSessionSummary[] {
    return this._aiSessions
  }
  set aiSessions(value: ChatSessionSummary[]) {
    this._aiSessions = value
    this.host.requestUpdate()
  }
  private _aiAttachments: AttachedFile[] = []
  get aiAttachments(): AttachedFile[] {
    return this._aiAttachments
  }
  set aiAttachments(value: AttachedFile[]) {
    this._aiAttachments = value
    this.host.requestUpdate()
  }
  private _aiAttaching: boolean = false
  get aiAttaching(): boolean {
    return this._aiAttaching
  }
  set aiAttaching(value: boolean) {
    this._aiAttaching = value
    this.host.requestUpdate()
  }
  private _aiModels: string[] = []
  get aiModels(): string[] {
    return this._aiModels
  }
  set aiModels(value: string[]) {
    this._aiModels = value
    this.host.requestUpdate()
  }
  private _aiModelsLoading: boolean = false
  get aiModelsLoading(): boolean {
    return this._aiModelsLoading
  }
  set aiModelsLoading(value: boolean) {
    this._aiModelsLoading = value
    this.host.requestUpdate()
  }
  private _aiStreamIndex: number = -1
  get aiStreamIndex(): number {
    return this._aiStreamIndex
  }
  set aiStreamIndex(value: number) {
    this._aiStreamIndex = value
    this.host.requestUpdate()
  }
  public async refreshAiModels(): Promise<void> {
    const electron = api()
    if (!electron?.net) return
    this.aiModelsLoading = true
    const configuredModel = this.aiModel
    try {
      const provider = this.settingsStore?.get('ai.provider', 'OpenAI') ?? 'OpenAI'
      const models = await electron.net.fetchModels(provider, '')
      // A selected model stays usable even if a provider omits it from its
      // discoverable list. The chat request is the authority on whether it is
      // actually available to this key.
      this.aiModels = configuredModel
        ? [configuredModel, ...models.filter((model) => model !== configuredModel)]
        : models
    } catch (e) {
      // A failed discovery request must not make an already selected model look
      // unavailable. Sending remains possible and surfaces the provider's real
      // error if the key, model, or network is the underlying problem.
      console.error('Failed to fetch AI models:', e)
      this.aiModels = configuredModel ? [configuredModel] : []
    } finally {
      this.aiModelsLoading = false
    }
  }

  /** Switch model from the composer chip. Persisted, so it survives a restart. */
  public handleAiModelChange = (e: Event): void => {
    const model = (e as CustomEvent<{ model: string }>).detail.model
    if (!model || model === this.aiModel) return
    void this.settingsStore?.set('ai.model', model)
  }

  /**
   * Attach files to the next prompt.
   *
   * The dialog runs here rather than in the panel because it is what registers
   * each chosen path with the main process, and the reads have to follow that
   * registration. One failing file is reported and the rest still attach: a
   * user picking six screenshots does not want all six lost to one bad path.
   */
  public handleAiAttachRequest = async (): Promise<void> => {
    const electron = api()
    if (!electron?.dialog || !electron.file?.readAttachment) return
    let picked: Electron.OpenDialogReturnValue
    try {
      picked = await electron.dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'Notes and text',
            extensions: ['md', 'markdown', 'txt', 'csv', 'json', 'yaml', 'yml']
          },
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
    } catch (e) {
      console.error('Failed to open attach dialog:', e)
      return
    }
    if (picked.canceled || picked.filePaths.length === 0) return

    this.aiAttaching = true
    const added: AttachedFile[] = []
    for (const path of picked.filePaths) {
      try {
        added.push(await electron.file.readAttachment(path))
      } catch (e) {
        // Surfaced as an assistant line rather than a dialog: the user is
        // looking at the transcript, and the reason belongs next to the prompt
        // it was meant for.
        const reason = e instanceof Error ? e.message : String(e)
        this.aiMessages = [
          ...this.aiMessages,
          { role: 'assistant', content: `Could not attach that file: ${reason}` }
        ]
      }
    }
    this.aiAttachments = [...this.aiAttachments, ...added]
    this.aiAttaching = false
  }

  /**
   * Files dropped on the composer: register the paths (the dialog would have),
   * then read them through the same guard-checked bridge the picker uses.
   */
  public handleAiAttachFiles = async (e: Event): Promise<void> => {
    const electron = api()
    if (!electron?.file?.readAttachment || !electron.file.registerDroppedPaths) return
    const { paths } = (e as CustomEvent<{ paths: string[] }>).detail
    if (!paths?.length) return
    try {
      await electron.file.registerDroppedPaths(paths)
    } catch (err) {
      console.error('Failed to register dropped paths:', err)
    }
    this.aiAttaching = true
    const added: AttachedFile[] = []
    for (const path of paths) {
      try {
        added.push(await electron.file.readAttachment(path))
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        this.aiMessages = [
          ...this.aiMessages,
          { role: 'assistant', content: `Could not attach that file: ${reason}` }
        ]
      }
    }
    this.aiAttachments = [...this.aiAttachments, ...added]
    this.aiAttaching = false
  }

  public handleAiAttachRemove = (e: Event): void => {
    const path = (e as CustomEvent<{ path: string }>).detail.path
    this.aiAttachments = this.aiAttachments.filter((f) => f.path !== path)
  }

  /** Stop the reply in flight. The partial answer is kept by the main process. */
  public handleAiCancel = (): void => {
    void api()?.net?.cancelChat?.(this.aiSessionId ?? undefined)
  }

  public handleAiClear = (): void => {
    this.aiMessages = []
    if (this.aiSessionId) {
      const mem = this.aiMemorySessions.get(this.aiSessionId)
      if (mem) {
        mem.messages = []
        mem.streamIndex = -1
      }
    }
    // Clearing empties the transcript; starting a new chat is what mints a new
    // session, so the current id is kept.
    void this.persistAiSession()
  }

  public checkAiConfigured(): void {
    if (!this.settingsStore) return
    const provider = this.settingsStore.get<string>('ai.provider', 'OpenAI')
    // The plaintext key never reaches the renderer; the main process reports
    // whether one is stored.
    const keySet = this.settingsStore.get<boolean>('ai.apiKeySet', false)
    this.isAiConfigured = provider === 'Ollama' || provider === 'OpenCode' || keySet
  }

  /** Toggle keyless web-search grounding from the composer globe button. */
  public handleAiWebSearchToggle = (): void => {
    if (!this.settingsStore) return
    const current = this.settingsStore.get<boolean>('ai.webSearchEnabled', false)
    void this.settingsStore.set('ai.webSearchEnabled', !current)
  }

  /**
   * Persist the live session. Called after every exchange rather than on a
   * timer, so a quit mid-conversation does not lose the last reply.
   */
  public async persistAiSession(
    targetSessionId?: string,
    targetDocPath?: string | null
  ): Promise<void> {
    const chat = api()?.chat
    const sid = targetSessionId || this.aiSessionId
    if (!chat || !sid) return

    const mem = this.aiMemorySessions.get(sid)
    const messages = sid === this.aiSessionId ? this.aiMessages : mem?.messages || []
    const docPath =
      targetDocPath !== undefined
        ? targetDocPath
        : sid === this.aiSessionId
          ? this.filePath
          : (mem?.docPath ?? null)

    try {
      await chat.saveSession({
        id: sid,
        // Main derives the title from the first user message; empty is fine.
        title: '',
        docPath,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        // `streaming` is a live-render flag, not part of the conversation. The
        // settle handler persists while a reply is still arriving, and a session
        // file with it would replay the reveal animation on load.
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          filePath: m.filePath,
          elapsed: m.elapsed,
          // Names only. The bytes were never in `aiMessages` to begin with,
          // which is what keeps a session with screenshots from being enormous.
          attachments: m.attachments
        }))
      })
    } catch (e) {
      console.error('Failed to save chat session:', e)
    }
  }

  public stashAiSessionForPath(path: string | null): void {
    if (!this.aiSessionId) return
    const key = path || 'Untitled'
    this.tabActiveAiSessions.set(key, this.aiSessionId)
    this.aiMemorySessions.set(this.aiSessionId, {
      messages: this.aiMessages,
      isLoading: this.aiIsLoading,
      streamIndex: this.aiStreamIndex,
      docPath: path
    })
  }

  /** Restore or load session for the active tab path. */
  public async loadAiSession(path?: string | null): Promise<void> {
    const revision = ++this.loadRevision
    const chat = api()?.chat
    if (!chat) return

    const targetPath = path !== undefined ? path : this.filePath
    const key = targetPath || 'Untitled'

    // 1. Check if this tab has an active session tracked in memory
    const existingActiveId = this.tabActiveAiSessions.get(key)
    if (existingActiveId) {
      const cached = this.aiMemorySessions.get(existingActiveId)
      if (cached) {
        this.aiSessionId = existingActiveId
        this.aiMessages = cached.messages
        this.aiIsLoading = cached.isLoading
        this.aiStreamIndex = cached.streamIndex
        await this.refreshAiSessions(targetPath)
        return
      }
    }

    // 2. Otherwise check if any in-memory session was created for this path
    for (const [sid, mem] of this.aiMemorySessions.entries()) {
      if (mem.docPath === targetPath) {
        this.tabActiveAiSessions.set(key, sid)
        this.aiSessionId = sid
        this.aiMessages = mem.messages
        this.aiIsLoading = mem.isLoading
        this.aiStreamIndex = mem.streamIndex
        await this.refreshAiSessions(targetPath)
        return
      }
    }

    // 3. Otherwise query disk for existing saved sessions
    try {
      const existing = await chat.listSessions(targetPath)
      if (revision !== this.loadRevision || targetPath !== this.filePath) return
      this.aiSessions = existing
      if (existing.length === 0) {
        this.aiSessionId = null
        this.aiMessages = []
        this.aiIsLoading = false
        this.aiStreamIndex = -1
        return
      }

      const nextId = existing[0].id
      this.tabActiveAiSessions.set(key, nextId)
      const cached = this.aiMemorySessions.get(nextId)
      if (cached) {
        this.aiSessionId = nextId
        this.aiMessages = cached.messages
        this.aiIsLoading = cached.isLoading
        this.aiStreamIndex = cached.streamIndex
        return
      }

      const full = await chat.loadSession(nextId)
      if (revision !== this.loadRevision || targetPath !== this.filePath) return
      this.aiSessionId = nextId
      this.aiMessages = full ? (full.messages as AiMessage[]) : []
      this.aiIsLoading = false
      this.aiStreamIndex = -1
    } catch (e) {
      console.error('Failed to load chat session:', e)
    }
  }

  public async refreshAiSessions(path?: string | null): Promise<void> {
    const chat = api()?.chat
    if (!chat) return
    const targetPath = path !== undefined ? path : this.filePath
    try {
      const sessions = await chat.listSessions(targetPath)
      if (targetPath === this.filePath) this.aiSessions = sessions
    } catch (e) {
      console.error('Failed to list chat sessions:', e)
    }
  }

  public handleAiNewSession = (): void => {
    const chat = api()?.chat
    if (!chat) return
    this.aiHistoryOpen = false
    const path = this.filePath
    const revision = ++this.loadRevision
    void (async () => {
      try {
        const currentPath = this.filePath || 'Untitled'
        this.stashAiSessionForPath(this.filePath)
        const session = await chat.createSession(this.filePath)
        if (revision !== this.loadRevision || path !== this.filePath) return
        this.aiSessionId = session.id
        this.tabActiveAiSessions.set(currentPath, session.id)
        this.aiMessages = []
        this.aiIsLoading = false
        this.aiStreamIndex = -1
        this.aiMemorySessions.set(session.id, {
          messages: [],
          isLoading: false,
          streamIndex: -1,
          docPath: this.filePath
        })
        await this.refreshAiSessions()
      } catch (e) {
        console.error('Failed to create chat session:', e)
      }
    })()
  }

  public handleAiSelectSession = (id: string): void => {
    this.aiHistoryOpen = false
    const chat = api()?.chat
    if (!id || !chat) return
    const path = this.filePath
    const revision = ++this.loadRevision
    void (async () => {
      try {
        const currentPath = this.filePath || 'Untitled'
        this.stashAiSessionForPath(this.filePath)
        this.tabActiveAiSessions.set(currentPath, id)

        const cached = this.aiMemorySessions.get(id)
        if (cached) {
          this.aiSessionId = id
          this.aiMessages = cached.messages
          this.aiIsLoading = cached.isLoading
          this.aiStreamIndex = cached.streamIndex
          return
        }

        const session = await chat.loadSession(id)
        if (revision !== this.loadRevision || path !== this.filePath) return
        if (!session) return
        this.aiSessionId = session.id
        this.aiMessages = session.messages as AiMessage[]
        this.aiIsLoading = false
        this.aiStreamIndex = -1
      } catch (err) {
        console.error('Failed to switch chat session:', err)
      }
    })()
  }

  public async handleAiSubmit(input: string, attachments: AttachedFile[] = []): Promise<void> {
    // An attachment with no words is a real prompt, so the emptiness check is
    // on both together rather than on the text alone.
    if ((!input.trim() && attachments.length === 0) || this.aiIsLoading || !this.settingsStore) {
      return
    }

    const currentPath = this.filePath || 'Untitled'
    const documentPath = this.filePath
    const documentContent = this.content
    const electron = api()
    if (!electron) return
    this.aiIsLoading = true

    // Ensure session exists
    let sid = this.aiSessionId
    if (electron.chat && !sid) {
      try {
        const session = await electron.chat.createSession(this.filePath)
        sid = session.id
        if (documentPath !== this.filePath) return
        this.aiSessionId = session.id
      } catch (e) {
        console.error('Failed to create chat session:', e)
      }
    }
    if (!sid) {
      this.aiIsLoading = false
      return
    }
    this.tabActiveAiSessions.set(currentPath, sid)

    const promptMessages: AiMessage[] = [
      ...this.aiMessages,
      {
        role: 'user',
        content: input,
        filePath: currentPath,
        attachments: attachments.map((f) => ({ name: f.name, kind: f.kind, size: f.size }))
      }
    ]

    this.aiMessages = promptMessages
    this.aiAttachments = []
    this.aiIsLoading = true
    this.aiStreamIndex = -1

    this.aiMemorySessions.set(sid, {
      messages: promptMessages,
      isLoading: true,
      streamIndex: -1,
      docPath: this.filePath
    })

    // Immediately persist user prompt to disk so the session exists across tabs and reloads
    void this.persistAiSession(sid, currentPath)
    void this.refreshAiSessions()

    try {
      const provider = this.settingsStore.get('ai.provider', 'OpenAI')
      const model = this.settingsStore.get('ai.model', '')

      let searchContext = ''
      const webSearchOn = this.settingsStore.get('ai.webSearchEnabled', false)
      if (webSearchOn && input.trim()) {
        try {
          searchContext = (await electron.web.searchContext(input.trim())) || ''
        } catch (e) {
          console.error('Web search failed:', e)
        }
      }

      const customPrompt =
        this.settingsStore.get('ai.systemPrompt', DEFAULT_AI_SYSTEM_PROMPT) ||
        DEFAULT_AI_SYSTEM_PROMPT
      const docContext = documentContextFor(documentContent)
      const systemPrompt = `${customPrompt}

The user is currently editing the file: ${currentPath}
${docContext.note}Here is the current content of the active file:

\`\`\`markdown
${docContext.text}
\`\`\`

If the user asks questions about their file, use the above content to answer.
${searchContext}`

      const payloadMessages: ChatMessage[] = [
        { role: 'user', content: systemPrompt },
        {
          role: 'assistant',
          content: 'Understood.'
        },
        ...promptMessages
          .filter((m): m is AiMessage & { role: 'user' | 'assistant' } => m.role !== 'thinking')
          .map((m): ChatMessage => {
            if (m.role === 'user') {
              return {
                role: m.role,
                content: `[Context: The user is currently in file: ${m.filePath}]\n\n${m.content}`
              }
            }
            return { role: m.role, content: m.content }
          })
      ]

      const textFiles = attachments.filter((f) => f.kind === 'text' && f.text)
      if (textFiles.length > 0) {
        payloadMessages[payloadMessages.length - 1] = {
          ...payloadMessages[payloadMessages.length - 1],
          content: [
            payloadMessages[payloadMessages.length - 1].content,
            ...textFiles.map((f) => `\n\n[Attached file: ${f.name}]\n\`\`\`\n${f.text}\n\`\`\``)
          ].join('')
        }
      }
      const images = attachments.filter((f) => f.kind === 'image' && f.data)
      if (images.length > 0) {
        payloadMessages[payloadMessages.length - 1] = {
          ...payloadMessages[payloadMessages.length - 1],
          images: images.map((f) => ({
            data: f.data as string,
            mediaType: f.mediaType ?? 'image/png',
            name: f.name
          }))
        }
      }

      const targetSessionId = sid
      const response = await electron.net.chatStream(
        provider,
        model,
        '',
        payloadMessages,
        (delta: string) => this.appendAiDeltaToSession(targetSessionId, delta),
        '',
        targetSessionId
      )

      const replaceRegex = /```writemd-replace\s*\n([\s\S]*?)```/
      const match = response.match(replaceRegex)

      if (match) {
        const applied = await this.applyAiReplacement(match[1], currentPath)
        const cleaned = response.replace(replaceRegex, '').trim()
        const note = applied
          ? cleaned || 'I have updated the document.'
          : 'I left your document alone: you switched tabs before the reply arrived. Ask again with that file active.'
        if (!this.settleAiStreamForSession(targetSessionId, note)) {
          this.appendAssistantMessageToSession(targetSessionId, note)
        }
      } else if (!this.settleAiStreamForSession(targetSessionId, response)) {
        this.appendAssistantMessageToSession(targetSessionId, response)
      }
      await this.persistAiSession(targetSessionId, currentPath)
      await this.refreshAiSessions()
    } catch (e) {
      const targetSessionId = sid
      const mem = this.aiMemorySessions.get(targetSessionId)
      const streamIdx = mem
        ? mem.streamIndex
        : targetSessionId === this.aiSessionId
          ? this.aiStreamIndex
          : -1
      const list = mem ? mem.messages : targetSessionId === this.aiSessionId ? this.aiMessages : []
      const partial = streamIdx >= 0 ? list[streamIdx]?.content : ''
      if (partial) this.settleAiStreamForSession(targetSessionId, partial)
      this.appendAssistantMessageToSession(targetSessionId, `Error: ${describeAiError(e)}`)
      await this.persistAiSession(targetSessionId, currentPath)
    } finally {
      const targetSessionId = sid
      const mem = this.aiMemorySessions.get(targetSessionId)
      if (mem) {
        mem.isLoading = false
        mem.streamIndex = -1
      }
      if (this.aiSessionId === targetSessionId) {
        this.aiIsLoading = false
        this.aiStreamIndex = -1
      }
    }
  }

  /**
   * Add one streamed delta to the reply of target session, creating the placeholder on first chunk.
   */
  public appendAiDeltaToSession(sessionId: string, delta: string): void {
    let mem = this.aiMemorySessions.get(sessionId)
    if (!mem) {
      mem = {
        messages: sessionId === this.aiSessionId ? this.aiMessages : [],
        isLoading: true,
        streamIndex: -1,
        docPath: this.filePath
      }
      this.aiMemorySessions.set(sessionId, mem)
    }

    const i = mem.streamIndex
    if (i === -1 || !mem.messages[i]) {
      mem.messages = [...mem.messages, { role: 'assistant', content: delta, streaming: true }]
      mem.streamIndex = mem.messages.length - 1
    } else {
      const next = [...mem.messages]
      next[i] = { ...next[i], content: next[i].content + delta }
      mem.messages = next
    }

    if (this.aiSessionId === sessionId) {
      this.aiMessages = mem.messages
      this.aiStreamIndex = mem.streamIndex
    }
  }

  /**
   * Replace the streaming placeholder with its finished text and stop the reveal for a session.
   */
  public settleAiStreamForSession(sessionId: string, content: string): boolean {
    const mem = this.aiMemorySessions.get(sessionId)
    if (!mem) return false
    const i = mem.streamIndex
    mem.streamIndex = -1
    if (i === -1 || !mem.messages[i]) return false
    const next = [...mem.messages]
    next[i] = { ...next[i], content, streaming: false }
    mem.messages = next

    if (this.aiSessionId === sessionId) {
      this.aiMessages = next
      this.aiStreamIndex = -1
    }
    return true
  }

  public appendAssistantMessageToSession(sessionId: string, content: string): void {
    const mem = this.aiMemorySessions.get(sessionId)
    if (mem) {
      mem.messages = [...mem.messages, { role: 'assistant', content }]
      if (this.aiSessionId === sessionId) {
        this.aiMessages = mem.messages
      }
    } else if (this.aiSessionId === sessionId) {
      this.aiMessages = [...this.aiMessages, { role: 'assistant', content }]
    }
  }

  /**
   * Apply an AI-provided document replacement and force-save it to disk.
   * Returns false when the target document is no longer the active one.
   */
  public handleThoughtSettle = (e: Event): void => {
    const { tenths } = (e as CustomEvent<{ tenths: number }>).detail ?? { tenths: 0 }
    this.aiMessages = [
      ...this.aiMessages,
      { role: 'thinking', content: 'Thinking', elapsed: tenths }
    ]
    if (this.aiSessionId) {
      const mem = this.aiMemorySessions.get(this.aiSessionId)
      if (mem) {
        mem.messages = this.aiMessages
      }
    }
    void this.persistAiSession()
  }
}
