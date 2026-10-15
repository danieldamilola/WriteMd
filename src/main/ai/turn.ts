import { adapterFor } from './providers'
import type { ModelOptions } from '../../shared/ai/model-options'
import { NATIVE_TOOL_MARKUP_ERROR } from './providers/native-tool-markup'
import {
  applyEdits,
  parseEdits,
  resolveRequestedPath,
  type ApplyResult,
  type FileProposal
} from './edit-protocol'
import { applyProposals, type ApplyOutcome } from './apply'
import type { ChangeJournal } from './journal'
import { isMarkdownPath, resolveRealPath } from './paths'
import type { PreviewChangeView } from '../../shared/electron-api'
import type { SkippedFile } from './apply'
import { checkEndpoint } from './endpoint'
import type { ProviderMetadata, StopReason, ToolCall } from '../../shared/ai/types'
import { WEB_SEARCH_TOOL, searchWeb } from './web-search'
import { requestsDocumentDraft } from './instructions'
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
 * The model can search the web before answering. Tool rounds and calls are
 * bounded, and only a completed terminal response can propose document edits.
 *
 * If the model answered instead of editing, the text is the answer and nothing
 * is written. If it emitted blocks that do not match the files, those files are
 * skipped rather than half-written. Both are normal outcomes, not errors, and
 * the transcript says which happened rather than leaving a silent no-op.
 */

