import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../src/renderer/src/components/ai/QuickAi'
import { QuickAi } from '../src/renderer/src/components/ai/QuickAi'
import { SettingsStore } from '../src/renderer/src/state/settings'
import { takeAiHandoff } from '../src/renderer/src/components/ai/handoff'
import type { AiSendInput, PreviewChangeView } from '../src/shared/electron-api'
import { ChatgptState } from '../src/renderer/src/state/chatgpt'
import type { ChatgptAuthView } from '../src/shared/ai/chatgpt'

const CONNECTED: ChatgptAuthView = {
  connected: true,
  pending: false,
  activeId: 'client-1',
  accounts: [{ id: 'client-1', label: 'ChatGPT account' }],
  error: null,
  sessionOnly: false,
  needsWelcome: false
}

type Api = NonNullable<Window['electronAPI']>

/**
 * The floating command bar.
 *
 * Two things are load-bearing and neither is visible in jsdom, so they are
 * pinned here as behaviour rather than as pixels: the bar must never render
 * streamed deltas, and Accept must stay refused once the note has moved on.
 * Geometry is checked in Electron, where there is a real layout.
 */

interface Listener {
  (event: { requestId: string } & Record<string, unknown>): void
}

const listeners = new Set<Listener>()
const sent: Array<{ id: string; input: AiSendInput }> = []
let cancelled: string[] = []

/**
 * The composer refuses to send while AI is unconfigured, and says so in the bar.
 * Every test here is about behaviour after the assistant is set up, so it is set
 * up here rather than repeated in each one.
 */
async function enableAi(): Promise<void> {
  const settings = SettingsStore.getInstance()
  await settings.init().catch(() => undefined)
  settings.setMany(
    {
      'ai.enabled': true,
      'ai.providerId': 'ollama',
      'ai.apiKeySet': false,
      'ai.model': 'mock-model'
    },
    false
  )
}

function installBridge(): void {
  listeners.clear()
  sent.length = 0
  cancelled = []
  ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
    ai: {
      send: async (id: string, input: AiSendInput): Promise<unknown> => {
        sent.push({ id, input })
        return null
      },
      cancel: async (id: string): Promise<void> => {
        cancelled.push(id)
      },
      onEvent: (cb: Listener): (() => void) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      }
    }
  } as unknown as Api
}

function emit(event: Record<string, unknown>): void {
  for (const listener of listeners) listener(event as { requestId: string })
}

async function settle(el: QuickAi): Promise<void> {
  await el.updateComplete
  await new Promise((resolve) => setTimeout(resolve, 0))
  await el.updateComplete
}

async function mount(context?: QuickAi['context']): Promise<QuickAi> {
  const el = document.createElement('writemd-ai-quick') as QuickAi
  if (context) el.context = context
  document.body.appendChild(el)
  await settle(el)
  return el
}

/** The prompt, which lives in the composer's shadow root rather than the bar's. */
function prompt(el: QuickAi): HTMLTextAreaElement {
  const composer = el.shadowRoot!.querySelector('writemd-ai-composer')!
  return composer.shadowRoot!.querySelector('textarea')!
}

/** A button by accessible name, across the bar and its composer's shadow roots. */
function button(el: QuickAi, name: string): HTMLButtonElement {
  const all = [
    ...Array.from(el.shadowRoot!.querySelectorAll('button')),
    ...Array.from(
      el.shadowRoot!.querySelector('writemd-ai-composer')!.shadowRoot!.querySelectorAll('button')
    )
  ]
  const found = all.find((b) => b.getAttribute('aria-label') === name)
  if (!found) throw new Error(`No button labelled "${name}"`)
  return found
}

/** A suggested edit's controls, which the card labels by class rather than by name. */
function control(el: QuickAi, selector: string): HTMLButtonElement {
  const found = el.shadowRoot!.querySelector<HTMLButtonElement>(selector)
  if (!found) throw new Error(`No suggestion control matching "${selector}"`)
  return found
}

async function ask(el: QuickAi, text: string): Promise<string> {
  const textarea = prompt(el)
  textarea.value = text
  textarea.setSelectionRange(text.length, text.length)
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }))
  await settle(el)
  textarea.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  )
  await settle(el)
  return sent[sent.length - 1]?.id ?? ''
}

