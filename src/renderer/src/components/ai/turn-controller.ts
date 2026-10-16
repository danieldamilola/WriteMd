import { makeSessionId } from '../../../../shared/ai/sessions'
import { aiBridge } from './types'
import type {
  AiEvent,
  AiSendInput,
  ChangeView,
  PreviewChangeView,
  SessionView,
  SkippedView
} from './types'

/**
 * One exchange with the assistant, as the transcript shows it.
 *
 * The dock renders `role: 'user'` text as plain text and `role: 'assistant'`
 * text as Markdown, which is why the role is here rather than being implied by
 * position: a turn that failed still has an assistant message, and it reads
 * wrong as a user message.
 */
export interface TurnMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
}

/** Edits the model proposed, before anything was written. */
export interface ProposalView {
  files: string[]
  blocks: number
  skipped: string[]
}

export interface TurnState {
  status: string | null
  sessionId: string
  messages: TurnMessage[]
  /** Authoritative reply, separate from provisional streamed edit blocks. */
  reply: string | null
  busy: boolean
  error: string | null
  proposal: ProposalView | null
  /** Files written this session, each undoable on its own. */
  changes: ChangeView[]
  previews: PreviewChangeView[]
  /** Files the model named and the applier declined to touch. */
  skipped: SkippedView[]
}

function initialState(): TurnState {
  return {
    status: null,
    sessionId: makeSessionId(),
    messages: [],
    reply: null,
    busy: false,
    error: null,
    proposal: null,
    changes: [],
    previews: [],
    skipped: []
  }
}

