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
})
