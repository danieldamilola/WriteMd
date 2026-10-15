import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { makeTempRoot, cleanupTempRoot } from './helpers/temp-root'
import type { RunTurnRequest, TurnEvent } from '../src/main/ai/turn'
import type { AiSendInput } from '../src/main/ai/service'

const mocks = vi.hoisted(() => ({
  root: '',
  key: 'test-key',
  openCodeToken: vi.fn<() => Promise<string>>(),
  settings: {
    enabled: true,
    providerId: 'openai',
    baseUrl: 'https://example.test/v1',
    model: 'first-model',
    maxOutputTokens: 0,
    historyTurns: 10
  },
  run: vi.fn<(request: RunTurnRequest) => AsyncGenerator<TurnEvent>>()
}))
vi.mock('electron', () => ({ app: { getPath: () => mocks.root } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ ai: mocks.settings }) }))
vi.mock('../src/main/vault', () => ({ getVaultPath: () => mocks.root }))
vi.mock('../src/main/ai/key-store', () => ({ getApiKey: () => mocks.key }))
vi.mock('../src/main/ai/turn', () => ({ runTurn: mocks.run }))
vi.mock('../src/main/ai/opencode-auth', () => ({
  OPENCODE_ORIGIN: 'https://opencode.ai',
  OPENCODE_CONSOLE: 'https://opencode.ai/console',
  OPENCODE_API_BASE: 'https://opencode.ai/inference/openai/v1',
  openCodeAuth: () => ({ accessToken: mocks.openCodeToken })
}))

import {
  cancelAll,
  cancelTurn,
  deleteSavedSession,
  readSessions,
  setEventEmitter,
  setFileChangeEmitter,
  startTurn
} from '../src/main/ai/service'

function input(): AiSendInput & { document: { path: string; content: string } } {
  return {
    sessionId: 'session',
    userText: 'Hello',
    document: { path: join(mocks.root, 'note.md'), content: 'Note' },
    selection: null,
    references: [],
    attachments: [],
    openPaths: []
  }
}

beforeEach(() => {
  mocks.key = 'test-key'
  mocks.root = makeTempRoot('ai-service')
  mocks.settings.model = 'first-model'
  mocks.settings.providerId = 'openai'
  mocks.settings.baseUrl = 'https://example.test/v1'
  mocks.openCodeToken.mockReset().mockResolvedValue('account-only-secret')
  mocks.settings.maxOutputTokens = 0
  mocks.run.mockReset()
})

afterEach(() => {
  cancelAll()
  setEventEmitter(null)
  setFileChangeEmitter(null)
  cleanupTempRoot(mocks.root)
})