function newId(): string {
  // The shared helper is the same shape and already falls back for a renderer
  // with no WebCrypto, which is what an insecure origin would be.
  const source = globalThis.crypto
  return typeof source?.randomUUID === 'function' ? source.randomUUID() : makeSessionId()
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Turn state and the stream behind it, with no Lit in it.
 *
 * The controller owns three things the panel must not each reinvent: which
 * request is live, what its output has accumulated into, and when the
 * conversation is worth writing to disk.
 *
 * The stale-stream guard is the reason this is a class rather than a few
 * booleans on the dock. Cancel does not stop the provider instantly - the abort
 * has to travel to main and the socket has to close - and the user can send the
 * next message immediately. When the old stream's last deltas arrive they carry
 * the old `requestId`, and every handler here drops them before they reach a
 * message. Without that check the tail of a cancelled answer is prepended to the
 * next one, which is the kind of bug nobody reports and everybody sees.
 */
export class TurnController {
  private listeners = new Set<(state: TurnState) => void>()
  private unsubscribe: (() => void) | null = null
  private state: TurnState = initialState()
  private activeRequestId: string | null = null
  /** The request whose session has already been written, so `done` after `error` is free. */

  constructor() {
    this.ensureSubscribed()
  }

  connect(): void {
    this.ensureSubscribed()
  }

  getState(): Readonly<TurnState> {
    return this.state
  }

  get sessionId(): string {
    return this.state.sessionId
  }

  get requestId(): string | null {
    return this.activeRequestId
  }

  subscribe(listener: (state: TurnState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * One subscription for the lifetime of the controller.
   *
   * A new one per turn would leave the previous listener registered whenever
   * the bridge handed back an unsubscribe that the controller forgot to call,
   * and every delta would then be applied once per stale listener.
   */
  private ensureSubscribed(): void {
    if (this.unsubscribe) return
    const bridge = aiBridge()
    if (!bridge?.onEvent) return
    this.unsubscribe = bridge.onEvent(this.handleEvent)
  }

  /** Begin a turn. The caller's text is echoed into the transcript immediately. */
  async start(input: AiSendInput): Promise<void> {
    const bridge = aiBridge()
    if (!bridge?.send) {
      this.patch({ error: 'The assistant is unavailable in this build.' })
      return
    }
    this.ensureSubscribed()
    this.cancel()
    const requestId = newId()
    const now = Date.now()
    // A second turn while one is streaming would interleave two transcripts, so
    // the older request is abandoned here rather than being allowed to finish.
    this.activeRequestId = requestId
    const sessionId = input.sessionId || this.state.sessionId

    this.patch({
      sessionId,
      messages: [
        ...this.state.messages,
        { id: `${requestId}:user`, role: 'user', text: input.userText, createdAt: now },
        { id: `${requestId}:assistant`, role: 'assistant', text: '', createdAt: now }
      ],
      busy: true,
      reply: null,
      error: null,
      proposal: null,
      previews: []
    })
    try {
      await bridge.send(requestId, { ...input, sessionId })
    } catch (err) {
      // The send itself failing means no event will ever arrive for this id, so
      // it has to settle here or the composer stays disabled for good.
      this.settle(requestId, describe(err))
    }
  }

  /**
   * Stop the live turn.
   *
   * The turn is marked settled locally rather than waiting for `done`, because
   * the user pressed stop and a composer that stays disabled until a socket
   * notices the abort reads as a hang. The trailing events are ignored rather
   * than applied, since the request id is no longer active.
   */
  cancel(): void {
    const requestId = this.activeRequestId
    if (!requestId) return
    this.activeRequestId = null
    this.patch({ busy: false, status: null })
    void aiBridge()
      ?.cancel?.(requestId)
      .catch(() => undefined)
    void this.persist()
  }

  /** Drop the transcript and start a new conversation. */
  reset(): void {
    this.cancel()
    this.state = { ...initialState(), sessionId: makeSessionId() }
    this.activeRequestId = null
    this.notify()
  }

  /** Show a conversation loaded from the session list. */
  load(session: SessionView): void {
    this.cancel()
    this.state = {
      ...initialState(),
      sessionId: session.id,
      messages: (session.messages ?? []).map((message, index) => ({
        id: `${session.id}:saved:${index}`,
        role: message.role,
        text: message.content,
        createdAt: session.createdAt
      })),
      reply:
        session.messages?.filter((message) => message.role === 'assistant').at(-1)?.content ?? null,
      changes: [],
      skipped: []
    }
    this.activeRequestId = null
    this.notify()
  }

  /** Changes already on disk for a conversation, for reopening the undo list. */
  adoptChanges(changes: ChangeView[], sessionId = this.state.sessionId): void {
    if (sessionId !== this.state.sessionId) return
    this.patch({ changes })
  }

  acceptPreview(preview: PreviewChangeView, change: ChangeView | null): void {
    const previews = this.state.previews.filter((entry) =>
      preview.previewId ? entry.previewId !== preview.previewId : entry !== preview
    )
    this.patch({
      previews,
      changes: change ? [...this.state.changes, change] : this.state.changes
    })
    if (
      previews.length === 0 &&
      (!this.state.reply || this.state.reply === 'Review the suggested change before accepting it.')
    ) {
      this.setAnswer('Applied the requested change.')
    }
  }

  discardPreviews(): void {
    this.patch({ previews: [] })
  }

  private handleEvent = (event: AiEvent): void => {
    if (event.requestId !== this.activeRequestId) return
    switch (event.type) {
      case 'status':
        this.setAnswer('')
        this.patch({ status: event.message })
        return
      case 'text':
        this.patch({ status: null })
        this.appendDelta(event.delta)
        return
      case 'proposal':
        this.patch({
          proposal: {
            files: event.files,
            blocks: event.blocks,
            skipped: event.skipped
          }
        })
        return
      case 'applied':
        this.patch({
          changes: [...this.state.changes, ...event.changed],
          skipped: [...this.state.skipped, ...event.skipped]
        })
        return
      case 'preview':
        this.patch({ previews: event.changes, skipped: event.skipped })
        return
      case 'answer':
        this.setAnswer(event.text)
        return
      case 'error':
        this.settle(event.requestId, event.message)
        return
      case 'done':
        // `done` carries the authoritative text. Replace what streamed rather
        // than appending: when the model edited files, what streamed was the
        // protocol, and the real reply is the sentence around it.
        if (event.text !== undefined) this.setAnswer(event.text)
        this.settle(event.requestId, null)
        return
    }
  }

  private appendDelta(delta: string): void {
    const message = this.activeMessage()
    if (message.role !== 'assistant') return
    const messages = [...this.state.messages]
    const index = messages.findIndex((m) => m.id === message.id)
    messages[index] = { ...message, text: message.text + delta }
    this.patch({ messages })
  }

  private activeMessage(): TurnMessage {
    return (
      this.state.messages[this.state.messages.length - 1] ?? {
        id: '',
        role: 'assistant',
        text: '',
        createdAt: 0
      }
    )
  }

  /** End the turn: idle, with the error if there was one, then save once. */
  private settle(requestId: string, error: string | null): void {
    if (requestId !== this.activeRequestId) return
    this.activeRequestId = null
    this.patch({ busy: false, error, status: null })
    void this.persist()
  }

  /**
   * Nothing to do, deliberately: main writes the session.
   *
   * This used to save from here too, which meant two writers on one JSON file.
   * The session holds the full transcript and only main knows a turn's
   * authoritative text - the renderer holds a provisional copy until `done` - so
   * a renderer write was both a race and a source of truncated history. The id
   * still comes from here, because main creates the session under the id the
   * renderer chose.
   */
  private async persist(): Promise<void> {
    /* intentionally empty */
  }

  /** The answer arrived whole because nothing streamed. */
  private setAnswer(text: string): void {
    const messages = [...this.state.messages]
    const index = messages.length - 1
    if (index >= 0 && messages[index].role === 'assistant') {
      messages[index] = { ...messages[index], text }
      this.patch({ messages, reply: text })
    }
  }

  private patch(next: Partial<TurnState>): void {
    this.state = { ...this.state, ...next }
    this.notify()
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(this.state)
      } catch (err) {
        console.error('AI turn listener threw:', err)
      }
    }
  }

  dispose(): void {
    this.cancel()
    this.unsubscribe?.()
    this.unsubscribe = null
    this.listeners.clear()
  }
}