export interface RunTurnRequest {
  modelOptions?: ModelOptions
  previewOnly?: boolean
  sessionId: string
  providerId: string
  baseUrl: string
  model: string
  /** Read from the key store by the caller; never from the renderer. */
  apiKey?: string
  userText: string
  skill?: { name: string; instructions: string }
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
  | { type: 'status'; message: string }
  /** Proposed edits, before anything is written. */
  | { type: 'proposal'; apply: ApplyResult }
  | { type: 'applied'; outcome: ApplyOutcome }
  | { type: 'preview'; changes: PreviewChangeView[]; skipped: SkippedFile[] }
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

const MAX_MODEL_ROUNDS = 3
const MAX_TOOL_CALLS = 3

function toolFailure(message: string): string {
  return JSON.stringify({ untrusted: true, error: message })
}

function rejectsToolSupport(message: string): boolean {
  if (message === NATIVE_TOOL_MARKUP_ERROR) return true
  if (
    /\b(?:401|403|unauthori[sz]ed|forbidden|authentication|invalid api key|incorrect api key|permission denied)\b/i.test(
      message
    )
  )
    return false
  const text = message.replace(/\s+/g, ' ')
  const tool = '(?:tools?|tool[_ -]?calls?|tool[_ -]?use|function[_ -]?call(?:ing|s)?)'
  return new RegExp(
    `(?:does not|do not|doesn't|cannot|can't) support.{0,80}${tool}|${tool}.{0,80}(?:not supported|unsupported)|unsupported.{0,40}${tool}|(?:unknown|unrecognized) parameter.{0,20}["']?tools`,
    'i'
  ).test(text)
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
 *
 * Markdown files can live anywhere. Relative paths use the vault as their base;
 * absolute paths keep the file's original location.
 */
function makeResolver(base: string): (requested: string) => string | null {
  return (requested: string): string | null => {
    const joined = resolveRequestedPath(requested, base)
    if (!joined || !isMarkdownPath(joined)) return null
    try {
      const canonical = resolveRealPath(joined, base)
      return isMarkdownPath(canonical) ? canonical : null
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
  if (request.signal.aborted) return
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

  const { system: baseSystem, messages } = buildTurnMessages({
    context: request.context,
    userText: request.userText,
    skill: request.skill,
    history: request.history,
    historyTurns: request.historyTurns
  })
  const system = request.previewOnly
    ? `${baseSystem}\n\nPropose edits only to the provided document snapshot. When a selection is provided, the snapshot contains only that selection. Do not edit other files or create files. The user will review the proposed replacement before accepting it.`
    : baseSystem
  const draftRequired =
    !!request.context.document &&
    !request.context.selectionOnly &&
    requestsDocumentDraft(request.userText)

  let text = ''
  let toolCount = 0
  let terminal = false
  let toolsUnsupported = false
  let nativeRecovery = false
  let draftRetried = false
  try {
    for (let round = 0; round < MAX_MODEL_ROUNDS; round++) {
      if (request.signal.aborted) return
      text = ''
      let emittedText = 0
      let editing = false
      let failed = false
      const errors: string[] = []
      let stopReason: StopReason | null = null
      let providerMetadata: ProviderMetadata | undefined
      const calls: ToolCall[] = []
      const toolsEnabled =
        !request.context.selectionOnly &&
        !draftRetried &&
        !(request.previewOnly && request.context.selection) &&
        !toolsUnsupported &&
        round < MAX_MODEL_ROUNDS - 1 &&
        toolCount < MAX_TOOL_CALLS
      try {
        for await (const event of adapter.stream({
          providerId: request.providerId,
          modelOptions: request.modelOptions,
          sessionId: request.sessionId,
          baseUrl: request.baseUrl,
          apiKey: request.apiKey,
          model: request.model,
          messages,
          system: toolsEnabled
            ? system
            : `${system}\n\nNo tools are available for this response. The document contents are already supplied. Answer from the supplied context, or prepare the requested changes using plain-text SEARCH/REPLACE or REWRITE blocks. Do not output tool calls or native tool markup. If fresh sources are required and none were retrieved, say that web search was unavailable.`,
          maxTokens: request.maxTokens,
          temperature: request.temperature ?? 0.4,
          signal: request.signal,
          tools: toolsEnabled ? [WEB_SEARCH_TOOL] : undefined,
          ...(nativeRecovery ? { disableThinking: true } : {})
        })) {
          if (request.signal.aborted) return
          if (event.type === 'text') {
            text += event.delta
            if (request.context.selectionOnly) {
              yield { type: 'text', delta: event.delta }
            } else if (!editing) {
              const header = /^<<<<<<<[ \t]*(?:SEARCH|REWRITE)\b/m.exec(text)
              // Hold a fragmented header until we know whether it is prose.
              const partial = /(?:^|\n)(<{1,7}[ \t]*[A-Z]*)$/.exec(text)
              const end = header?.index ?? (partial ? text.length - partial[1].length : text.length)
              if (end > emittedText) {
                yield { type: 'text', delta: text.slice(emittedText, end) }
                emittedText = end
              }
              if (header) {
                editing = true
                yield { type: 'status', message: 'Preparing the edit…' }
              }
            }
          } else if (event.type === 'tool-call') {
            calls.push(event.call)
          } else if (event.type === 'error') {
            failed = true
            errors.push(event.message)
          } else if (event.type === 'done') {
            stopReason = event.stopReason
            providerMetadata = event.providerMetadata
            if (event.stopReason === 'max_tokens') {
              failed = true
              yield {
                type: 'error',
                message: `The response reached ${
                  request.maxTokens
                    ? `the ${request.maxTokens.toLocaleString('en-US')}-token output limit`
                    : "the provider's output limit"
                }. No edits were applied. Increase Output limit in AI Settings or write in smaller sections.`
              }
            } else if (event.stopReason === 'error' && !failed) {
              failed = true
              errors.push('The provider could not complete the response. No edits were applied.')
            }
          }
        }
      } catch (error) {
        if (request.signal.aborted) throw error
        failed = true
        errors.push(error instanceof Error ? error.message : String(error))
      }
      if (request.signal.aborted) return
      if (failed) {
        const nativeFailure =
          errors.length > 0 && errors.every((message) => message === NATIVE_TOOL_MARKUP_ERROR)
        if (nativeFailure && !calls.length && stopReason !== 'max_tokens') {
          if (!nativeRecovery && round < MAX_MODEL_ROUNDS - 1) {
            nativeRecovery = true
            toolsUnsupported = true
            yield { type: 'status', message: 'Retrying the response without tools…' }
            continue
          }
          yield {
            type: 'error',
            message:
              'The model could not return a usable response after retrying. No edits were applied. Try again or choose another model.'
          }
          return
        }
        if (
          toolsEnabled &&
          !text.length &&
          !calls.length &&
          stopReason !== 'max_tokens' &&
          errors.length > 0 &&
          errors.every(rejectsToolSupport)
        ) {
          toolsUnsupported = true
          yield {
            type: 'status',
            message: 'This model cannot search the web. Continuing without web search.'
          }
          continue
        }
        for (const message of errors) yield { type: 'error', message }
        return
      }
      if (!stopReason) {
        yield {
          type: 'error',
          message: 'The response ended before it was complete. No edits were applied. Try again.'
        }
        return
      }

      if (!calls.length && stopReason !== 'tool_calls') {
        if (draftRequired && !parseEdits(text, request.context.document!.path).hasEdits) {
          if (draftRetried || round === MAX_MODEL_ROUNDS - 1) {
            yield {
              type: 'error',
              message:
                'The model replied in chat instead of preparing an edit to your note. Nothing was changed. Try again.'
            }
            return
          }
          draftRetried = true
          messages.push({ role: 'assistant', content: text })
          messages.push({
            role: 'user',
            content:
              'The user asked you to write content into the open note. Convert your draft into edit blocks for that note. For a local change or addition, SEARCH only the smallest unique affected passage or final paragraph and preserve the rest of the note. For an explicitly requested whole-document rewrite, use REWRITE with only the new document. If the note is empty, leave SEARCH empty and put the draft in REPLACE. Output edit blocks only.'
          })
          yield { type: 'status', message: 'Preparing the draft for your note…' }
          continue
        }
        terminal = true
        break
      }
      if (!calls.length) {
        yield {
          type: 'error',
          message: 'The provider requested a tool without a usable call. Try again.'
        }
        return
      }
      if (!toolsEnabled || toolCount + calls.length > MAX_TOOL_CALLS) {
        yield {
          type: 'error',
          message: request.context.selectionOnly
            ? 'Tools are unavailable for selection actions. Try again or choose another model.'
            : 'The assistant reached the web search limit. Try a more focused request.'
        }
        return
      }

      messages.push({
        role: 'assistant',
        content: text,
        toolCalls: calls,
        ...(providerMetadata ? { providerMetadata } : {})
      })
      for (const call of calls) {
        if (request.signal.aborted) return
        toolCount++
        let content: string
        if (call.name !== WEB_SEARCH_TOOL.name) {
          content = toolFailure(`Unsupported tool: ${call.name}`)
          yield {
            type: 'status',
            message: 'The requested tool is unavailable. Continuing without it.'
          }
        } else if (typeof call.arguments.query !== 'string' || !call.arguments.query.trim()) {
          content = toolFailure('Web search requires a non-empty query.')
          yield {
            type: 'status',
            message: 'The web search query was empty. Continuing without web results.'
          }
        } else {
          const query = call.arguments.query.trim()
          yield { type: 'status', message: `Searching the web for ${query}…` }
          if (request.signal.aborted) return
          try {
            const results = await searchWeb(query, request.signal)
            if (request.signal.aborted) return
            content = JSON.stringify({ untrusted: true, source: 'web_search', query, results })
          } catch (error) {
            if (request.signal.aborted) return
            const message = error instanceof Error ? error.message : String(error)
            content = toolFailure(`Web search failed: ${message.slice(0, 1000)}`)
            yield {
              type: 'status',
              message: 'Web search is unavailable. Continuing without web results.'
            }
          }
        }
        if (request.signal.aborted) return
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content })
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

  if (request.signal.aborted) return
  if (!terminal) {
    yield {
      type: 'error',
      message: 'The assistant reached the web search limit. Try a more focused request.'
    }
    return
  }

  if (!text.trim()) {
    yield {
      type: 'error',
      message: 'The model returned an empty response. Try again or choose another model.'
    }
    return
  }

  const parsed = parseEdits(text, request.context.document?.path ?? '')
  if (parsed.incomplete) {
    yield {
      type: 'error',
      message: 'The edit ended before it was complete. No edits were applied. Try again.'
    }
    return
  }
  if (request.context.selectionOnly || !parsed.hasEdits) {
    yield { type: 'answer', text: parsed.explanation || text }
    yield { type: 'done', text }
    return
  }

  const base = request.context.base
  const resolve = makeResolver(base)
  const snapshots = new Map<string, string>()
  for (const document of [request.context.document, ...request.context.references]) {
    if (!document) continue
    const path = resolve(document.path)
    if (path && !snapshots.has(path)) snapshots.set(path, document.content)
  }
  if (request.previewOnly) {
    /*
     * Preview every requested Markdown file, including external files. The
     * user reviews each change before anything is written.
     */
    const document = request.context.document
    const openPath = document ? resolve(document.path) : null
    const contents = new Map<string, { content: string; exists: boolean }>()
    if (openPath) contents.set(openPath, { content: document!.content, exists: true })

    const targets = new Set<string>()
    for (const block of parsed.blocks) {
      const target = resolve(block.path)
      if (target && !contents.has(target)) targets.add(target)
    }
    for (const [path, source] of await readTargets([...targets])) contents.set(path, source)

    const apply = applyEdits(parsed, contents, resolve, snapshots)
    const skipped: SkippedFile[] = []
    const changes: PreviewChangeView[] = []
    for (const proposal of apply.proposals) {
      if (proposal.failures.length) {
        skipped.push({
          path: proposal.path,
          reason: proposal.failures.some((failure) => failure.reason === 'ambiguous')
            ? 'ambiguous'
            : 'block-failed',
          detail: 'The proposed edit did not match the file exactly. Try again.'
        })
      } else if (
        Buffer.byteLength(proposal.after, 'utf8') > 2 * 1024 * 1024 ||
        Buffer.byteLength(proposal.before, 'utf8') > 2 * 1024 * 1024
      ) {
        skipped.push({
          path: proposal.path,
          reason: 'too-large',
          detail: 'The edit preview exceeds the 2 MB limit.'
        })
      } else if (proposal.after !== proposal.before) {
        changes.push({
          path: proposal.path,
          original: proposal.before,
          content: proposal.after,
          kind: proposal.isCreation ? 'created' : 'modified'
        })
      }
    }
    for (const block of parsed.blocks) {
      if (resolve(block.path)) continue
      skipped.push({
        path: block.path,
        reason: 'unreadable',
        detail: 'Only Markdown files with a usable path can be edited.'
      })
    }
    if (request.signal.aborted) return
    yield { type: 'preview', changes, skipped }
    const answer =
      parsed.explanation ||
      (changes.length
        ? 'Review the suggested change before accepting it.'
        : 'No changes were suggested.')
    yield { type: 'answer', text: answer }
    yield { type: 'done', text: answer }
    return
  }
  // Resolve first, then read exactly the files that survived resolution. A path
  // the model made up costs nothing rather than a spurious "file not found".
  const targets = [
    ...new Set(parsed.blocks.map((b) => resolve(b.path)).filter((p): p is string => p !== null))
  ]
  const apply = applyEdits(parsed, await readTargets(targets), resolve, snapshots)
  if (request.signal.aborted) return
  yield { type: 'proposal', apply }

  let outcome: ApplyOutcome
  try {
    if (request.signal.aborted) return
    outcome = await applyProposals(apply.proposals, {
      sessionId: request.sessionId,
      base,
      journal: request.journal,
      signal: request.signal
    })
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
    return
  }
  yield { type: 'applied', outcome }
  // The text carried forward is the model's prose, not its protocol. The
  // streamed deltas were provisional; this is the authoritative version, and
  // the same one that goes into the saved session. Handing back the raw
  // response would put a wall of <<<<<<< SEARCH in the transcript and in
  // every saved conversation, which is not something a person wrote or wants
  // to read back.
  yield {
    type: 'done',
    text:
      parsed.explanation ||
      (outcome.applied.length ? 'Applied the requested change.' : 'No changes were applied.')
  }
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
    else if (event.type === 'done') text = event.text
  }
  return { proposals, outcome, text }
}

export { messageToText }
export type { Attachment, PriorTurn, TurnContext }
