import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '../src/renderer/src/components/ai/AiDock'
import { AiDock } from '../src/renderer/src/components/ai/AiDock'
import type { AiComposer, ComposerSendDetail } from '../src/renderer/src/components/ai/Composer'
import type { AiBridge, AiEvent } from '../src/renderer/src/components/ai/types'

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
      read: async (): Promise<{ content: string; mtime: number }> => ({ content: '', mtime: 1 }),
      onChanged: (): (() => void) => () => undefined
    },
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
  beforeEach(() => {
    undoChange.mockClear()
    send.mockClear()
    listSessions.mockClear()
    installBridge()
  })

  afterEach(() => {
    clearBridge()
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
})
