import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TurnController } from '../src/renderer/src/components/ai/turn-controller'
import type { AiBridge, AiEvent, AiSendInput } from '../src/renderer/src/components/ai/types'

/**
 * The turn controller is where a streaming panel goes wrong.
 *
 * Three of these tests are about one decision: the controller drops every event
 * whose request id is not the live one. Cancel does not stop a provider
 * instantly, and the next message can be sent straight away, so without that
 * check the tail of a cancelled answer lands at the front of the next one. The
 * user sees a reply that mixes two questions and there is nothing to point at.
 *
 * The bridge is faked at `window.electronAPI`, the single seam
 * `src/renderer/src/api.ts` exposes.
 */

type Api = NonNullable<Window['electronAPI']>

const send = vi.fn<AiBridge['send']>(async () => undefined)
const cancel = vi.fn<AiBridge['cancel']>(async () => undefined)
const saveSession = vi.fn<AiBridge['saveSession']>(async () => undefined)

/** The sink the fake `onEvent` hands out, so a test can push an event in. */
let emit: (event: AiEvent) => void = () => undefined

function installBridge(): void {
  emit = () => undefined
  ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
    ai: {
      send,
      cancel,
      saveSession,
      onEvent: (cb: (event: AiEvent) => void): (() => void) => {
        emit = cb
        return (): void => {
          emit = (): void => undefined
        }
      }
    }
  } as unknown as Api
}

function clearBridge(): void {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
}

function input(overrides: Partial<AiSendInput> = {}): AiSendInput {
  return {
    sessionId: 'session-1',
    userText: 'Fix the typo',
    document: null,
    selection: null,
    references: [],
    attachments: [],
    openPaths: [],
    ...overrides
  }
}

