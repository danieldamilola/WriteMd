import { app } from 'electron'
import { chatgptAuth, CHATGPT_API_BASE } from './chatgpt-auth'
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { join, dirname } from 'path'
import { ChangeJournal } from './journal'
import { runTurn, type TurnEvent } from './turn'
import { getApiKey } from './key-store'
import { PRESETS } from './providers'
import { getSettings } from '../settings'
import { getVaultPath } from '../vault'
import { requestedSkill } from './skills'
import { applyProposals } from './apply'
import { isMarkdownPath, resolveRealPath, statOrNull } from './paths'
import { registerExternalPath } from '../path-guard'
import type { FileChangeSnapshot, PreviewChangeView } from '../../shared/electron-api'
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
  selectionOnly?: boolean
  previewOnly?: boolean
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
  requestId: string
  sessionId: string
  controller: AbortController
}

const turns = new Map<string, ActiveTurn>()
const previews = new Map<string, { sessionId: string; change: PreviewChangeView }>()
const MAX_PENDING_PREVIEWS = 32

function clearPreviews(sessionId: string): void {
  for (const [id, preview] of previews) {
    if (preview.sessionId === sessionId) previews.delete(id)
  }
}

/** Accept only an unchanged proposal retained in main, then record it for undo. */
export async function acceptPreview(previewId: string): Promise<ChangeView | null> {
  const preview = previews.get(previewId)
  if (!preview) throw new Error('This suggestion has expired. Ask again for a current suggestion.')
  previews.delete(previewId)
  const { change, sessionId } = preview
  const base = getVaultPath()
  const path = resolveRealPath(change.path, base)
  if (path !== change.path || !isMarkdownPath(path)) {
    throw new Error('The suggested file path changed. Ask again for a current suggestion.')
  }
  const outcome = await applyProposals(
    [
      {
        path,
        requestedPath: path,
        before: change.original,
        after: change.content,
        blocks: [],
        failures: [],
        isCreation: change.kind === 'created'
      }
    ],
    { sessionId, base, journal: getJournal() }
  )
  if (outcome.skipped.length) throw new Error(outcome.skipped[0].detail)
  const applied = outcome.applied[0]
  if (!applied) return null
  registerExternalPath(path)
  emitFileChange?.(path, {
    before: change.original,
    content: change.content,
    mtime: statOrNull(path)?.mtimeMs ?? Date.now()
  })
  return {
    id: applied.journalId,
    path,
    kind: applied.kind,
    createdAt: Date.now(),
    revertedAt: null
  }
}

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
  } catch (error) {
    try {
      rmSync(temp, { force: true })
    } catch {
      /* nothing useful to do */
    }
    throw new Error(
      'Could not save the AI conversation. Check the available disk space and folder permissions.',
      { cause: error }
    )
  }
}

// ---------------------------------------------------------------- events

type Emitter = (event: Record<string, unknown>) => void
let emit: Emitter | null = null
let emitFileChange: ((path: string, snapshot?: FileChangeSnapshot) => void) | null = null

