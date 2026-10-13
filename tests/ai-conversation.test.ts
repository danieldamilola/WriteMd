import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  conversationController,
  connectConversation,
  disconnectConversation
} from '../src/renderer/src/components/ai/conversation'
import type { AiEvent, AiSendInput } from '../src/shared/electron-api'

let emit: (event: AiEvent) => void
const send = vi.fn(async (_id: string, _input: AiSendInput) => undefined)
const cancel = vi.fn(async (_id: string) => undefined)
const input = (): AiSendInput => ({
  sessionId: conversationController().sessionId,
  userText: 'Question',
  previewOnly: true,
  document: null,
  selection: null,
  references: [],
  attachments: [],
  openPaths: []
})
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  send.mockClear()
  cancel.mockClear()
  Object.assign(window, {
    electronAPI: {
      ai: {
        send,
        cancel,
        onEvent: (listener: typeof emit) => {
          emit = listener
          return () => {
            emit = () => undefined
          }
        }
      }
    }
  })
})
afterEach(() => {
  conversationController().dispose()
  delete window.electronAPI
})

it('shares live messages and a stable session between both surfaces', async () => {
  const bar = conversationController()
  const panel = conversationController()
  expect(bar).toBe(panel)
  connectConversation(bar)
  connectConversation(panel)
  await bar.start(input())
  const requestId = bar.requestId!
  emit({ requestId, type: 'text', delta: 'Provisional text' })
  expect(panel.getState().messages.at(-1)?.text).toBe('Provisional text')
  expect(panel.getState().reply).toBeNull()
  emit({ requestId, type: 'done', text: 'Saved answer' })
  expect(panel.getState().reply).toBe('Saved answer')
  await panel.start(input())
  expect(send.mock.calls[1][1].sessionId).toBe(send.mock.calls[0][1].sessionId)
  disconnectConversation(bar)
  await tick()
  expect(panel.getState().busy).toBe(true)
  expect(cancel).not.toHaveBeenCalled()
  disconnectConversation(panel)
  await tick()
  expect(cancel).toHaveBeenCalledOnce()
})

it('switches surfaces without cancelling the live request', async () => {
  const controller = conversationController()
  connectConversation(controller)
  await controller.start(input())
  const requestId = controller.requestId
  disconnectConversation(controller)
  connectConversation(conversationController())
  await tick()
  expect(controller.requestId).toBe(requestId)
  expect(cancel).not.toHaveBeenCalled()
  disconnectConversation(controller)
  await tick()
})

it('preserves completed replies after both surfaces close and reset starts a new session', async () => {
  const controller = conversationController()
  connectConversation(controller)
  await controller.start(input())
  emit({ requestId: controller.requestId!, type: 'done', text: 'Answer' })
  const sessionId = controller.sessionId
  disconnectConversation(controller)
  await tick()
  const reopened = conversationController()
  connectConversation(reopened)
  expect(reopened.sessionId).toBe(sessionId)
  expect(reopened.getState().reply).toBe('Answer')
  reopened.reset()
  expect(reopened.sessionId).not.toBe(sessionId)
  expect(reopened.getState().messages).toEqual([])
  disconnectConversation(reopened)
  await tick()
})
