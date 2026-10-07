import { describe, it, expect, vi } from 'vitest'
import { AiSessionController } from '../src/renderer/src/controllers/ai-session'
import type { ReactiveControllerHost } from 'lit'
import type { ChatSession, ChatSessionSummary } from '../src/shared/electron-api'

function controller(path: () => string | null): AiSessionController {
  const host: ReactiveControllerHost = {
    addController: vi.fn(),
    removeController: vi.fn(),
    requestUpdate: vi.fn(),
    updateComplete: Promise.resolve(true)
  }
  return new AiSessionController(host, {
    path,
    content: () => '# Note',
    closeHistory: vi.fn(),
    replace: vi.fn().mockResolvedValue(false)
  })
}

describe('AI session ownership', () => {
  it('does not restore a stale disk result after switching documents', async () => {
    let path = 'a.md'
    let resolve: ((sessions: ChatSessionSummary[]) => void) | undefined
    const listSessions = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<ChatSessionSummary[]>((done) => {
            resolve = done
          })
      )
      .mockResolvedValue([])
    const loadSession = vi.fn()
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      chat: { listSessions, loadSession }
    }
    try {
      const ai = controller(() => path)
      const stale = ai.loadAiSession()
      path = 'b.md'
      await ai.loadAiSession()
      resolve?.([
        { id: 'a', title: 'Old session', docPath: 'a.md', createdAt: 1, updatedAt: 1 }
      ] as ChatSessionSummary[])
      await stale
      expect(ai.aiSessionId).toBeNull()
      expect(ai.aiMessages).toEqual([])
      expect(loadSession).not.toHaveBeenCalled()
    } finally {
      delete (window as unknown as { electronAPI?: unknown }).electronAPI
    }
  })

  it('clearing a chat persists an empty transcript', async () => {
    const saveSession = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { chat: { saveSession } }
    try {
      const ai = controller(() => 'a.md')
      ai.aiSessionId = 'a'
      ai.aiMessages = [{ role: 'user', content: 'Old question' }]
      ai.handleAiClear()
      await Promise.resolve()
      expect(saveSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', messages: [] }))
    } finally {
      delete (window as unknown as { electronAPI?: unknown }).electronAPI
    }
  })

  it('finishes a background stream without overwriting the visible conversation', () => {
    const ai = controller(() => 'a.md')
    ai.aiSessionId = 'a'
    ai.appendAiDeltaToSession('a', 'First ')
    ai.stashAiSessionForPath('a.md')
    ai.aiSessionId = 'b'
    ai.aiMessages = [{ role: 'user', content: 'Question B' }]
    ai.appendAiDeltaToSession('a', 'answer')
    expect(ai.settleAiStreamForSession('a', 'First answer')).toBe(true)
    expect(ai.aiMessages[0].content).toBe('Question B')
  })

  it('ignores a session selection completed after a tab switch', async () => {
    let path = 'a.md'
    let resolve: ((session: ChatSession) => void) | undefined
    const loadSession = vi.fn(
      () =>
        new Promise<ChatSession>((done) => {
          resolve = done
        })
    )
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { chat: { loadSession } }
    try {
      const ai = controller(() => path)
      ai.handleAiSelectSession('a-history')
      path = 'b.md'
      resolve?.({
        id: 'a-history',
        title: '',
        docPath: 'a.md',
        createdAt: 1,
        updatedAt: 1,
        messages: [{ role: 'assistant', content: 'Old answer' }]
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(ai.aiMessages).toEqual([])
    } finally {
      delete (window as unknown as { electronAPI?: unknown }).electronAPI
    }
  })
})
