import { app } from 'electron'
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { join, dirname } from 'path'
import { ChangeJournal } from './journal'
import { runTurn, type TurnEvent } from './turn'
import { getApiKey } from './key-store'
import { getSettings } from '../settings'
import { getVaultPath } from '../vault'
import {
  upsertSession,
  removeSession,
  makeSessionId,
  deriveTitle,
  sanitizeSessions,
  type PersistedSession,
  type PersistedMessage
} from '../../shared/ai/sessions'

/**
 * Owns everything with a lifetime: the undo journal, the in-flight turns, and
 * the saved conversations.
 *
 * Kept out of `ipc.ts` so the IPC layer stays a list of channel registrations.
 * The alternative - module-level state scattered across handlers - is how a
 * second turn ends up appending its output into the first one's transcript.
 */

export interface AiSendInput {
  sessionId: string
  userText: string
  document: { path: string; content: string } | null
  selection: string | null
  references: { path: string; content: string }[]
  attachments: {
    name: string
    kind: 'image' | 'text'
    data?: string
    mimeType?: string
    text?: string
  }[]
  openPaths: string[]
}

export interface ChangeView {
  id: string
  path: string
  kind: 'created' | 'modified'
  createdAt: number
  revertedAt: number | null
}

interface ActiveTurn {
  sessionId: string
  controller: AbortController
}

const turns = new Map<string, ActiveTurn>()

// ---------------------------------------------------------------- storage

const userDataPath = (name: string): string => join(app.getPath('userData'), name)

let journal: ChangeJournal | null = null

export function getJournal(): ChangeJournal {
  // Lazy rather than module scope: `app.getPath` is not usable while the module
  // is being imported in a test, and nothing here needs the path at import time.
  journal ??= new ChangeJournal(userDataPath('ai-journal.json'))
  return journal
}

/**
 * Read saved sessions.
 *
 * A corrupt file is moved aside rather than deleted. Sessions are the one thing
 * in this feature the user cannot get back, and the failure mode worth
 * avoiding is the one where a bad write silently empties the history.
 */
function loadSessions(): PersistedSession[] {
  const path = userDataPath('ai-sessions.json')
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch {
    return []
  }
  try {
    return sanitizeSessions(JSON.parse(raw))
  } catch {
    try {
      renameSync(path, `${path}.corrupt`)
    } catch {
      /* nothing useful to do */
    }
    return []
  }
}

function saveSessions(sessions: PersistedSession[]): void {
  const path = userDataPath('ai-sessions.json')
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(temp, JSON.stringify(sessions), { encoding: 'utf-8', mode: 0o600 })
    renameSync(temp, path)
  } catch {
    try {
      rmSync(temp, { force: true })
    } catch {
      /* nothing useful to do */
    }
  }
}

// ---------------------------------------------------------------- events

type Emitter = (event: Record<string, unknown>) => void
let emit: Emitter | null = null

export function setEventEmitter(fn: Emitter | null): void {
  emit = fn
}

// ---------------------------------------------------------------- turns

/**
 * Translate a turn's domain event into the flat shape the renderer expects.
 *
 * They are not the same shape, and spreading one into the other is how a feature
 * ends up silently doing nothing: `TurnEvent` carries a nested `outcome` and a
 * nested `apply`, the bridge contract wants `changed`, `skipped`, `files` and
 * `blocks` at the top level. The renderer saw events whose fields were all
 * `undefined`, rendered an empty transcript, and changed the file anyway -
 * every layer green, nothing visible.
 *
 * The translation lives here because this is the only place that knows both
 * sides. Anything the renderer cannot act on is dropped rather than passed
 * through as undefined.
 */
function toBridgeEvent(event: TurnEvent): Record<string, unknown> | null {
  switch (event.type) {
    case 'text':
      return { type: 'text', delta: event.delta }
    case 'proposal':
      return {
        type: 'proposal',
        files: event.apply.proposals.map((p) => p.path),
        blocks: event.apply.proposals.reduce((n, p) => n + p.blocks.length, 0),
        skipped: event.apply.skippedPaths
      }
    case 'applied':
      return {
        type: 'applied',
        changed: event.outcome.applied.map((c) => ({
          id: c.journalId,
          path: c.path,
          kind: c.kind,
          createdAt: Date.now(),
          revertedAt: null
        })),
        skipped: event.outcome.skipped
      }
    case 'answer':
      return { type: 'answer', text: event.text }
    case 'error':
      return { type: 'error', message: event.message }
    case 'done':
      return event.text ? { type: 'done', text: event.text } : { type: 'done' }
  }
}

