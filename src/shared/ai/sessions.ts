import type { AiSession, MessageContent } from './types'

/**
 * Saved conversations: the list, its limits, and what happens to data read back
 * off disk.
 *
 * Pure on purpose. No electron, no fs, no DOM, no clock beyond what a caller
 * passes in, so the renderer can hold the store in memory, the main process can
 * validate a file the renderer hands it, and both get the same answer. Every
 * function returns a new array and never touches what it was given - a store
 * that mutates its input in one place and not the others is a store that loses
 * a conversation.
 *
 * The limits are about disk and startup time, not about taste. Twenty
 * conversations is more than anyone scrolls; 200k characters is small enough
 * that reading the file is instant. What is never dropped is the newest
 * conversation: capping a list by evicting the newest entry would empty the
 * app on launch, which is a worse failure than a file that is briefly too big.
 */

/**
 * A stored turn. Text only.
 *
 * `AiSession.messages` carries tool results and base64 image blocks, and neither
 * belongs in a file that is loaded at startup - one pasted screenshot is larger
 * than the whole budget. A saved conversation is the transcript, not the run.
 */
export interface PersistedMessage {
  role: 'user' | 'assistant'
  content: string
}

/** An `AiSession` with the parts that are not storable taken out. */
export type PersistedSession = Omit<AiSession, 'messages'> & { messages: PersistedMessage[] }

/** Enough of a message to name a conversation after it. */
export interface TitleMessage {
  role: string
  content?: string | readonly MessageContent[] | null
}

/** Shown until there is something to say. */
export const DEFAULT_TITLE = 'New chat'

/** Conversations kept, newest first. */
export const MAX_SESSIONS = 20

/** Characters of stored transcript kept across every conversation. */
export const MAX_TOTAL_CHARS = 200_000

/** Longest title. The ellipsis when a title is cut is not counted against it. */
const TITLE_LIMIT = 60

/**
 * A title is the first thing the user wrote, not a summary of it. An
 * auto-generated title that explains the conversation is a title that has to be
 * read before it can be recognized, and the first sentence of a request is
 * usually the request.
 *
 * Cut on a word boundary: a title ending mid-word reads as a bug even to
 * someone who did not write it, and there is nothing to gain from the extra two
 * characters.
 */
export function deriveTitle(messages: readonly TitleMessage[]): string {
  for (const message of messages) {
    if (message.role !== 'user') continue
    const text = collapse(textOf(message.content))
    if (text) return truncate(text)
  }
  return DEFAULT_TITLE
}

/**
 * Keep the store inside its limits: newest first, capped by count, then by
 * total characters. The newest conversation is always kept.
 */
export function pruneSessions(sessions: readonly PersistedSession[]): PersistedSession[] {
  const newestFirst = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  const kept: PersistedSession[] = []
  let total = 0
  for (const session of newestFirst) {
    if (kept.length >= MAX_SESSIONS) break
    const chars = sessionChars(session)
    // Skipped rather than stopping, so one very long conversation does not
    // evict every older one behind it. The newest is never a candidate: with
    // nothing else left to drop, keeping it is the only answer that leaves the
    // user with the conversation they just had.
    if (kept.length > 0 && total + chars > MAX_TOTAL_CHARS) continue
    kept.push(session)
    total += chars
  }
  return kept.map(cloneSession)
}

/**
 * Store a conversation, replacing any earlier one with the same id.
 *
 * A conversation with no messages is not stored: that is a new chat, and a list
 * full of empty chats is a list of things that cannot be reopened. If the
 * conversation being saved already exists and has become empty - every message
 * removed - it is removed from the store rather than replaced with a blank.
 */
export function upsertSession(
  sessions: readonly PersistedSession[],
  session: PersistedSession
): PersistedSession[] {
  const incoming = cloneSession(session)
  const rest = sessions.filter((s) => s.id !== incoming.id)
  const next = incoming.messages.length > 0 ? [...rest, incoming] : rest
  return pruneSessions(next)
}

