import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '../src/renderer/src/components/ai/AiDock'
import { AiDock } from '../src/renderer/src/components/ai/AiDock'
import type { AiComposer, ComposerSendDetail } from '../src/renderer/src/components/ai/Composer'
import type { AiBridge, AiEvent } from '../src/renderer/src/components/ai/types'
import { FileState } from '../src/renderer/src/state/file-state'

/**
 * The change list is the safety surface for a feature that writes to the
 * user's disk without asking, so these tests are mostly about what it shows.
 *
 * A file the applier refused has to be visible with its reason. "It quietly
 * changed two of the three notes you asked about" is indistinguishable from the
 * assistant having ignored the request, and the user has no way to find out
 * which happened without a list.
 *
 * Events are pushed through the fake `onEvent` with the request id the live
 * controller generated, which is how the real bridge delivers them.
 */

type Api = NonNullable<Window['electronAPI']>

let emit: (event: AiEvent) => void = () => undefined

const undoChange = vi.fn<AiBridge['undoChange']>(async () => ({ status: 'restored' }))
const send = vi.fn<AiBridge['send']>(async () => undefined)
const listSessions = vi.fn<AiBridge['listSessions']>(async () => [])
const listChanges = vi.fn<AiBridge['listChanges']>(async () => [])
const saveSession = vi.fn<AiBridge['saveSession']>(async () => undefined)
const cancel = vi.fn<AiBridge['cancel']>(async () => undefined)
const openExternal = vi.fn<(url: string) => Promise<void>>(async () => undefined)
const read = vi.fn<(path: string) => Promise<{ content: string; mtime: number }>>(async () => ({
  content: '',
  mtime: 1
}))

function installBridge(): void {
  emit = () => undefined
  ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
    ai: {
      send,
      cancel,
      saveSession,
      undoChange,
      listSessions,
      listChanges,
      onEvent: (cb: (event: AiEvent) => void): (() => void) => {
        emit = cb
        return (): void => {
          emit = (): void => undefined
        }
      }
    },
    // FileState reaches for these on construction.
    vault: {
      getPath: async (): Promise<string> => 'C:/vault',
      getTree: async (): Promise<unknown> => ({
        name: 'Vault',
        path: 'C:/vault',
        isDirectory: true,
        children: []
      })
    },
    file: {
      read,
      onChanged: (): (() => void) => () => undefined
    },
    shell: { openExternal },
    settings: {
      get: async (): Promise<Record<string, never>> => ({}),
      set: async (): Promise<void> => undefined
    }
  } as unknown as Api
}

function clearBridge(): void {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
}

async function settle(el: AiDock): Promise<void> {
  await el.updateComplete
  await new Promise((resolve) => setTimeout(resolve, 0))
  await el.updateComplete
}

async function mount(): Promise<AiDock> {
  const el = document.createElement('writemd-ai-dock') as AiDock
  document.body.appendChild(el)
  await settle(el)
  return el
}

/** Push a prompt through the composer, the way a keystroke would. */
async function prompt(el: AiDock, text: string): Promise<string> {
  const composer = el.shadowRoot?.querySelector('writemd-ai-composer') as AiComposer
  composer.dispatchEvent(
    new CustomEvent<ComposerSendDetail>('composer-send', {
      detail: { text, attachments: [] },
      bubbles: true,
      composed: true
    })
  )
  await settle(el)
  return el.turns.requestId as string
}