/**
 * Start a turn and stream it out.
 *
 * Returns as soon as the turn is under way; everything after arrives as an
 * event. The renderer supplies the request id so it can ignore a stale stream
 * from a turn the user already stopped.
 */
export async function startTurn(requestId: string, input: AiSendInput): Promise<void> {
  // One live turn per session. A second request for the same conversation stops
  // the first: two streams appending into one transcript produces a transcript
  // neither of them produced.
  for (const [id, turn] of turns) {
    if (turn.sessionId === input.sessionId) {
      turn.controller.abort()
      turns.delete(id)
    }
  }

  const settings = getSettings().ai
  if (!settings.enabled) throw new Error('The AI assistant is turned off in Settings.')
  if (!settings.model) throw new Error('No model selected. Open Settings and press Fetch.')

  const controller = new AbortController()
  turns.set(requestId, { sessionId: input.sessionId, controller })

  const existing = loadSessions().find((s) => s.id === input.sessionId)
  const history = (existing?.messages ?? []).map((m) => ({ role: m.role, content: m.content }))

  const send = (event: TurnEvent): void => {
    const payload = toBridgeEvent(event)
    if (payload) emit?.({ requestId, ...payload })
  }

  let settled = false
  try {
    for await (const event of runTurn({
      sessionId: input.sessionId,
      providerId: settings.providerId,
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey: getApiKey() || undefined,
      userText: input.userText,
      history,
      historyTurns: settings.historyTurns,
      context: {
        document: input.document ? { ...input.document, isOpen: true } : null,
        selection: input.selection,
        references: input.references,
        attachments: input.attachments,
        openPaths: input.openPaths,
        base: getVaultPath()
      },
      journal: getJournal(),
      signal: controller.signal
    })) {
      send(event)
      // Commit as soon as the model finishes, so a crash after this point does
      // not cost the exchange.
      if (event.type === 'done') {
        settled = true
        commitTurn(input.sessionId, input.userText, event.text)
      }
    }
  } catch (err) {
    emit?.({
      requestId,
      type: 'error',
      message: err instanceof Error ? err.message : String(err)
    })
  } finally {
    turns.delete(requestId)
    // Exactly one terminal event per turn. The renderer clears its streaming
    // state on `done`, and a second one for a turn it already closed re-enables
    // the composer mid-next-turn.
    if (!settled) emit?.({ requestId, type: 'done' })
  }
}

function commitTurn(sessionId: string, userText: string, assistantText: string): void {
  const sessions = loadSessions()
  const existing = sessions.find((s) => s.id === sessionId)
  const messages: PersistedMessage[] = [
    ...(existing?.messages ?? []),
    { role: 'user', content: userText },
    { role: 'assistant', content: assistantText }
  ]
  const now = Date.now()
  const updated: PersistedSession = {
    id: sessionId || makeSessionId(),
    title: existing?.title || deriveTitle([{ role: 'user', content: userText }]),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    providerId: existing?.providerId ?? getSettings().ai.providerId,
    model: existing?.model ?? getSettings().ai.model,
    contextFile: existing?.contextFile ?? null,
    messages
  }
  saveSessions(upsertSession(sessions, updated))
}

/** Abort a turn. Idempotent, and a no-op for an unknown id. */
export function cancelTurn(requestId: string): void {
  turns.get(requestId)?.controller.abort()
  turns.delete(requestId)
}

/** Cancel everything. Called when the panel closes and on quit. */
export function cancelAll(): void {
  for (const turn of turns.values()) turn.controller.abort()
  turns.clear()
}

// ---------------------------------------------------------------- queries

export function listChanges(sessionId?: string): ChangeView[] {
  return getJournal()
    .list(sessionId)
    .map((e) => ({
      id: e.id,
      path: e.path,
      kind: e.kind,
      createdAt: e.createdAt,
      revertedAt: e.revertedAt
    }))
}

export function readSessions(): PersistedSession[] {
  return loadSessions()
}

export function writeSession(session: PersistedSession): void {
  saveSessions(upsertSession(loadSessions(), session))
}

export function deleteSavedSession(id: string): void {
  saveSessions(removeSession(loadSessions(), id))
}
