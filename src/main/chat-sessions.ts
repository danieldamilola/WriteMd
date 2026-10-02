import { app } from 'electron'
import { mkdirSync, existsSync, readdirSync } from 'fs'
import { readFile, writeFile, rename, unlink } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { ChatSession, ChatSessionSummary } from '../shared/electron-api'

/**
 * Chat session storage.
 *
 * Sessions live in the app's userData directory, one JSON file per session:
 *
 *   <userData>/chats/<id>.json
 *
 * Deliberately not in the vault. The vault is the user's notes, it may be a git
 * repository or a synced folder, and a bot transcript is not something to
 * commit or hand to someone else. The cost is that wiping app data loses chat
 * history, which is the right trade for keeping it out of their documents.
 *
 * File-per-session rather than one index file, so a corrupt session costs one
 * conversation instead of all of them, and so writing never rewrites data it
 * did not touch.
 */

function chatsDir(): string {
  return join(app.getPath('userData'), 'chats')
}

function ensureDir(): string {
  const dir = chatsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

function sessionFile(id: string): string {
  // Ids are generated here, but this is reached with renderer-supplied values.
  // Refuse anything that is not a bare id so a crafted one cannot walk out of
  // the chats directory.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('Invalid chat session id')
  return join(chatsDir(), `${id}.json`)
}

function isSession(value: unknown): value is ChatSession {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.createdAt === 'number' &&
    typeof v.updatedAt === 'number' &&
    Array.isArray(v.messages)
  )
}

export function createSession(docPath: string | null): ChatSession {
  const now = Date.now()
  return {
    id: randomUUID().replace(/-/g, '').slice(0, 24),
    title: '',
    docPath,
    createdAt: now,
    updatedAt: now,
    messages: []
  }
}

/**
 * Serialises writes per session.
 *
 * The settle handler and the submit handler both persist, and they can overlap.
 * Two renames onto one destination do not queue: on Windows the loser fails with
 * EPERM because the target is momentarily open, so the transcript was left as
 * whichever write happened to win. Chaining them per id means the last write
 * still lands, in order.
 */
const pending = new Map<string, Promise<void>>()

export function saveSession(session: ChatSession): Promise<void> {
  const id = session.id
  const next = (pending.get(id) ?? Promise.resolve()).then(() => writeSession(session))
  // The chain must not reject, or the next save for this id inherits the
  // failure and never runs. The caller still sees the real error.
  pending.set(
    id,
    next.catch(() => {})
  )
  return next
}

async function writeSession(session: ChatSession): Promise<void> {
  const dir = ensureDir()
  // Temp plus atomic rename, like the document and settings writes. A direct
  // write truncates the live file, so a crash mid-write leaves invalid JSON
  // that would then fail to load.
  const temp = join(dir, `${session.id}.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, JSON.stringify(session, null, 2), { encoding: 'utf-8', mode: 0o600 })
    await rename(temp, sessionFile(session.id))
  } catch (e) {
    await unlink(temp).catch(() => {})
    throw e
  }
}

export async function loadSession(id: string): Promise<ChatSession | null> {
  const file = sessionFile(id)
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf-8'))
    return isSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

function toSummary(session: ChatSession): ChatSessionSummary {
  const firstUser = session.messages.find((m) => m.role === 'user')
  const text = (firstUser?.content ?? '').trim()
  const title = session.title || (text ? text.replace(/\s+/g, ' ').slice(0, 60) : 'New chat')
  return {
    id: session.id,
    title,
    docPath: session.docPath,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length
  }
}

/**
 * Summaries only, newest first. Sessions that fail to parse are skipped rather
 * than failing the whole list, so one bad file does not hide every other chat.
 */
export async function listSessions(docPath: string | null): Promise<ChatSessionSummary[]> {
  const dir = chatsDir()
  if (!existsSync(dir)) return []
  const names = readdirSync(dir).filter((n) => n.endsWith('.json'))
  const sessions = await Promise.all(
    names.map(async (name) => {
      try {
        const parsed: unknown = JSON.parse(await readFile(join(dir, name), 'utf-8'))
        return isSession(parsed) ? parsed : null
      } catch {
        return null
      }
    })
  )
  return sessions
    .filter((s): s is ChatSession => s !== null)
    .filter((s) => (docPath === null ? true : s.docPath === docPath))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(toSummary)
}

export async function deleteSession(id: string): Promise<void> {
  try {
    await unlink(sessionFile(id))
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    // Already gone is the state the caller wanted.
    if (code !== 'ENOENT') throw e
  }
}

/** Rename a session after its first user message. */
export async function ensureTitle(session: ChatSession): Promise<ChatSession> {
  if (session.title) return session
  const firstUser = session.messages.find((m) => m.role === 'user')
  const text = (firstUser?.content ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return session
  session.title = text.slice(0, 60)
  return session
}