/** Put the bar past its idle state, so the handoff link is on screen. */
async function withOutput(el: QuickAi): Promise<void> {
  const id = await ask(el, 'something')
  emit({ requestId: id, type: 'answer', text: 'An answer.' })
  emit({ requestId: id, type: 'done' })
  await settle(el)
}

describe('quick AI bar', () => {
  it('hides the ChatGPT plan notice once the bar has run a turn', async () => {
    const settings = SettingsStore.getInstance()
    const chatgpt = ChatgptState.getInstance()
    const previousProvider = settings.get<string>('ai.providerId', '')
    settings.set('ai.providerId', 'chatgpt')
    chatgpt.apply(CONNECTED)
    try {
      const el = await mount({ path: 'C:/vault/Note.md', content: 'Old', selection: null })
      const composer = el.shadowRoot!.querySelector('writemd-ai-composer')!
      expect(composer.shadowRoot!.querySelector('.plan-status')).not.toBeNull()

      await withOutput(el)
      expect(composer.shadowRoot!.querySelector('.plan-status')).toBeNull()

      // Not reset by the next send. The reply text is, so tracking that instead
      // would bring the card back between turns in the same bar.
      await withOutput(el)
      expect(composer.shadowRoot!.querySelector('.plan-status')).toBeNull()
    } finally {
      chatgpt.apply({
        connected: false,
        pending: false,
        activeId: null,
        accounts: [],
        error: null,
        sessionOnly: false,
        needsWelcome: false
      })
      settings.set('ai.providerId', previousProvider)
    }
  })

  it('auto-accepts completed suggestions one at a time without dismissing the bar', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Old', selection: null })
    el.autoAcceptEdits = true
    const accepted: string[] = []
    el.addEventListener('quick-ai-accept', (event) => {
      const change = (event as CustomEvent).detail.change
      accepted.push(change.previewId)
    })
    const id = await ask(el, 'edit both notes')
    const first = {
      previewId: 'first',
      path: 'C:/vault/Note.md',
      original: 'Old',
      content: 'New',
      kind: 'modified'
    }
    const second = { ...first, previewId: 'second', path: 'C:/vault/Other.md' }
    emit({ requestId: id, type: 'preview', changes: [first, second], skipped: [] })
    await settle(el)
    expect(accepted).toEqual([])
    emit({ requestId: id, type: 'done' })
    await settle(el)
    expect(accepted).toEqual(['first'])
    el.requestUpdate()
    await settle(el)
    expect(accepted).toEqual(['first'])
    el.reportApplySuccess(first as Parameters<QuickAi['reportApplySuccess']>[0], null)
    await settle(el)
    expect(accepted).toEqual(['first', 'second'])
    el.reportApplySuccess(second as Parameters<QuickAi['reportApplySuccess']>[0], null)
    await settle(el)
    expect(el.isConnected).toBe(true)
    expect(el.shadowRoot!.querySelectorAll('.suggestion')).toHaveLength(0)
  })

  it('shows failed auto-acceptance without retrying on subsequent renders', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Old', selection: null })
    el.autoAcceptEdits = true
    let attempts = 0
    el.addEventListener('quick-ai-accept', () => {
      attempts++
      el.reportApplyError('The note changed after the suggestion was made.')
    })
    const id = await ask(el, 'edit this note')
    emit({
      requestId: id,
      type: 'preview',
      changes: [
        {
          previewId: 'first',
          path: 'C:/vault/Note.md',
          original: 'Old',
          content: 'New',
          kind: 'modified'
        }
      ],
      skipped: []
    })
    emit({ requestId: id, type: 'done' })
    await settle(el)
    el.requestUpdate()
    await settle(el)
    expect(attempts).toBe(1)
    expect(el.shadowRoot!.querySelector('.error')?.textContent).toContain('note changed')
  })

  it('draws no review card in auto-accept mode, and waits for the turn to go idle', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Old', selection: null })
    el.autoAcceptEdits = true
    const accepted: string[] = []
    el.addEventListener('quick-ai-accept', (event) => {
      const change = (event as CustomEvent<{ change: PreviewChangeView }>).detail.change
      accepted.push(change.previewId ?? '')
    })
    const id = await ask(el, 'edit both notes')
    const first: PreviewChangeView = {
      previewId: 'first',
      path: 'C:/vault/Note.md',
      original: 'Old',
      content: 'New',
      kind: 'modified'
    }
    const second: PreviewChangeView = { ...first, previewId: 'second', path: 'C:/vault/Other.md' }
    emit({ requestId: id, type: 'preview', changes: [first, second], skipped: [] })
    await settle(el)
    // The card exists to ask somebody whether to keep a change. Nobody is being
    // asked here, so nothing is drawn - and the queue behind it is still full.
    expect(el.shadowRoot!.querySelector('.suggestion')).toBeNull()
    expect(el.turns.getState().previews).toHaveLength(2)
    expect(accepted).toEqual([])

    // A turn still streaming owns the disk; the queue waits for it to finish.
    emit({ requestId: id, type: 'status', message: 'Checking both notes…' })
    await settle(el)
    expect(accepted).toEqual([])

    emit({ requestId: id, type: 'done' })
    await settle(el)
    expect(accepted).toEqual(['first'])
    // The first suggestion is being written, not written yet: it stays queued
    // until the app says how the save went.
    expect(el.turns.getState().previews).toHaveLength(2)
    expect(el.shadowRoot!.querySelector('.suggestion')).toBeNull()

    // One write at a time, and no card in between to interrupt it.
    el.reportApplySuccess(first, null)
    await settle(el)
    expect(accepted).toEqual(['first', 'second'])
    expect(el.turns.getState().previews).toHaveLength(1)
    expect(el.shadowRoot!.querySelector('.suggestion')).toBeNull()

    el.reportApplySuccess(second, null)
    await settle(el)
    expect(el.turns.getState().previews).toHaveLength(0)
    expect(el.shadowRoot!.querySelector('.suggestion')).toBeNull()
  })

  beforeEach(async () => {
    installBridge()
    await enableAi()
  })
  afterEach(() => {
    document.body.innerHTML = ''
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  it('shows nothing but the prompt until the model answers', async () => {
    const el = await mount()
    expect(el.shadowRoot!.querySelector('.output')).toBeNull()
    expect(prompt(el).placeholder).toBe('Ask about the whole text, / for skills…')
  })

  it('keeps one session for follow-ups and restores the conversation when reopened', async () => {
    const first = await mount()
    const firstId = await ask(first, 'first question')
    emit({ requestId: firstId, type: 'done', text: 'First answer' })
    await settle(first)
    const secondId = await ask(first, 'follow-up')
    emit({ requestId: secondId, type: 'done', text: 'Second answer' })
    await settle(first)
    expect(sent[1].id).not.toBe(sent[0].id)
    expect(sent[1].input.sessionId).toBe(sent[0].input.sessionId)
    first.remove()
    const reopened = await mount()
    expect(reopened.shadowRoot!.querySelector('.reply')!.textContent).toContain('Second answer')
    await ask(reopened, 'continue')
    expect(sent[2].input.sessionId).toBe(sent[0].input.sessionId)
    expect(reopened.turns.getState().messages).toHaveLength(6)
  })

  it('asks about the selection when there is one', async () => {
    const el = await mount({
      path: 'C:/vault/Note.md',
      content: 'A car is red.',
      selection: { from: 2, to: 5, text: 'car' }
    })
    expect(prompt(el).placeholder).toBe('Ask about your selection, / for skills…')
  })

  it('sends the captured note, selection and open tabs', async () => {
    const el = await mount({
      path: 'C:/vault/Note.md',
      content: 'A car is red.',
      selection: { from: 2, to: 5, text: 'car' },
      openPaths: ['C:/vault/Note.md', 'C:/vault/Other.md']
    })
    await ask(el, 'make it formal')
    expect(sent).toHaveLength(1)
    expect(sent[0].input.selection).toBe('car')
    expect(sent[0].input.document).toEqual({ path: 'C:/vault/Note.md', content: 'A car is red.' })
    expect(sent[0].input.openPaths).toEqual(['C:/vault/Note.md', 'C:/vault/Other.md'])
    expect(el.shadowRoot!.querySelector('.output')).toBeNull()
  })

  it('reaches the whole vault, but still asks before writing', async () => {
    const el = await mount({
      path: 'C:/vault/Note.md',
      content: 'A car is red.',
      selection: null,
      openPaths: ['C:/vault/Note.md']
    })
    await ask(el, 'also update the other file')
    // Reviewed rather than auto-applied: the open note and the vault are both
    // in scope, and every change still arrives as something to accept.
    expect(sent[0].input.previewOnly).toBe(true)
  })

  it('names the files a turn changed', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Note.', selection: null })
    const id = await ask(el, 'rewrite both notes')
    expect(el.shadowRoot!.querySelector('.output')).toBeNull()
    emit({
      requestId: id,
      type: 'applied',
      changed: [
        { id: '1', path: 'C:/vault/Note.md', kind: 'modified', createdAt: 0, revertedAt: null },
        { id: '2', path: 'C:/vault/Other.md', kind: 'modified', createdAt: 0, revertedAt: null }
      ],
      skipped: []
    })
    await settle(el)
    const line = el.shadowRoot!.querySelector('.applied')!
    expect(line.textContent).toContain('this note')
    expect(line.textContent).toContain('Other.md')
  })

  it('never renders streamed deltas, because they carry the edit protocol', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'A car is red.', selection: null })
    const id = await ask(el, 'rewrite this')
    emit({
      requestId: id,
      type: 'text',
      delta: '<<<<<<< SEARCH\ncar\n=======\nvehicle\n>>>>>>> REPLACE'
    })
    await settle(el)
    expect(el.shadowRoot!.querySelector('.reply')).toBeNull()

    emit({ requestId: id, type: 'answer', text: 'Here is a formal rewrite.' })
    await settle(el)
    expect(el.shadowRoot!.querySelector('.reply')!.innerHTML).toContain('Here is a formal rewrite.')
    emit({ requestId: id, type: 'done' })
    await settle(el)
  })

  it('shows Thinking in the bar itself, with the stop control in the same row', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Note.', selection: null })
    await ask(el, 'hello')
    // The state replaces the prompt rather than sitting in a card above it, so
    // there is one thing to read and one control to reach.
    expect(el.shadowRoot!.querySelector('.output')).toBeNull()
    expect(prompt(el).hidden).toBe(true)
    expect(button(el, 'Stop response')).toBeTruthy()
    const waiting = el
      .shadowRoot!.querySelector('writemd-ai-composer')!
      .shadowRoot!.querySelector('.waiting')
    expect(waiting).not.toBeNull()
    expect(waiting!.textContent).toContain('Thinking')

    emit({ requestId: sent[0].id, type: 'done' })
    await settle(el)
    expect(
      el.shadowRoot!.querySelector('writemd-ai-composer')!.shadowRoot!.querySelector('.waiting')
    ).toBeNull()
    expect(prompt(el).hidden).toBe(false)
  })

  it('renders a reply as markdown rather than as raw source', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Note.', selection: null })
    const id = await ask(el, 'plan the release')
    emit({
      requestId: id,
      type: 'answer',
      text: '## Next steps\n\n- Ship the bar\n- Write the changelog'
    })
    await settle(el)
    const reply = el.shadowRoot!.querySelector('.reply')!
    expect(reply.querySelector('h2')?.textContent).toBe('Next steps')
    expect(reply.querySelectorAll('li')).toHaveLength(2)
  })

  it('offers Accept and Discard for a suggested edit and omits the stock sentence', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'A car is red.', selection: null })
    const id = await ask(el, 'swap the word')
    emit({
      requestId: id,
      type: 'preview',
      changes: [
        { path: 'C:/vault/Note.md', original: 'car', content: 'vehicle', kind: 'modified' }
      ],
      skipped: []
    })
    emit({
      requestId: id,
      type: 'answer',
      text: 'Review the suggested change before accepting it.'
    })
    emit({ requestId: id, type: 'done' })
    await settle(el)
    // The card already says it; repeating it above the button is noise.
    expect(el.shadowRoot!.querySelector('.reply')).toBeNull()
    const card = el.shadowRoot!.querySelector('.suggestion')!
    expect(card.querySelector('del')!.textContent).toBe('car')
    expect(card.querySelector('.replacement')!.textContent).toBe('vehicle')
    expect(card.querySelectorAll('button')).toHaveLength(2)
    expect(control(el, '.suggestion .accept').textContent?.trim()).toBe('Accept')
    expect(control(el, '.suggestion .discard').textContent?.trim()).toBe('Discard')

    const accepted = new Promise<CustomEvent>((resolve) =>
      el.addEventListener('quick-ai-accept', resolve as EventListener)
    )
    control(el, '.suggestion .accept').click()
    const detail = (await accepted).detail as { change: PreviewChangeView }
    expect(detail.change.content).toBe('vehicle')
    await settle(el)

    // The save is in flight. Pulling the edit out from under a write that has
    // already started would leave the file half-written, so Discard waits with
    // Accept for the app's verdict on this one.
    expect(control(el, '.suggestion .accept').disabled).toBe(true)
    expect(control(el, '.suggestion .discard').disabled).toBe(true)
    control(el, '.suggestion .discard').click()
    await settle(el)
    expect(el.shadowRoot!.querySelector('.suggestion')).not.toBeNull()

    // Once the app reports the save, the card it reported for is gone.
    el.reportApplySuccess(detail.change, null)
    await settle(el)
    expect(el.shadowRoot!.querySelector('.suggestion')).toBeNull()
  })

  it('discards a pending suggestion once nothing is being written', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'A car is red.', selection: null })
    const id = await ask(el, 'swap the word')
    emit({
      requestId: id,
      type: 'preview',
      changes: [
        {
          previewId: 'first',
          path: 'C:/vault/Note.md',
          original: 'car',
          content: 'vehicle',
          kind: 'modified'
        }
      ],
      skipped: []
    })
    emit({ requestId: id, type: 'done' })
    await settle(el)
    let accepted = 0
    el.addEventListener('quick-ai-accept', () => {
      accepted++
    })
    const card = el.shadowRoot!.querySelector('.suggestion')!
    expect(card.querySelectorAll('button')).toHaveLength(2)
    expect(control(el, '.suggestion .discard').disabled).toBe(false)
    control(el, '.suggestion .discard').click()
    await settle(el)
    // Discarding throws the suggestion away without asking the app to write it.
    expect(accepted).toBe(0)
    expect(el.turns.getState().previews).toEqual([])
    expect(el.turns.getState().changes).toEqual([])
    expect(el.shadowRoot!.querySelector('.suggestion')).toBeNull()
  })

  it('ignores an apply result for a suggestion that is not the one being written', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Old', selection: null })
    const id = await ask(el, 'edit both notes')
    const first: PreviewChangeView = {
      previewId: 'first',
      path: 'C:/vault/Note.md',
      original: 'Old',
      content: 'New',
      kind: 'modified'
    }
    const second: PreviewChangeView = { ...first, previewId: 'second', path: 'C:/vault/Other.md' }
    emit({ requestId: id, type: 'preview', changes: [first, second], skipped: [] })
    emit({ requestId: id, type: 'done' })
    await settle(el)
    control(el, '.suggestion .accept').click()
    await settle(el)
    expect(el.turns.getState().previews).toHaveLength(2)

    // A result for the other suggestion is not this one's verdict: it must not
    // clear a suggestion nobody has accepted, nor settle the write running now.
    el.reportApplySuccess(second, null)
    await settle(el)
    expect(el.turns.getState().previews).toEqual([first, second])
    expect(el.turns.getState().changes).toEqual([])
    expect(el.shadowRoot!.querySelectorAll('.suggestion')).toHaveLength(2)
    expect(control(el, '.suggestion .accept').disabled).toBe(true)

    // The result that does belong to it clears exactly one card.
    el.reportApplySuccess(first, null)
    await settle(el)
    expect(el.turns.getState().previews).toEqual([second])
    expect(el.shadowRoot!.querySelectorAll('.suggestion')).toHaveLength(1)
    expect(control(el, '.suggestion .accept').disabled).toBe(false)

    control(el, '.suggestion .accept').click()
    await settle(el)
    el.reportApplySuccess(second, null)
    await settle(el)
    expect(el.turns.getState().previews).toEqual([])
    expect(el.shadowRoot!.querySelector('.suggestion')).toBeNull()
  })

  it('ignores a delayed apply result once the conversation has moved on', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Old', selection: null })
    const id = await ask(el, 'edit this note')
    const first: PreviewChangeView = {
      previewId: 'shared',
      path: 'C:/vault/Note.md',
      original: 'Old',
      content: 'New',
      kind: 'modified'
    }
    emit({ requestId: id, type: 'preview', changes: [first], skipped: [] })
    emit({ requestId: id, type: 'done' })
    await settle(el)
    control(el, '.suggestion .accept').click()
    await settle(el)

    // Stop the write, then take another conversation - what the dock's "New chat"
    // does to the controller both surfaces share.
    button(el, 'Stop response').click()
    await settle(el)
    const session = el.turns.sessionId
    el.turns.reset()
    await settle(el)
    expect(el.turns.sessionId).not.toBe(session)

    // The next turn proposes an edit under the same id, and it is the one being
    // written now.
    const next = await ask(el, 'edit it again')
    const second: PreviewChangeView = { ...first, content: 'Newer' }
    emit({ requestId: next, type: 'preview', changes: [second], skipped: [] })
    emit({ requestId: next, type: 'done' })
    await settle(el)
    control(el, '.suggestion .accept').click()
    await settle(el)

    // The abandoned write finally lands: same id, different suggestion, older
    // session. Clearing the new card with it would drop an edit nobody has looked
    // at, and report it as written.
    el.reportApplySuccess(first, null)
    await settle(el)
    expect(el.turns.getState().previews).toEqual([second])
    expect(el.turns.getState().changes).toEqual([])
    expect(el.turns.getState().reply).toBeNull()
    expect(el.shadowRoot!.querySelectorAll('.suggestion')).toHaveLength(1)
    expect(control(el, '.suggestion .accept').disabled).toBe(true)

    el.reportApplySuccess(second, null)
    await settle(el)
    expect(el.turns.getState().previews).toEqual([])
    expect(el.shadowRoot!.querySelector('.suggestion')).toBeNull()
  })

  it('surfaces a web search step as the status beside the thinking label', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Note.', selection: null })
    const id = await ask(el, 'what is new in the spec')
    emit({ requestId: id, type: 'status', message: 'Searching the web for the spec…' })
    await settle(el)
    const composer = el.shadowRoot!.querySelector('writemd-ai-composer')!
    expect(composer.thinkingStatus).toBe('Searching the web for the spec…')
    expect(composer.shadowRoot!.querySelector('.waiting-status')!.textContent).toBe(
      'Searching the web for the spec…'
    )
  })

  it('ignores events belonging to a turn it is not running', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Note.', selection: null })
    emit({ requestId: 'someone-else', type: 'answer', text: 'Not mine.' })
    await settle(el)
    expect(el.shadowRoot!.querySelector('.reply')).toBeNull()
  })

  it('reports a failure to send and leaves the bar open to retry', async () => {
    ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
      ai: {
        send: async (): Promise<never> => {
          throw new Error('The assistant is unavailable in this build.')
        },
        cancel: async (): Promise<void> => undefined,
        onEvent: (): (() => void) => () => undefined
      }
    } as unknown as Api
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Note.', selection: null })
    await ask(el, 'hello')
    await settle(el)
    expect(el.shadowRoot!.querySelector('.error')!.textContent).toContain('unavailable')
    expect(el.shadowRoot!.querySelector('.thinking')).toBeNull()
  })

  it('cancels an in-flight turn when the bar goes away', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Note.', selection: null })
    const id = await ask(el, 'hello')
    el.remove()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(cancelled).toContain(id)
  })

  it('stops on request without closing the bar', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Note.', selection: null })
    const id = await ask(el, 'hello')
    button(el, 'Stop response').click()
    await settle(el)
    expect(cancelled).toContain(id)
    const composer = el.shadowRoot!.querySelector('writemd-ai-composer')!
    expect(composer.thinking).toBe(false)
    expect(prompt(el).hidden).toBe(false)
    expect(el.isConnected).toBe(true)
  })

  it('clears the turn and the in-flight apply on Stop, and stays usable after it', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Old', selection: null })
    const id = await ask(el, 'edit this note')
    const change: PreviewChangeView = {
      previewId: 'first',
      path: 'C:/vault/Note.md',
      original: 'Old',
      content: 'New',
      kind: 'modified'
    }
    emit({ requestId: id, type: 'preview', changes: [change], skipped: [] })
    await settle(el)
    control(el, '.suggestion .accept').click()
    await settle(el)

    // Two things hold the bar at once: the turn is still streaming, and a write
    // has already started on what it proposed.
    const composer = el.shadowRoot!.querySelector('writemd-ai-composer')!
    expect(el.turns.getState().busy).toBe(true)
    expect(composer.busy).toBe(true)
    expect(el.turns.getState().previews).toHaveLength(1)

    button(el, 'Stop response').click()
    await settle(el)
    expect(cancelled).toContain(id)
    expect(el.turns.getState().busy).toBe(false)
    // The suggestion went with the turn: nothing on screen is about to be written.
    expect(el.turns.getState().previews).toEqual([])
    expect(composer.busy).toBe(false)
    expect(composer.thinking).toBe(false)
    expect(prompt(el).hidden).toBe(false)
    expect(el.shadowRoot!.querySelector('.suggestion')).toBeNull()

    // The write the app was still holding finishes afterwards. It belongs to a
    // turn that no longer exists, so it settles nothing.
    el.reportApplySuccess(change, null)
    await settle(el)
    expect(el.turns.getState().previews).toEqual([])
    expect(el.turns.getState().changes).toEqual([])
    expect(el.shadowRoot!.querySelector('.suggestion')).toBeNull()

    // And the bar is a working composer again rather than a dead end.
    const next = await ask(el, 'start over')
    expect(next).not.toBe(id)
    expect(sent).toHaveLength(2)
    expect(sent[1].input.sessionId).toBe(sent[0].input.sessionId)
  })

  it('closes on Escape but not on a click in the document', async () => {
    const el = await mount()
    let closes = 0
    el.addEventListener('quick-ai-close', () => {
      closes++
    })
    // Clicking into the note to keep writing is not a request to close the bar.
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await settle(el)
    expect(closes).toBe(0)
    expect(el.isConnected).toBe(true)

    // Escape puts it away rather than throwing the conversation out.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle(el)
    expect(closes).toBe(0)
    expect(el.collapsed).toBe(true)

    // A second Escape, with nothing left to put away, closes it.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle(el)
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    expect(closes).toBe(1)
  })

  it('collapses to a handle and restores the conversation', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Note.', selection: null })
    await withOutput(el)
    expect(el.shadowRoot!.querySelector('.reply')).not.toBeNull()

    el.shadowRoot!.querySelector<HTMLButtonElement>(
      'button[aria-label="Put the prompt bar away"]'
    )!.click()
    await settle(el)
    // One handle where the bar was, with nothing drawn over the writing. The
    // panel stays in the tree so the draft survives.
    const handle = el.shadowRoot!.querySelector('.handle')!
    expect(handle.hasAttribute('hidden')).toBe(false)
    expect(el.shadowRoot!.querySelector('.panel')!.hasAttribute('hidden')).toBe(true)
    expect(el.shadowRoot!.querySelector('writemd-ai-composer')).not.toBeNull()

    ;(handle as HTMLButtonElement).click()
    await settle(el)
    expect(el.shadowRoot!.querySelector('.handle')!.hasAttribute('hidden')).toBe(true)
    expect(el.shadowRoot!.querySelector('.panel')!.hasAttribute('hidden')).toBe(false)
    expect(el.shadowRoot!.querySelector('.reply')!.innerHTML).toContain('An answer.')
  })

  it('keeps a draft across a collapse', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Note.', selection: null })
    prompt(el).value = 'half-written'
    prompt(el).dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }))
    await settle(el)
    el.collapsed = true
    await settle(el)
    el.collapsed = false
    await settle(el)
    expect(prompt(el).value).toBe('half-written')
  })

  it('hands the conversation to the panel on Open full chat', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Note.', selection: null })
    await ask(el, 'what is next?')
    emit({ requestId: sent[0].id, type: 'answer', text: 'Ship the bar.' })
    emit({ requestId: sent[0].id, type: 'done' })
    await settle(el)

    ;(el.shadowRoot!.querySelector('.handoff') as HTMLButtonElement).click()
    const handoff = takeAiHandoff()
    expect(handoff).not.toBeNull()
    expect(handoff!.path).toBe('C:/vault/Note.md')
    expect(handoff!.selection).toBeNull()
    expect(handoff!.messages).toEqual([
      { role: 'user', content: 'what is next?' },
      { role: 'assistant', content: 'Ship the bar.' }
    ])
    // Read once, so reopening the panel does not resurrect it.
    expect(takeAiHandoff()).toBeNull()
  })

  it('always offers the panel handoff, since the panel is always one step away', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Note.', selection: null })
    const handed = new Promise<CustomEvent>((resolve) =>
      el.addEventListener('quick-ai-full-chat', resolve as EventListener)
    )
    // Nothing has been said yet, and the way into the panel is still there.
    ;(el.shadowRoot!.querySelector('.handoff') as HTMLButtonElement).click()
    expect((await handed).type).toBe('quick-ai-full-chat')
    expect(takeAiHandoff()).toEqual({
      sessionId: sent[0]?.input.sessionId ?? el.turns.sessionId,
      messages: [],
      path: 'C:/vault/Note.md',
      selection: null
    })
  })

  it('carries the selection across, so a follow-up keeps its subject', async () => {
    const el = await mount({
      path: 'C:/vault/Note.md',
      content: 'A car is red.',
      selection: { from: 2, to: 5, text: 'car' }
    })
    ;(el.shadowRoot!.querySelector('.handoff') as HTMLButtonElement).click()
    expect(takeAiHandoff()!.selection).toBe('car')
  })

  it('hands the app a readable message when the note moved under a suggestion', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'A car is red.', selection: null })
    el.reportApplyError('This note changed after the suggestion was made.')
    await settle(el)
    expect(el.shadowRoot!.querySelector('.error')!.textContent).toContain('changed after')
  })

  it('keeps a failed apply on screen through later turn events, and lets it be retried', async () => {
    const el = await mount({ path: 'C:/vault/Note.md', content: 'Old', selection: null })
    const id = await ask(el, 'edit this note')
    const change: PreviewChangeView = {
      previewId: 'first',
      path: 'C:/vault/Note.md',
      original: 'Old',
      content: 'New',
      kind: 'modified'
    }
    emit({ requestId: id, type: 'preview', changes: [change], skipped: [] })
    await settle(el)
    const attempts: string[] = []
    el.addEventListener('quick-ai-accept', (event) => {
      const proposed = (event as CustomEvent<{ change: PreviewChangeView }>).detail.change
      attempts.push(proposed.content)
    })
    control(el, '.suggestion .accept').click()
    await settle(el)
    expect(attempts).toEqual(['New'])

    el.reportApplyError('This note changed after the suggestion was made.')
    await settle(el)
    expect(el.shadowRoot!.querySelector('.error')!.textContent).toContain('changed after')

    // Later turn state carries an error of its own, and a null one here. Taking
    // that over the app's message would erase the only explanation on screen.
    emit({ requestId: id, type: 'status', message: 'Checking the note…' })
    await settle(el)
    const composer = el.shadowRoot!.querySelector('writemd-ai-composer')!
    expect(composer.thinkingStatus).toBe('Checking the note…')
    expect(el.shadowRoot!.querySelector('.error')!.textContent).toContain('changed after')

    // The suggestion outlives its own failure, so it can be tried again.
    expect(el.turns.getState().previews).toEqual([change])
    expect(control(el, '.suggestion .accept').disabled).toBe(false)
    control(el, '.suggestion .accept').click()
    await settle(el)
    expect(attempts).toEqual(['New', 'New'])
  })
})