export function setFileChangeEmitter(
  fn: ((path: string, snapshot?: FileChangeSnapshot) => void) | null
): void {
  emitFileChange = fn
}

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
    case 'status':
      return { type: 'status', message: event.message }
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
    case 'preview':
      return { type: 'preview', changes: event.changes, skipped: event.skipped }
    case 'answer':
      return { type: 'answer', text: event.text }
    case 'error':
      return { type: 'error', message: event.message }
    case 'done':
      return { type: 'done', text: event.text }
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
  clearPreviews(input.sessionId)
  // One live turn per session. A second request for the same conversation stops
  // the first: two streams appending into one transcript produces a transcript
  // neither of them produced.
  for (const [id, turn] of turns) {
    if (turn.sessionId === input.sessionId) {
      turn.controller.abort()
      turns.delete(id)
    }
  }

  const settings = { ...getSettings().ai }
  if (!settings.enabled) throw new Error('The AI assistant is turned off in Settings.')
  if (!settings.model) throw new Error('No model selected. Open Settings and press Fetch.')
  const apiKey =
    settings.providerId === 'chatgpt' ? await chatgptAuth().accessToken() : getApiKey() || undefined
  if (settings.providerId === 'chatgpt') settings.baseUrl = CHATGPT_API_BASE
  if (PRESETS.find((preset) => preset.id === settings.providerId)?.keyRequired && !apiKey) {
    throw new Error('Add your API key in Settings before starting a chat.')
  }
  const skill = input.selectionOnly ? undefined : requestedSkill(getVaultPath(), input.userText)

  const controller = new AbortController()
  turns.set(requestId, { requestId, sessionId: input.sessionId, controller })

  const existing = loadSessions().find((s) => s.id === input.sessionId)
  const history = (existing?.messages ?? []).map((m) => ({ role: m.role, content: m.content }))

  const send = (event: TurnEvent): void => {
    if (event.type === 'preview') {
      event = {
        ...event,
        changes: event.changes.map((change) => {
          const previewId = randomUUID()
          previews.set(previewId, { sessionId: input.sessionId, change: { ...change } })
          while (previews.size > MAX_PENDING_PREVIEWS) {
            previews.delete(previews.keys().next().value!)
          }
          return { ...change, previewId }
        })
      }
    } else if (event.type === 'applied') {
      for (const change of event.outcome.applied) {
        registerExternalPath(change.path)
        const entry = getJournal()
          .list(input.sessionId)
          .find((entry) => entry.id === change.journalId)
        emitFileChange?.(
          change.path,
          entry
            ? {
                before: entry.before,
                content: entry.after,
                mtime: statOrNull(change.path)?.mtimeMs ?? Date.now()
              }
            : undefined
        )
      }
    }
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
      apiKey,
      userText: input.userText,
      skill,
      previewOnly: input.previewOnly === true,
      history: input.selectionOnly ? [] : history,
      historyTurns: settings.historyTurns,
      maxTokens: settings.maxOutputTokens > 0 ? settings.maxOutputTokens : undefined,
      context: {
        selectionOnly: input.selectionOnly === true,
        document:
          !input.selectionOnly && input.document
            ? {
                ...input.document,
                content:
                  input.previewOnly && input.selection ? input.selection : input.document.content,
                isOpen: true
              }
            : null,
        selection: input.selection,
        references: input.selectionOnly ? [] : input.references,
        attachments: input.selectionOnly ? [] : input.attachments,
        openPaths: input.selectionOnly ? [] : input.openPaths,
        base: getVaultPath()
      },
      journal: getJournal(),
      signal: controller.signal
    })) {
      if (controller.signal.aborted || turns.get(requestId)?.controller !== controller) break
      // Commit as soon as the model finishes, so a crash after this point does
      // not cost the exchange.
      if (event.type === 'done') {
        try {
          commitTurn(input.sessionId, input.userText, event.text, {
            providerId: settings.providerId,
            model: settings.model,
            contextFile: input.document?.path ?? null
          })
        } catch (error) {
          // The response and file changes still happened. Preserve the readable
          // reply before reporting that saving its conversation failed.
          send({ type: 'answer', text: event.text })
          throw error
        }
        settled = true
      }
      send(event)
    }
  } catch (err) {
    if (!controller.signal.aborted)
      emit?.({
        requestId,
        type: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
  } finally {
    if (turns.get(requestId)?.controller === controller) turns.delete(requestId)
    // Exactly one terminal event per turn. The renderer clears its streaming
    // state on `done`, and a second one for a turn it already closed re-enables
    // the composer mid-next-turn.
    if (!settled && !controller.signal.aborted) emit?.({ requestId, type: 'done' })
  }
}

function commitTurn(
  sessionId: string,
  userText: string,
  assistantText: string,
  metadata: Pick<PersistedSession, 'providerId' | 'model' | 'contextFile'>
): void {
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
    ...metadata,
    messages
  }
  saveSessions(upsertSession(sessions, updated))
}

/** Abort a turn. Idempotent, and a no-op for an unknown id. */
export function cancelTurn(requestId: string): void {
  const turn = turns.get(requestId)
  if (turn) clearPreviews(turn.sessionId)
  turns.get(requestId)?.controller.abort()
  turns.delete(requestId)
}

/**
 * Cancel everything. Called when the panel closes and on quit.
 *
 * Each aborted turn gets its one terminal event here, because the run loop
 * deliberately skips emitting `done` for an aborted turn. That is right for a
 * user pressing Stop, where the renderer has already cleared its own busy state,
 * but it strands any visible turn when the cancel comes from main alone - a
 * sign-out or an account switch. Without this the composer stays disabled until
 * the app is restarted.
 */
export function cancelAll(): void {
  const cancelled = [...turns.values()]
  for (const turn of cancelled) turn.controller.abort()
  turns.clear()
  previews.clear()
  for (const turn of cancelled) {
    emit?.({ requestId: turn.requestId, type: 'done' })
  }
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
  clearPreviews(id)
  for (const [requestId, turn] of turns) {
    if (turn.sessionId === id) cancelTurn(requestId)
  }
  saveSessions(removeSession(loadSessions(), id))
}