/** Drop one conversation. An id that is not there changes nothing. */
export function removeSession(
  sessions: readonly PersistedSession[],
  id: string
): PersistedSession[] {
  return sessions.filter((s) => s.id !== id).map(cloneSession)
}

/**
 * Turn whatever was in the file into conversations, dropping what cannot be
 * used.
 *
 * A saved file is the one piece of this feature that can be edited by something
 * other than this code - hand-edited, half-written by a crash, written by an
 * older build - so nothing in it is trusted. The asymmetry is deliberate: a
 * conversation with one unusable message keeps the rest, and a conversation
 * that cannot be identified or reopened is dropped whole, because there is
 * nothing to open. Validation only; the caller prunes what comes back.
 */
export function sanitizeSessions(raw: unknown): PersistedSession[] {
  if (!Array.isArray(raw)) return []
  const out: PersistedSession[] = []
  for (const candidate of raw) {
    const session = sanitizeSession(candidate)
    if (session) out.push(session)
  }
  return out
}

/**
 * An id for a new conversation.
 *
 * `crypto.randomUUID` where it exists - a secure context in the renderer, Node
 * in main - and a hand-rolled v4 from `getRandomValues` or `Math.random` where
 * it does not. An id only has to be unique among conversations, so the
 * fallback is good enough that a missing API should not throw on the one call
 * that starts every new chat.
 */
export function makeSessionId(): string {
  const source = globalThis.crypto
  if (typeof source?.randomUUID === 'function') return source.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof source?.getRandomValues === 'function') {
    source.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex: string[] = []
  for (const byte of bytes) hex.push(byte.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join('')
  ].join('-')
}

function sanitizeSession(value: unknown): PersistedSession | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  // No id means no way to address, replace or delete it later.
  if (!id) return null
  if (!Array.isArray(raw.messages)) return null

  const messages: PersistedMessage[] = []
  for (const candidate of raw.messages) {
    const message = sanitizeMessage(candidate)
    if (message) messages.push(message)
  }

  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  return {
    id,
    title: title || deriveTitle(messages),
    providerId: typeof raw.providerId === 'string' ? raw.providerId : '',
    model: typeof raw.model === 'string' ? raw.model : null,
    messages,
    contextFile: typeof raw.contextFile === 'string' ? raw.contextFile : null,
    createdAt: toTimestamp(raw.createdAt),
    updatedAt: toTimestamp(raw.updatedAt)
  }
}

function sanitizeMessage(value: unknown): PersistedMessage | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  // System prompts are re-sent every turn and tool results are meaningless
  // without the call that produced them, so neither is kept.
  if (raw.role !== 'user' && raw.role !== 'assistant') return null
  // Blocks are flattened to their text here, which is also what drops an
  // image-only turn: with no text there is nothing left to replay.
  const content = textOf(raw.content)
  if (!content.trim()) return null
  return { role: raw.role, content }
}

/** The text of a message, whether it is a string or a list of content blocks. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const candidate = block as Record<string, unknown>
    if (candidate.type === 'text' && typeof candidate.text === 'string') parts.push(candidate.text)
  }
  return parts.join(' ')
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function truncate(text: string): string {
  if (text.length <= TITLE_LIMIT) return text
  const head = text.slice(0, TITLE_LIMIT)
  // -1 means there is no space to break on: a single long token, which has to
  // be cut where it lands rather than dropped.
  const lastSpace = head.lastIndexOf(' ')
  return `${lastSpace > 0 ? head.slice(0, lastSpace) : head}…`
}

function toTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function sessionChars(session: PersistedSession): number {
  let total = session.title.length
  for (const message of session.messages) total += message.content.length
  return total
}

function cloneSession(session: PersistedSession): PersistedSession {
  return { ...session, messages: session.messages.map((message) => ({ ...message })) }
}
