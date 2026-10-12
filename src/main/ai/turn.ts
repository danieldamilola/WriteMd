import { adapterFor } from './providers'
import {
  applyEdits,
  parseEdits,
  resolveRequestedPath,
  type ApplyResult,
  type FileProposal
} from './edit-protocol'
import { applyProposals, type ApplyOutcome } from './apply'
import type { ChangeJournal } from './journal'
import { resolveRealPath } from './paths'
import { checkEndpoint } from './endpoint'
import {
  buildTurnMessages,
  messageToText,
  type Attachment,
  type PriorTurn,
  type TurnContext
} from './turn-messages'

/**
 * One exchange with the model.
 *
 * Send, stream, then parse. The model is never given a tool to call - it emits
 * edit blocks as text - so there is no agent loop here and no step limit to get
 * wrong. The shape is deliberately the shortest one that does the job:
 *
 *   send -> collect text -> parse blocks -> apply to disk -> report
 *
 * If the model answered instead of editing, the text is the answer and nothing
 * is written. If it emitted blocks that do not match the files, those files are
 * skipped rather than half-written. Both are normal outcomes, not errors, and
 * the transcript says which happened rather than leaving a silent no-op.
 */

export interface RunTurnRequest {
  sessionId: string
  providerId: string
  baseUrl: string
  model: string
  /** Read from the key store by the caller; never from the renderer. */
  apiKey?: string
  userText: string
  context: TurnContext
  history: PriorTurn[]
  historyTurns: number
  journal: ChangeJournal
  signal: AbortSignal
  maxTokens?: number
  temperature?: number
}

export type TurnEvent =
  | { type: 'text'; delta: string }
  /** Proposed edits, before anything is written. */
  | { type: 'proposal'; apply: ApplyResult }
  | { type: 'applied'; outcome: ApplyOutcome }
  /** The model answered instead of editing. */
  | { type: 'answer'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done'; text: string }

export interface RunTurnResult {
  /** Proposed edits, for the transcript and for the change list. */
  proposals: FileProposal[]
  outcome: ApplyOutcome | null
  /** Everything the model said. */
  text: string
}

/** Read each target once, keyed by canonical path. A missing file is `exists: false`. */
async function readTargets(
  paths: readonly string[]
): Promise<Map<string, { content: string; exists: boolean }>> {
  const { readFile } = await import('fs/promises')
  const map = new Map<string, { content: string; exists: boolean }>()
  await Promise.all(
    paths.map(async (path) => {
      try {
        map.set(path, { content: await readFile(path, 'utf-8'), exists: true })
      } catch {
        map.set(path, { content: '', exists: false })
      }
    })
  )
  return map
}

/**
 * Resolve a path the model wrote, or null when it is not usable.
 *
 * A model will occasionally emit a path that does not exist, a URL, or a bare
 * word. Those become "no proposal for this file" rather than an exception that
 * takes down the turn - a typo in a path should cost one edit, not the answer.
 */
function makeResolver(base: string): (requested: string) => string | null {
  return (requested: string): string | null => {
    const joined = resolveRequestedPath(requested, base)
    if (!joined) return null
    try {
      return resolveRealPath(joined, base)
    } catch {
      return null
    }
  }
}

/**
 * Run one turn, emitting events as it goes.
 *
 * Streaming is emitted as it arrives so the transcript fills in live. The edits
 * are applied only after the whole response is in, because a block can be
 * applied on its own and a truncated stream would otherwise produce a partial
 * rewrite.
 */
export async function* runTurn(request: RunTurnRequest): AsyncGenerator<TurnEvent> {
  const adapter = adapterFor(request.providerId)
  if (!adapter) {
    yield { type: 'error', message: `Unknown provider: ${request.providerId}` }
    return
  }

  // The key is passed in rather than read here so the caller decides which one
  // applies, and so the insecure-endpoint check actually has something to check.
  // Passing undefined would silently skip it.
  const check = checkEndpoint(request.baseUrl, request.model, request.apiKey)
  if (!check.ok) {
    yield { type: 'error', message: check.message ?? 'The AI endpoint is not usable.' }
    return
  }

  const { system, messages } = buildTurnMessages({
    context: request.context,
    userText: request.userText,
    history: request.history,
    historyTurns: request.historyTurns
  })

  let text = ''
  let failed = false
  try {
    for await (const event of adapter.stream({
      baseUrl: request.baseUrl,
      apiKey: request.apiKey,
      model: request.model,
      messages,
      system,
      maxTokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.4,
      signal: request.signal
    })) {
      if (event.type === 'text') {
        text += event.delta
        yield { type: 'text', delta: event.delta }
      } else if (event.type === 'error') {
        failed = true
        yield { type: 'error', message: event.message }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // An abort is the user's own doing and should read as a stop, not a fault.
    if (request.signal.aborted) {
      yield { type: 'done', text }
      return
    }
    yield { type: 'error', message }
    return
  }

  if (failed) return

  const parsed = parseEdits(text, request.context.document?.path ?? '')
  if (!parsed.hasEdits) {
    yield { type: 'answer', text: parsed.explanation || text }
    yield { type: 'done', text }
    return
  }

  const base = request.context.base
  const resolve = makeResolver(base)
  // Resolve first, then read exactly the files that survived resolution. A path
  // the model made up costs nothing rather than a spurious "file not found".
  const targets = [
    ...new Set(parsed.blocks.map((b) => resolve(b.path)).filter((p): p is string => p !== null))
  ]
  const apply = applyEdits(parsed, await readTargets(targets), resolve)
  yield { type: 'proposal', apply }

  let outcome: ApplyOutcome
  try {
    outcome = await applyProposals(apply.proposals, {
      sessionId: request.sessionId,
      base,
      journal: request.journal
    })
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
    return
  }
  yield { type: 'applied', outcome }
  yield { type: 'done', text }
}

/** Non-streaming convenience wrapper, for tests and for the inline actions. */
export async function runTurnCollected(request: RunTurnRequest): Promise<RunTurnResult> {
  let text = ''
  let outcome: ApplyOutcome | null = null
  const proposals: FileProposal[] = []
  for await (const event of runTurn(request)) {
    if (event.type === 'text') text += event.delta
    else if (event.type === 'proposal') proposals.push(...event.apply.proposals)
    else if (event.type === 'applied') outcome = event.outcome
    else if (event.type === 'error') throw new Error(event.message)
  }
  return { proposals, outcome, text }
}

export { messageToText }
export type { Attachment, PriorTurn, TurnContext }