describe('AI conversation persistence', () => {
  it('uses the official OpenCode route and account connection without a saved API key', async () => {
    mocks.key = ''
    mocks.settings.providerId = 'opencode'
    mocks.settings.baseUrl = 'https://untrusted-custom-endpoint.test/v1'
    mocks.settings.model = 'workspace/kimi'
    mocks.run.mockImplementation(async function* () {
      yield { type: 'done', text: 'Reply' }
    })
    await startTurn('opencode', input())
    expect(mocks.openCodeToken).toHaveBeenCalledOnce()
    expect(mocks.run.mock.calls[0][0]).toMatchObject({
      providerId: 'opencode',
      baseUrl: 'https://opencode.ai/inference/openai/v1',
      model: 'workspace/kimi',
      apiKey: undefined
    })
    expect(JSON.stringify(mocks.run.mock.calls)).not.toContain('account-only-secret')
  })

  it('rejects a disconnected OpenCode account even when an unrelated API key is stored', async () => {
    mocks.settings.providerId = 'opencode'
    mocks.openCodeToken.mockRejectedValue(new Error('Sign in to OpenCode in AI Settings.'))
    await expect(startTurn('opencode', input())).rejects.toThrow('Sign in to OpenCode')
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('notifies committed files before forwarding the applied event', async () => {
    const order: string[] = []
    const path = input().document.path
    setFileChangeEmitter((changed) => order.push(changed))
    setEventEmitter((event) => order.push(String(event.type)))
    mocks.run.mockImplementation(async function* () {
      yield {
        type: 'applied',
        outcome: {
          applied: [{ path, kind: 'modified', journalId: 'journal', blocks: 1 }],
          skipped: []
        }
      }
      yield { type: 'done', text: 'Applied.' }
    })
    await startTurn('commit-notification', input())
    expect(order).toEqual([path, 'applied', 'done'])
  })
  it('sends a terminal event for a turn cancelled by main alone', async () => {
    // A sign-out or account switch cancels from main without the renderer
    // asking. The run loop skips `done` for an aborted turn, so without a
    // terminal event here the composer stays disabled until restart.
    const events: Record<string, unknown>[] = []
    setEventEmitter((event) => events.push(event))
    let release!: () => void
    mocks.run.mockImplementation(async function* () {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      yield { type: 'done', text: 'Never shown.' }
    })
    const running = startTurn('cancel-all', input())
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalled())
    cancelAll()
    release()
    await running
    expect(events.filter((event) => event.type === 'done')).toHaveLength(1)
  })

  it.each([0, 65536])('uses the configured output limit %s for both AI surfaces', async (limit) => {
    mocks.settings.maxOutputTokens = limit
    mocks.run.mockImplementation(async function* () {
      yield { type: 'done', text: 'Completed.' }
    })
    await startTurn('floating-limit', { ...input(), previewOnly: true })
    await startTurn('panel-limit', input())
    expect(mocks.run.mock.calls.map(([request]) => request.maxTokens)).toEqual([
      limit || undefined,
      limit || undefined
    ])
  })
  it('forwards edit previews and saves completed replies in the same session', async () => {
    const saved = join(mocks.root, 'ai-sessions.json')
    const events: Record<string, unknown>[] = []
    setEventEmitter((event) => events.push(event))
    const changes = [
      {
        path: input().document.path,
        original: 'Draft',
        content: 'Revision',
        kind: 'modified' as const
      }
    ]
    mocks.run.mockImplementation(async function* () {
      yield { type: 'preview', changes, skipped: [] }
      yield { type: 'done', text: 'Review this change.' }
    })
    await startTurn('preview', {
      ...input(),
      previewOnly: true,
      document: { ...input().document, content: 'Draft' }
    })
    expect(mocks.run.mock.calls[0][0]).toMatchObject({
      previewOnly: true,
      history: [],
      context: { document: { content: 'Draft' }, references: [], attachments: [], openPaths: [] }
    })
    expect(events).toEqual([
      {
        requestId: 'preview',
        type: 'preview',
        changes: [expect.objectContaining({ ...changes[0], previewId: expect.any(String) })],
        skipped: []
      },
      { requestId: 'preview', type: 'done', text: 'Review this change.' }
    ])
    expect(readSessions()[0].messages).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Review this change.' }
    ])
    await startTurn('follow-up', { ...input(), previewOnly: true, userText: 'Try again' })
    expect(mocks.run.mock.calls[1][0].history).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Review this change.' }
    ])
    expect(readSessions()).toHaveLength(1)
    expect(readSessions()[0].messages).toHaveLength(4)
    expect(existsSync(`${saved}.corrupt`)).toBe(false)
  })
  it('loads an explicitly selected personal skill and excludes it from selection actions', async () => {
    const folder = join(mocks.root, '.writemd', 'skills', 'proofread')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'SKILL.md'), 'PERSONAL_GUIDANCE')
    mocks.run.mockImplementation(async function* () {
      yield { type: 'done', text: 'Reply' }
    })
    await startTurn('skill', { ...input(), userText: '/proofread improve this' })
    expect(mocks.run.mock.calls[0][0].skill).toMatchObject({
      name: 'proofread',
      instructions: 'PERSONAL_GUIDANCE'
    })
    await startTurn('selection-skill', { ...input(), userText: '/proofread', selectionOnly: true })
    expect(mocks.run.mock.calls[1][0].skill).toBeUndefined()
    await expect(startTurn('missing', { ...input(), userText: '/missing' })).rejects.toThrow(
      'Skill /missing'
    )
    expect(mocks.run).toHaveBeenCalledTimes(2)
  })
  it('directs unconfigured selection actions to Settings without contacting the provider', async () => {
    mocks.key = ''
    await expect(
      startTurn('selection', { ...input(), selectionOnly: true, selection: 'car' })
    ).rejects.toThrow('Add your API key in Settings')
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('strips unrelated context and saved history for selection-only actions at the main boundary', async () => {
    mocks.run.mockImplementation(async function* () {
      yield { type: 'done', text: 'Reply' }
    })
    await startTurn('previous', input())
    await startTurn('selection', {
      ...input(),
      selectionOnly: true,
      selection: 'car',
      references: [{ path: 'other.md', content: 'PRIVATE' }],
      openPaths: ['other.md']
    })
    expect(mocks.run.mock.calls[1][0]).toMatchObject({
      history: [],
      context: {
        selectionOnly: true,
        selection: 'car',
        document: null,
        references: [],
        attachments: [],
        openPaths: []
      }
    })
  })
  it('reports a conversation write failure instead of silently dropping history', async () => {
    mkdirSync(join(mocks.root, 'ai-sessions.json'))
    const events: Record<string, unknown>[] = []
    setEventEmitter((event) => events.push(event))
    mocks.run.mockImplementation(async function* () {
      yield { type: 'done', text: 'Reply' }
    })
    await startTurn('request', input())
    expect(events).toEqual([
      { requestId: 'request', type: 'answer', text: 'Reply' },
      { requestId: 'request', type: 'error', message: expect.stringContaining('Could not save') },
      { requestId: 'request', type: 'done' }
    ])
  })

  it('saves the completed exchange before notifying the renderer', async () => {
    mocks.run.mockImplementation(async function* () {
      yield { type: 'done', text: 'Hello back' }
    })
    const savedAtDone: string[] = []
    setEventEmitter((event) => {
      if (event.type === 'done')
        savedAtDone.push(...readSessions()[0].messages.map((message) => message.content))
    })
    await startTurn('request', input())
    expect(savedAtDone).toEqual(['Hello', 'Hello back'])
  })

  it('uses the request model snapshot and updates metadata after a model switch', async () => {
    mocks.run.mockImplementation(async function* () {
      mocks.settings.model = 'settings-changed-during-stream'
      yield { type: 'done', text: 'First reply' }
    })
    await startTurn('first', input())
    expect(readSessions()[0]).toMatchObject({
      model: 'first-model',
      contextFile: input().document.path
    })
    mocks.settings.model = 'second-model'
    mocks.run.mockImplementation(async function* () {
      yield { type: 'done', text: 'Second reply' }
    })
    await startTurn('second', input())
    expect(readSessions()[0].model).toBe('second-model')
    expect(mocks.run.mock.calls[1][0].history).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'First reply' }
    ])
  })

  it('does not persist or forward late replies after cancellation', async () => {
    const events: Record<string, unknown>[] = []
    setEventEmitter((event) => events.push(event))
    mocks.run.mockImplementation(async function* () {
      cancelTurn('request')
      yield { type: 'done', text: 'Late reply' }
    })
    await startTurn('request', input())
    expect(readSessions()).toEqual([])
    expect(events).toEqual([])
  })

  it('cancels an active turn when its conversation is deleted', async () => {
    mocks.run.mockImplementation(async function* (request) {
      deleteSavedSession('session')
      expect(request.signal.aborted).toBe(true)
      yield { type: 'done', text: 'Do not restore this conversation' }
    })
    await startTurn('request', input())
    expect(readSessions()).toEqual([])
  })
})