describe('writemd-ai-dock', () => {
  it('offers a floating-bar handoff without cancelling the conversation', async () => {
    const dock = await mount()
    const handoff = vi.fn()
    dock.addEventListener('ai-open-floating', handoff)
    const button = [...dock.shadowRoot!.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Open in floating bar'
    )
    expect(button).toBeDefined()
    button!.click()
    expect(handoff).toHaveBeenCalledOnce()
    expect(cancel).not.toHaveBeenCalled()
    dock.remove()
  })
  beforeEach(() => {
    undoChange.mockClear()
    send.mockClear()
    openExternal.mockClear()
    listSessions.mockReset().mockResolvedValue([])
    listChanges.mockReset().mockResolvedValue([])
    read.mockReset().mockResolvedValue({ content: '', mtime: 1 })
    installBridge()
  })

  afterEach(() => {
    clearBridge()
  })

  it('does not read a selected personal skill as a document reference', async () => {
    const el = await mount()
    await prompt(el, '/proofread fix @README.md')
    expect(read.mock.calls.some(([path]) => path.endsWith('/proofread'))).toBe(false)
    expect(read.mock.calls.some(([path]) => path.endsWith('/README.md'))).toBe(true)
    el.remove()
  })

  it('renders a row per changed file, each with its own undo', async () => {
    const el = await mount()
    const requestId = await prompt(el, 'tighten the intro')

    emit({
      type: 'applied',
      requestId,
      changed: [
        {
          id: 'j1',
          path: 'C:/vault/Notes/Intro.md',
          kind: 'modified',
          createdAt: 2,
          revertedAt: null
        },
        {
          id: 'j2',
          path: 'C:/vault/Notes/New note.md',
          kind: 'created',
          createdAt: 3,
          revertedAt: null
        }
      ],
      skipped: []
    })
    await settle(el)

    const rows = Array.from(el.shadowRoot?.querySelectorAll('.change') ?? [])
    expect(rows).toHaveLength(2)
    expect(el.shadowRoot?.textContent).toContain('Intro.md')
    expect(el.shadowRoot?.textContent).toContain('New note.md')
    expect(el.shadowRoot?.textContent).toContain('modified')
    expect(el.shadowRoot?.textContent).toContain('created')
    expect(el.shadowRoot?.querySelectorAll('button.undo')).toHaveLength(2)
  })

  it('calls undoChange for the row that was clicked and says what happened', async () => {
    const el = await mount()
    const requestId = await prompt(el, 'tighten the intro')
    emit({
      type: 'applied',
      requestId,
      changed: [
        {
          id: 'j1',
          path: 'C:/vault/Notes/Intro.md',
          kind: 'modified',
          createdAt: 2,
          revertedAt: null
        },
        {
          id: 'j2',
          path: 'C:/vault/Notes/Other.md',
          kind: 'modified',
          createdAt: 3,
          revertedAt: null
        }
      ],
      skipped: []
    })
    await settle(el)

    const buttons = Array.from(el.shadowRoot?.querySelectorAll('button.undo') ?? [])
    buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(el)

    expect(undoChange).toHaveBeenCalledTimes(1)
    expect(undoChange).toHaveBeenCalledWith('j2')
    expect(el.shadowRoot?.textContent).toContain('Reverted.')
  })

  it('says so when undo was refused rather than pretending it worked', async () => {
    undoChange.mockImplementationOnce(async () => ({ status: 'changed-since' }))
    const el = await mount()
    const requestId = await prompt(el, 'tighten the intro')
    emit({
      type: 'applied',
      requestId,
      changed: [
        {
          id: 'j1',
          path: 'C:/vault/Notes/Intro.md',
          kind: 'modified',
          createdAt: 2,
          revertedAt: null
        }
      ],
      skipped: []
    })
    await settle(el)

    el.shadowRoot
      ?.querySelector('button.undo')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(el)
    expect(el.shadowRoot?.textContent).toContain('Changed since')
  })

  it('shows skipped files with their reason', async () => {
    const el = await mount()
    const requestId = await prompt(el, 'rename both notes')
    emit({
      type: 'applied',
      requestId,
      changed: [
        { id: 'j1', path: 'C:/vault/Notes/A.md', kind: 'modified', createdAt: 2, revertedAt: null }
      ],
      skipped: [
        { path: 'C:/vault/Notes/B.md', reason: 'ambiguous', detail: 'Two files matched that name.' }
      ]
    })
    await settle(el)

    const skipped = el.shadowRoot?.querySelector('.change.skipped')
    expect(skipped).not.toBeNull()
    expect(skipped?.textContent).toContain('B.md')
    expect(skipped?.textContent).toContain('ambiguous')
    // A skipped file has nothing to undo, so it must not offer one.
    expect(skipped?.querySelector('button.undo')).toBeNull()
  })

  it('shows a failure where the user will see it', async () => {
    const el = await mount()
    const requestId = await prompt(el, 'tighten the intro')
    emit({ type: 'error', requestId, message: 'The provider rejected the request.' })
    await settle(el)

    const alert = el.shadowRoot?.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('The provider rejected the request.')
    expect(el.turns.getState().busy).toBe(false)
  })

  it('renders the streamed answer as Markdown once the turn settles', async () => {
    const el = await mount()
    const requestId = await prompt(el, 'summarise this')
    emit({ type: 'text', requestId, delta: '- **one**' })
    emit({ type: 'text', requestId, delta: '\n- two' })
    emit({ type: 'done', requestId })
    await settle(el)

    const markdown = el.shadowRoot?.querySelector('.bubble.md')
    expect(markdown?.querySelector('strong')?.textContent).toBe('one')
    expect(markdown?.querySelectorAll('li')).toHaveLength(2)
  })

  it('sends the open document and the open tabs as context', async () => {
    const el = await mount()
    const requestId = await prompt(el, 'summarise this')
    expect(requestId).toBeTruthy()
    // No file is open in jsdom, so the document slot is null rather than an
    // empty object: the main process treats those differently.
    expect(send).toHaveBeenCalledTimes(1)
    // (requestId, input): the renderer chooses the id so a stream from a
    // cancelled turn can be told apart from the one replacing it.
    expect(send.mock.calls[0][0]).toBe(requestId)
    expect(send.mock.calls[0][1]).toMatchObject({
      userText: 'summarise this',
      document: null,
      selection: null,
      openPaths: []
    })
  })

  it('stops the live turn from the composer', async () => {
    const el = await mount()
    const requestId = await prompt(el, 'summarise this')
    const composer = el.shadowRoot?.querySelector('writemd-ai-composer') as AiComposer
    composer.dispatchEvent(new CustomEvent('composer-stop', { bubbles: true, composed: true }))
    await settle(el)

    expect(cancel).toHaveBeenCalledWith(requestId)
    expect(el.turns.getState().busy).toBe(false)
  })

  it('notes when there is no document open', async () => {
    const el = await mount()
    expect(el.shadowRoot?.querySelector('.doc.none')?.textContent).toBe('No document open')
  })

  it('reads complete quoted file references without splitting a character budget', async () => {
    read.mockResolvedValue({ content: 'a'.repeat(90_000), mtime: 1 })
    const el = await mount()
    await prompt(el, 'Compare @"Project notes.md" /"Other notes.md"')
    expect(read).toHaveBeenCalledWith('C:/vault/Project notes.md')
    expect(read).toHaveBeenCalledWith('C:/vault/Other notes.md')
    const references = send.mock.calls[0][1].references ?? []
    expect(references.map((reference) => reference.content.length)).toEqual([90_000, 90_000])
  })

  it('does not send a pending reference read after starting a new conversation', async () => {
    let finish: ((value: { content: string; mtime: number }) => void) | undefined
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const el = await mount()
    await prompt(el, 'Read @note.md')
    el.shadowRoot?.querySelector<HTMLButtonElement>('[aria-label="New chat"]')?.click()
    finish?.({ content: 'old context', mtime: 1 })
    await settle(el)
    expect(send).not.toHaveBeenCalled()
  })

  it('does not capture selected assistant text across shadow roots', async () => {
    const el = await mount()
    const requestId = await prompt(el, 'hello')
    emit({ type: 'done', requestId, text: 'A reply to copy.' })
    await settle(el)
    const text = el.shadowRoot?.querySelector('.bubble.md p')?.firstChild ?? null
    vi.spyOn(document, 'getSelection').mockReturnValue({
      anchorNode: text,
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'A reply to copy.'
    } as Selection)
    document.dispatchEvent(new Event('selectionchange'))
    await prompt(el, 'another question')
    expect(send.mock.calls[1][1].selection).toBeNull()
  })

  it('keeps following new streamed content when the thread grows', async () => {
    const el = await mount()
    const thread = el.shadowRoot?.querySelector<HTMLElement>('.thread') as HTMLElement
    Object.defineProperties(thread, {
      scrollHeight: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 300 }
    })
    const requestId = await prompt(el, 'hello')
    emit({ type: 'done', requestId, text: 'A longer answer.' })
    await settle(el)
    await vi.waitFor(() => expect(thread.scrollTop).toBe(900))
    thread.scrollTop = 100
    thread.dispatchEvent(new Event('scroll'))
    el.requestUpdate()
    await settle(el)
    expect(thread.scrollTop).toBe(100)
  })

  it('copies a completed reply as Markdown', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const el = await mount()
    const requestId = await prompt(el, 'hello')
    emit({ type: 'done', requestId, text: '**A reply**' })
    await settle(el)
    el.shadowRoot?.querySelector<HTMLButtonElement>('[aria-label="Copy reply"]')?.click()
    await settle(el)
    expect(writeText).toHaveBeenCalledWith('**A reply**')
    expect(el.shadowRoot?.querySelector('.copy')?.textContent).toBe('Copied')
  })

  it('keeps a live conversation when its current history entry is selected', async () => {
    const el = await mount()
    const requestId = await prompt(el, 'Keep this question')
    emit({ type: 'text', requestId, delta: 'A partial answer' })
    await settle(el)
    const picker = el.shadowRoot?.querySelector('writemd-ai-history-picker')
    const id = picker?.currentId
    expect(id).toBeTruthy()
    picker?.dispatchEvent(
      new CustomEvent('session-pick', { detail: { id }, bubbles: true, composed: true })
    )
    await settle(el)
    expect(el.turns.requestId).toBe(requestId)
    expect(el.shadowRoot?.querySelector('.user .bubble')?.textContent).toBe('Keep this question')
    expect(el.turns.getState().messages.at(-1)?.text).toBe('A partial answer')
  })

  it('reopens saved messages with their Markdown intact', async () => {
    listSessions.mockResolvedValue([
      {
        id: 'saved',
        title: 'Saved chat',
        createdAt: 1,
        updatedAt: 2,
        providerId: 'openai',
        model: 'mock-model',
        contextFile: null,
        messages: [
          { role: 'user', content: 'A question' },
          { role: 'assistant', content: '**A saved reply**' }
        ]
      }
    ])
    const el = await mount()
    el.shadowRoot
      ?.querySelector('writemd-ai-history-picker')
      ?.dispatchEvent(
        new CustomEvent('session-pick', { detail: { id: 'saved' }, bubbles: true, composed: true })
      )
    await settle(el)
    expect(el.shadowRoot?.querySelector('.bubble.md strong')?.textContent).toBe('A saved reply')
  })

  it('discards change history arriving after the conversation is closed', async () => {
    listSessions.mockResolvedValue([
      {
        id: 'saved',
        title: 'Saved chat',
        createdAt: 1,
        updatedAt: 2,
        providerId: 'openai',
        model: null,
        contextFile: null,
        messages: []
      }
    ])
    let finish: ((value: Awaited<ReturnType<AiBridge['listChanges']>>) => void) | undefined
    listChanges.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const el = await mount()
    el.shadowRoot
      ?.querySelector('writemd-ai-history-picker')
      ?.dispatchEvent(
        new CustomEvent('session-pick', { detail: { id: 'saved' }, bubbles: true, composed: true })
      )
    el.shadowRoot?.querySelector<HTMLButtonElement>('[aria-label="New chat"]')?.click()
    finish?.([
      { id: 'stale', path: 'C:/vault/old.md', kind: 'modified', createdAt: 1, revertedAt: null }
    ])
    await settle(el)
    expect(el.shadowRoot?.querySelector('.change')).toBeNull()
  })

  it('includes the secondary note associated with an explicit selection', async () => {
    const fileState = FileState.getInstance()
    const snapshot = fileState.getState()
    const state = vi.spyOn(fileState, 'getState').mockReturnValue({
      ...snapshot,
      path: 'C:/vault/main.md',
      content: 'Primary text',
      secondaryDoc: {
        path: 'C:/vault/secondary.md',
        content: 'Secondary text',
        originalContent: '',
        mtime: 1,
        dirty: true,
        viewMode: 'source'
      }
    })
    const el = await mount()
    el.setSelectionContext('Secondary', 'C:/vault/secondary.md')
    await settle(el)
    expect(el.shadowRoot!.querySelector('.doc')?.textContent).toContain('secondary')
    await prompt(el, 'Rewrite this selection')
    expect(send.mock.calls[0][1]).toMatchObject({
      document: { path: 'C:/vault/secondary.md', content: 'Secondary text' },
      selection: 'Secondary',
      openPaths: ['C:/vault/secondary.md']
    })
    state.mockRestore()
  })

  it('sends only a selected word for an inline explanation', async () => {
    const el = await mount()
    await prompt(el, 'An unrelated question')
    await el.runSelectionAction({ text: 'car', path: 'C:/vault/note.md', intent: 'explain' })
    const input = send.mock.calls.at(-1)![1]
    expect(input).toMatchObject({
      selectionOnly: true,
      selection: 'car',
      document: null,
      references: [],
      attachments: [],
      openPaths: []
    })
    expect(input.userText).toContain('Explain only')
    expect(el.turns.getState().messages.filter((message) => message.role === 'user')).toHaveLength(
      1
    )
  })

  it('clears an unfinished draft when starting another chat', async () => {
    const el = await mount()
    const composer = el.shadowRoot!.querySelector<AiComposer>('writemd-ai-composer')!
    composer.setPrompt('An old conversation draft')
    await settle(el)
    el.shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="New chat"]')!.click()
    await composer.updateComplete
    expect(composer.text).toBe('')
    expect(composer.shadowRoot!.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('')
  })

  it('prevents duplicate undo and discards its result after changing chats', async () => {
    let finish!: (outcome: Awaited<ReturnType<AiBridge['undoChange']>>) => void
    undoChange.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const el = await mount()
    const requestId = await prompt(el, 'Edit this note')
    emit({
      type: 'applied',
      requestId,
      skipped: [],
      changed: [
        {
          id: 'pending-undo',
          path: 'C:/vault/note.md',
          kind: 'modified',
          createdAt: 1,
          revertedAt: null
        }
      ]
    })
    await settle(el)
    const undo = el.shadowRoot!.querySelector<HTMLButtonElement>('button.undo')!
    undo.click()
    await settle(el)
    expect(undo.disabled).toBe(true)
    undo.click()
    expect(undoChange).toHaveBeenCalledTimes(1)
    el.shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="New chat"]')!.click()
    finish({ status: 'restored' })
    await settle(el)
    expect(el.shadowRoot!.querySelector('.note')).toBeNull()
  })

  it('opens reply links through the safe navigation bridge', async () => {
    const el = await mount()
    const requestId = await prompt(el, 'Show me a source')
    emit({ type: 'done', requestId, text: '[Source](https://example.com/article)' })
    await settle(el)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    el.shadowRoot!.querySelector('a')!.dispatchEvent(click)
    await settle(el)
    expect(click.defaultPrevented).toBe(true)
    expect(openExternal).toHaveBeenCalledWith('https://example.com/article')
  })
})
