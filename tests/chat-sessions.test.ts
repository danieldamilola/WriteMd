import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// SETTINGS-style module state: the chats directory is resolved from
// app.getPath('userData') at call time, so the mock must answer with the
// throwaway dir before anything imports the module under test.
const ctx = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => ctx.userData }
}))

import {
  createSession,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  ensureTitle
} from '../src/main/chat-sessions'

let DIR: string

beforeEach(() => {
  DIR = mkdtempSync(join(tmpdir(), 'writemd-chats-'))
  ctx.userData = DIR
})

afterEach(() => {
  rmSync(DIR, { recursive: true, force: true })
})

// DIR is assigned per test, so the document path has to be read lazily.
const doc = (): string => join(DIR, 'notes.md')

describe('chat sessions', () => {
  it('creates a session with no messages', () => {
    const s = createSession(doc())
    expect(s.messages).toEqual([])
    expect(s.docPath).toBe(doc())
    expect(s.title).toBe('')
    expect(s.id).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('round-trips a session through disk', async () => {
    const s = createSession(doc())
    s.messages = [
      { role: 'user', content: 'hello', filePath: doc() },
      { role: 'assistant', content: 'hi' }
    ]
    await saveSession(s)
    const loaded = await loadSession(s.id)
    expect(loaded?.messages).toEqual(s.messages)
  })

  it('titles a session from its first user message', async () => {
    const s = createSession(doc())
    expect(await ensureTitle(s)).toBe(s) // nothing to title yet
    s.messages = [
      { role: 'assistant', content: 'greeting first' },
      { role: 'user', content: '  Rewrite the intro paragraph  ' }
    ]
    const titled = await ensureTitle(s)
    expect(titled.title).toBe('Rewrite the intro paragraph')
  })

  it('lists sessions for one document, newest first', async () => {
    const other = join(DIR, 'other.md')
    const older = createSession(doc())
    older.updatedAt = 1000
    const newer = createSession(doc())
    newer.updatedAt = 2000
    const elsewhere = createSession(other)
    elsewhere.updatedAt = 1500
    await saveSession({ ...older, messages: [{ role: 'user', content: 'older' }] })
    await saveSession({ ...newer, messages: [{ role: 'user', content: 'newer' }] })
    await saveSession({ ...elsewhere, messages: [{ role: 'user', content: 'elsewhere' }] })

    const forDoc = await listSessions(doc())
    expect(forDoc.map((s) => s.title)).toEqual(['newer', 'older'])

    const everything = await listSessions(null)
    expect(everything).toHaveLength(3)
  })

  it('summarises without shipping the messages', async () => {
    const s = createSession(doc())
    await saveSession({ ...s, messages: [{ role: 'user', content: 'a question' }] })
    const [summary] = await listSessions(doc())
    expect(summary).not.toHaveProperty('messages')
    expect(summary.messageCount).toBe(1)
    expect(summary.title).toBe('a question')
  })

  it('returns an empty list when no chats exist yet', async () => {
    expect(await listSessions(doc())).toEqual([])
  })

  it('skips an unreadable session instead of failing the whole list', async () => {
    const good = createSession(doc())
    await saveSession({ ...good, messages: [{ role: 'user', content: 'fine' }] })
    mkdirSync(join(DIR, 'chats'), { recursive: true })
    writeFileSync(join(DIR, 'chats', 'corrupt.json'), '{not json', 'utf-8')

    const list = await listSessions(doc())
    expect(list.map((s) => s.title)).toEqual(['fine'])
  })

  it('refuses an id that could walk out of the chats directory', async () => {
    // Ids come from the renderer, so path traversal has to be rejected here
    // rather than trusted.
    for (const bad of ['../../escape', 'a/b', '..', 'x'.repeat(200)]) {
      await expect(loadSession(bad)).rejects.toThrow(/Invalid chat session id/)
      await expect(deleteSession(bad)).rejects.toThrow(/Invalid chat session id/)
    }
  })

  it('returns null for a session that does not exist', async () => {
    expect(await loadSession('missingbutvalidid1234')).toBeNull()
  })

  it('treats deleting an absent session as success', async () => {
    await expect(deleteSession('missingbutvalidid1234')).resolves.toBeUndefined()
  })

  it('leaves no partial file behind when the id is invalid', async () => {
    await expect(saveSession({ ...createSession(doc()), id: '../oops' })).rejects.toThrow()
    expect(readdirSync(join(DIR, 'chats'))).toEqual([])
  })
})