/** Let the controller's async save reach the fake. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('TurnController', () => {
  it('confirms acceptance once all previews are applied and preserves the conversation', async () => {
    const controller = new TurnController()
    await controller.start(input({ previewOnly: true }))
    const requestId = controller.requestId!
    const first = {
      previewId: 'first',
      path: 'one.md',
      original: 'old',
      content: 'new',
      kind: 'modified' as const
    }
    const second = { ...first, previewId: 'second', path: 'two.md' }
    emit({ type: 'preview', requestId, changes: [first, second], skipped: [] })
    emit({ type: 'done', requestId, text: 'Review the suggested change before accepting it.' })
    const sessionId = controller.sessionId
    controller.acceptPreview(first, null)
    expect(controller.getState().previews).toEqual([second])
    expect(controller.getState().reply).toBe('Review the suggested change before accepting it.')
    controller.acceptPreview(second, null)
    expect(controller.getState().previews).toEqual([])
    expect(controller.getState().reply).toBe('Applied the requested change.')
    expect(controller.getState().messages.at(-1)?.text).toBe('Applied the requested change.')
    expect(controller.sessionId).toBe(sessionId)
    expect(controller.getState().messages).toHaveLength(2)
    controller.dispose()
  })

  it('keeps a substantive assistant reply after accepting its suggestion', async () => {
    const controller = new TurnController()
    await controller.start(input({ previewOnly: true }))
    const requestId = controller.requestId!
    const preview = {
      previewId: 'first',
      path: 'one.md',
      original: 'old',
      content: 'new',
      kind: 'modified' as const
    }
    emit({ type: 'preview', requestId, changes: [preview], skipped: [] })
    emit({ type: 'done', requestId, text: 'The introduction now explains ownership.' })
    controller.acceptPreview(preview, null)
    expect(controller.getState().reply).toBe('The introduction now explains ownership.')
    controller.dispose()
  })

  it('stores proposed text separately from written changes and drops stale previews', async () => {
    installBridge()
    const controller = new TurnController()
    await controller.start(input({ previewOnly: true }))
    const requestId = controller.requestId!
    const changes = [
      { path: 'note.md', original: 'Draft', content: 'Revision', kind: 'modified' as const }
    ]
    emit({ type: 'preview', requestId, changes, skipped: [] })
    expect(controller.getState().previews).toEqual(changes)
    expect(controller.getState().changes).toEqual([])
    emit({ type: 'done', requestId, text: 'Review this change.' })
    await controller.start(input({ previewOnly: true }))
    emit({ type: 'preview', requestId, changes, skipped: [] })
    expect(controller.getState().previews).toEqual([])
    controller.dispose()
  })
  beforeEach(() => {
    send.mockClear()
    cancel.mockClear()
    saveSession.mockClear()
    installBridge()
  })

  afterEach(() => {
    clearBridge()
  })

  it('accumulates streamed text into the assistant message', async () => {
    const controller = new TurnController()
    await controller.start(input())
    const requestId = controller.requestId

    emit({ type: 'text', requestId: requestId as string, delta: 'Here is ' })
    emit({ type: 'text', requestId: requestId as string, delta: 'the fix.' })

    const messages = controller.getState().messages
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].text).toBe('Here is the fix.')
    expect(controller.getState().busy).toBe(true)
  })

  it('shows search status and replaces intermediate prose with the terminal reply', async () => {
    const controller = new TurnController()
    await controller.start(input())
    const requestId = controller.requestId as string
    emit({ type: 'text', requestId, delta: 'Searching now' })
    emit({ type: 'status', requestId, message: 'Searching the web for car…' })
    expect(controller.getState().status).toBe('Searching the web for car…')
    expect(controller.getState().messages.at(-1)?.text).toBe('')
    emit({ type: 'text', requestId, delta: 'A car carries people.' })
    expect(controller.getState().status).toBeNull()
    emit({ type: 'done', requestId, text: 'A car carries people.' })
    expect(controller.getState().messages.at(-1)?.text).toBe('A car carries people.')
    expect(controller.getState().busy).toBe(false)
  })

  it('ignores events from a turn that is no longer the active one', async () => {
    const controller = new TurnController()
    await controller.start(input({ userText: 'first' }))
    const stale = controller.requestId as string

    await controller.start(input({ userText: 'second' }))
    const live = controller.requestId as string
    expect(live).not.toBe(stale)

    // The cancelled turn's tail arrives after the next message was sent.
    emit({ type: 'text', requestId: stale, delta: 'STALE' })
    expect(controller.getState().messages.at(-1)?.text).toBe('')

    emit({ type: 'text', requestId: live, delta: 'fresh' })
    expect(controller.getState().messages.at(-1)?.text).toBe('fresh')
    expect(controller.getState().busy).toBe(true)
  })

  it('goes idle on done', async () => {
    const controller = new TurnController()
    await controller.start(input())
    const requestId = controller.requestId as string

    emit({ type: 'text', requestId, delta: 'done talking' })
    emit({ type: 'done', requestId })

    expect(controller.getState().busy).toBe(false)
    expect(controller.getState().error).toBeNull()
    expect(controller.getState().messages.at(-1)?.text).toBe('done talking')
  })

  it('goes idle on error and keeps the message that streamed first', async () => {
    const controller = new TurnController()
    await controller.start(input())
    const requestId = controller.requestId as string

    emit({ type: 'text', requestId, delta: 'half an answer' })
    emit({ type: 'error', requestId, message: 'the provider hung up' })

    expect(controller.getState().busy).toBe(false)
    expect(controller.getState().error).toBe('the provider hung up')
    expect(controller.getState().messages.at(-1)?.text).toBe('half an answer')
  })

  it('cancel stops the turn and asks the main process to stop', async () => {
    const controller = new TurnController()
    await controller.start(input())
    const requestId = controller.requestId as string

    controller.cancel()

    expect(cancel).toHaveBeenCalledWith(requestId)
    expect(controller.getState().busy).toBe(false)
    // The provider's trailing deltas after a stop are not part of the transcript.
    emit({ type: 'text', requestId, delta: 'ignored' })
    expect(controller.getState().messages.at(-1)?.text).toBe('')
  })

  it('leaves session persistence to the main process', async () => {
    // The renderer used to write the session too, which was two writers on one
    // JSON file and a source of truncated history: only main knows a turn's
    // authoritative text. The renderer still chooses the id.
    const controller = new TurnController()
    await controller.start(input())
    const requestId = controller.requestId as string

    emit({ type: 'text', requestId, delta: 'a' })
    emit({ type: 'text', requestId, delta: 'b' })
    emit({ type: 'done', requestId })
    await settle()

    expect(saveSession).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      requestId,
      expect.objectContaining({ sessionId: 'session-1' })
    )
  })

  it('replaces the streamed text with the authoritative one on done', async () => {
    // Streamed deltas are provisional. When the model edited files they held
    // the protocol - a wall of <<<<<<< SEARCH - and showing that in the
    // transcript is showing the user something they neither wrote nor asked to
    // read. The real reply is the sentence around it.
    const controller = new TurnController()
    await controller.start(input())
    const requestId = controller.requestId as string

    emit({ type: 'text', requestId, delta: 'Here you go.\n<<<<<<< SEARCH\n' })
    emit({ type: 'text', requestId, delta: 'old\n=======\nnew\n>>>>>>> REPLACE' })
    expect(controller.getState().messages.at(-1)?.text).toContain('<<<<<<<')

    emit({ type: 'done', requestId, text: 'Here you go.' })
    await settle()
    expect(controller.getState().messages.at(-1)?.text).toBe('Here you go.')
  })

  it('records applied and skipped files for the change list', async () => {
    const controller = new TurnController()
    await controller.start(input())
    const requestId = controller.requestId as string

    emit({
      type: 'proposal',
      requestId,
      files: ['notes/a.md'],
      blocks: 2,
      skipped: []
    })
    expect(controller.getState().proposal?.blocks).toBe(2)

    emit({
      type: 'applied',
      requestId,
      changed: [
        { id: 'j1', path: '/vault/notes/a.md', kind: 'modified', createdAt: 1, revertedAt: null }
      ],
      skipped: [{ path: '/vault/notes/b.md', reason: 'ambiguous', detail: 'Two paths matched.' }]
    })

    expect(controller.getState().changes).toHaveLength(1)
    expect(controller.getState().skipped[0]?.reason).toBe('ambiguous')
  })

  it('restores the saved transcript when reopening a conversation', () => {
    const controller = new TurnController()
    controller.load({
      id: 'saved',
      title: 'Earlier question',
      createdAt: 10,
      updatedAt: 20,
      messages: [
        { role: 'user', content: 'Earlier question' },
        { role: 'assistant', content: '**Saved answer**' }
      ]
    })
    expect(controller.getState().messages.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'user', text: 'Earlier question' },
      { role: 'assistant', text: '**Saved answer**' }
    ])
    expect(controller.sessionId).toBe('saved')
    expect(controller.getState().busy).toBe(false)
  })

  it('ignores a change list that resolves after switching conversations', () => {
    const controller = new TurnController()
    controller.load({ id: 'new', title: 'New', createdAt: 1, updatedAt: 1 })
    controller.adoptChanges(
      [{ id: 'old-change', path: '/old.md', kind: 'modified', createdAt: 1, revertedAt: null }],
      'old'
    )
    expect(controller.getState().changes).toEqual([])
  })

  it('ignores a delayed send failure after the next request starts', async () => {
    let rejectFirst: (error: Error) => void = () => undefined
    send.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject
        })
    )
    const controller = new TurnController()
    const first = controller.start(input({ userText: 'First' }))
    await controller.start(input({ userText: 'Next' }))
    const active = controller.requestId
    rejectFirst(new Error('Old send failed'))
    await first
    expect(controller.requestId).toBe(active)
    expect(controller.getState().busy).toBe(true)
    expect(controller.getState().error).toBeNull()
  })

  it('recovers the composer when sending a request fails', async () => {
    send.mockRejectedValueOnce(new Error('Could not send'))
    const controller = new TurnController()
    await controller.start(input())
    expect(controller.requestId).toBeNull()
    expect(controller.getState().busy).toBe(false)
    expect(controller.getState().error).toBe('Could not send')
  })

  it('keeps the readable response when saving its conversation fails after an edit', async () => {
    const controller = new TurnController()
    await controller.start(input())
    const requestId = controller.requestId as string
    emit({ type: 'text', requestId, delta: '<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE' })
    emit({ type: 'answer', requestId, text: 'Updated the note.' })
    emit({ type: 'error', requestId, message: 'Could not save the AI conversation.' })
    expect(controller.getState().messages.at(-1)?.text).toBe('Updated the note.')
    expect(controller.getState().error).toBe('Could not save the AI conversation.')
    expect(controller.getState().busy).toBe(false)
  })

  it.each(['reset', 'load', 'dispose', 'replace'] as const)(
    'cancels the provider when a live conversation is abandoned by %s',
    async (action) => {
      const controller = new TurnController()
      await controller.start(input())
      const requestId = controller.requestId as string
      if (action === 'load') {
        controller.load({ id: 'saved', title: 'Saved', createdAt: 1, updatedAt: 1 })
      } else if (action === 'replace') {
        await controller.start(input({ userText: 'replacement' }))
      } else {
        controller[action]()
      }
      expect(cancel).toHaveBeenCalledWith(requestId)
      emit({ type: 'text', requestId, delta: 'stale response' })
      expect(
        controller.getState().messages.some((message) => message.text.includes('stale response'))
      ).toBe(false)
    }
  )

  it('accepts an empty final answer to remove streamed edit protocol', async () => {
    const controller = new TurnController()
    await controller.start(input())
    const requestId = controller.requestId as string
    emit({ type: 'text', requestId, delta: '<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE' })
    emit({ type: 'done', requestId, text: '' })
    expect(controller.getState().messages.at(-1)?.text).toBe('')
    expect(controller.getState().busy).toBe(false)
  })
})
