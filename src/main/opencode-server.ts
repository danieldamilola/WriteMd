import { execFile, spawn, type ChildProcess } from 'child_process'
import { createServer } from 'net'
import { net } from 'electron'
import { psCommand } from './opencode'

/**
 * Managed `opencode serve` + HTTP client.
 *
 * `opencode run` re-parses argv through `cmd.exe /c` on Windows (prompt
 * metacharacters break it) and boots a whole agent runtime per message. A
 * single `serve` child answers every prompt over HTTP with the user's own CLI
 * auth, and dies with the app.
 */

export const MINIMUM_OPENCODE_VERSION = '1.14.19'
const SERVER_READY_PREFIX = 'opencode server listening'
const SERVER_START_TIMEOUT_MS = 30000
const CHAT_TIMEOUT_MS = 180000

export interface OpenCodeModelRef {
  providerID: string
  modelID: string
}

/** `provider/model` → ref. Everything after the first `/` is the model id. */
export function parseOpenCodeModelSlug(slug: string | null | undefined): OpenCodeModelRef | null {
  if (typeof slug !== 'string') return null
  const trimmed = slug.trim()
  const sep = trimmed.indexOf('/')
  if (sep <= 0 || sep === trimmed.length - 1) return null
  return { providerID: trimmed.slice(0, sep), modelID: trimmed.slice(sep + 1) }
}

/** First `x.y.z` in `opencode --version` output. */
export function parseOpenCodeVersion(output: string): string | null {
  const match = output.match(/\d+\.\d+\.\d+/)
  return match?.[0] ?? null
}

export function compareSemver(left: string, right: string): number {
  const a = left.split('.').map((p) => Number.parseInt(p, 10) || 0)
  const b = right.split('.').map((p) => Number.parseInt(p, 10) || 0)
  for (let i = 0; i < 3; i += 1) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

/** `opencode server listening on http://127.0.0.1:4096` → the URL. */
export function parseServerUrlFromOutput(output: string): string | null {
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.toLowerCase().includes('listening')) continue
    const match = trimmed.match(/on\s+(https?:\/\/[^\s]+)/i)
    if (match?.[1]) return match[1].replace(/[.,;]+$/, '')
    if (trimmed.startsWith(SERVER_READY_PREFIX)) {
      const fallback = trimmed.match(/(https?:\/\/[^\s]+)/i)
      if (fallback?.[1]) return fallback[1].replace(/[.,;]+$/, '')
    }
  }
  return null
}

/**
 * Fold a completed part snapshot into the running text. A snapshot that
 * extends what streamed already wins; an older/overlapping one keeps the
 * longer text we have.
 */
function mergeSnapshot(previous: string | undefined, snapshot: string): string {
  if (!previous) return snapshot
  if (previous.length > snapshot.length && previous.startsWith(snapshot)) return previous
  return snapshot
}

interface OpenCodePart {
  id?: unknown
  type?: unknown
  messageID?: unknown
  text?: unknown
}

function partText(part: OpenCodePart): string | null {
  if (part.type !== 'text' || typeof part.text !== 'string') return null
  return part.text
}

/**
 * Remove agentic tool-call markup agent models emit when they try to act
 * (`<tool_call>…`, `<invoke…>…</invoke>`, `[<tool-call>]`-style bracket tags
 * and their lines). Sessions run deny-all so nothing executes; this keeps the
 * transcript readable. Plain markdown (including code blocks) passes through.
 */
export function stripToolArtifacts(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (!t) return true
      if (/<\/?(tool_call|toolcall|invoke|function_calls?|command|timeout)\b/i.test(t)) return false
      if (/\[<\/?(tool-call|invoke|command|timeout)[^\]]*\]/i.test(t)) return false
      // Bracket-prefixed tool chatter, e.g. `[minimax][<tool-call>]…`.
      if (/^\[(?:minimax|[a-z0-9_-]+)\]\s*\[</i.test(t)) return false
      return true
    })
    .join('\n')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<invoke[\s>][\s\S]*?<\/invoke>/gi, '')
    .replace(/<function_calls?>[\s\S]*?<\/function_calls?>/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

/**
 * Assistant text out of a blocking `POST /session/:id/message` response
 * (`{ info, parts }`). Parts carry no role, so when the response is not
 * clearly the assistant message the caller falls back to the messages list.
 */
export function extractAssistantTextFromMessage(data: unknown): string {
  const rec = data as { info?: { role?: unknown }; parts?: unknown } | null
  if (!rec || typeof rec !== 'object') return ''
  if (rec.info && rec.info.role !== undefined && rec.info.role !== 'assistant') return ''
  if (!Array.isArray(rec.parts)) return ''
  return rec.parts
    .map((p) => partText(p as OpenCodePart))
    .filter((t): t is string => t !== null)
    .join('')
}

/**
 * Incremental SSE assembly for one session. Deltas (`message.part.delta`)
 * append per part; completed snapshots (`message.part.updated`) contribute
 * only their unseen suffix. Deltas racing ahead of the role announcement are
 * held until the part is known-assistant, so tool chatter never leaks into
 * the transcript.
 */
export class OpencodeStreamAssembler {
  private emittedByPart = new Map<string, string>()
  private currentByPart = new Map<string, string>()
  private messageByPart = new Map<string, string>()
  private messageRole = new Map<string, string>()
  private full = ''
  private readonly targetSessionId?: string

  constructor(targetSessionId?: string) {
    this.targetSessionId = targetSessionId
  }

  get fullText(): string {
    return this.full
  }

  /** Returns the delta text to forward, '' for control frames. */
  feedEvent(event: unknown): string {
    const ev = event as { type?: unknown; properties?: unknown } | null
    if (!ev || typeof ev !== 'object' || typeof ev.type !== 'string') return ''
    const props = (ev.properties ?? {}) as Record<string, unknown>

    if (ev.type === 'message.updated') {
      const info = (props.info ?? {}) as Record<string, unknown>
      if (
        this.targetSessionId &&
        typeof info.sessionID === 'string' &&
        info.sessionID !== this.targetSessionId
      ) {
        return ''
      }
      if (typeof info.id === 'string' && (info.role === 'assistant' || info.role === 'user')) {
        this.messageRole.set(info.id, info.role)
        if (info.role === 'assistant') return this.flushMessage(info.id)
      }
      return ''
    }
    if (ev.type === 'message.part.updated') {
      const part = (props.part ?? {}) as Record<string, unknown>
      if (
        this.targetSessionId &&
        typeof part.sessionID === 'string' &&
        part.sessionID !== this.targetSessionId
      ) {
        return ''
      }
      if (part.type !== 'text' || typeof part.text !== 'string') return ''
      const id = typeof part.id === 'string' ? part.id : null
      if (!id) return ''
      const messageId = typeof part.messageID === 'string' ? part.messageID : null
      if (messageId) this.messageByPart.set(id, messageId)
      // Snapshot supersedes anything streamed so far for this part.
      this.currentByPart.set(id, mergeSnapshot(this.currentByPart.get(id), part.text))
      if (!messageId || this.messageRole.get(messageId) !== 'assistant') return ''
      return this.emitCurrent(id)
    }
    if (ev.type === 'message.part.delta') {
      const partId = typeof props.partID === 'string' ? props.partID : null
      const delta = typeof props.delta === 'string' ? props.delta : ''
      if (!partId || !delta) return ''
      this.currentByPart.set(partId, (this.currentByPart.get(partId) ?? '') + delta)
      const messageId = this.messageByPart.get(partId)
      if (!messageId || this.messageRole.get(messageId) !== 'assistant') return ''
      return this.emitCurrent(partId)
    }
    return ''
  }

  /** True when this event ends the turn for the given session. */
  static isIdleFor(event: unknown, sessionId: string): boolean {
    const ev = event as { type?: unknown; properties?: unknown } | null
    if (!ev || ev.type !== 'session.status') return false
    const props = (ev.properties ?? {}) as Record<string, unknown>
    if (props.sessionID !== sessionId) return false
    return (props.status as Record<string, unknown> | undefined)?.type === 'idle'
  }

  /** Session-scoped error text, if this event reports one. */
  static sessionError(event: unknown, sessionId: string): string | null {
    const ev = event as { type?: unknown; properties?: unknown } | null
    if (!ev || ev.type !== 'session.error') return null
    const props = (ev.properties ?? {}) as Record<string, unknown>
    if (props.sessionID !== sessionId || !props.error) return null
    const err = props.error as Record<string, unknown>
    const data = err.data as Record<string, unknown> | undefined
    const message =
      (typeof data?.message === 'string' && data.message) ||
      (typeof err.name === 'string' && err.name) ||
      'opencode reported an error'
    return message
  }

  private emitCurrent(partId: string): string {
    const current = this.currentByPart.get(partId) ?? ''
    const previous = this.emittedByPart.get(partId) ?? ''
    if (current === previous) return ''
    // A snapshot repeating streamed tokens emits only the unseen tail; a
    // wholly new snapshot (e.g. after a tool) emits in full.
    const delta = current.startsWith(previous) ? current.slice(previous.length) : current
    this.emittedByPart.set(partId, current)
    this.full += delta
    return delta
  }

  /** Late role arrival: flush everything buffered for that message. */
  private flushMessage(messageId: string): string {
    let out = ''
    for (const [partId, mapped] of this.messageByPart) {
      if (mapped === messageId) out += this.emitCurrent(partId)
    }
    return out
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

let serverChild: ChildProcess | null = null
let serverUrl: string | null = null
let serverStarting: Promise<string> | null = null

/** Managed server URL, starting `opencode serve` on first use. */
export async function ensureOpencodeServer(bin: string, version: string | null): Promise<string> {
  if (serverUrl && serverChild && !serverChild.killed && serverChild.exitCode === null) {
    return serverUrl
  }
  // Deliberately not clearing `serverUrl` here. It used to be nulled before the
  // await below, and then reassigned from `serverStarting` - so a child that died
  // while that promise was still held had its dead URL written back after the
  // liveness guard had already run, leaving `isManagedServerUp()` true for a
  // server that was gone. The exit handler clears it instead.
  serverChild = null
  if (!serverStarting) {
    serverStarting = startOpencodeServer(bin, version).finally(() => {
      serverStarting = null
    })
  }
  const url = await serverStarting
  serverUrl = url
  return url
}

/** True while our managed server is alive (user-run :4096 excluded). */
export function isManagedServerUp(): boolean {
  return (
    serverUrl !== null &&
    serverChild !== null &&
    !serverChild.killed &&
    serverChild.exitCode === null
  )
}

/**
 * Kill the managed server; called on app quit. The server is a grandchild
 * (powershell → opencode), so plain kill() would orphan it - take down the
 * whole tree with taskkill on Windows.
 */
export function stopOpencodeServer(): void {
  const child = serverChild
  serverChild = null
  serverUrl = null
  // Cached sessions belong to the server that is going away. Keeping them meant
  // every turn after a restart paid a 404 plus a retry before succeeding.
  sessionsByDir.clear()
  if (!child || child.killed) return
  try {
    child.kill()
  } catch {
    // already gone
  }
  if (process.platform === 'win32' && child.pid !== undefined) {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
  }
}

async function startOpencodeServer(bin: string, version: string | null): Promise<string> {
  // The stored version is whatever `--version` printed, so it can arrive as
  // `opencode v2.3.1` rather than a bare semver. Comparing that unparsed made
  // `compareSemver` read `v2` as NaN, score it 0, and refuse to start a current
  // CLI with "OpenCode vv2.3.1 is too old".
  const parsed = version ? parseOpenCodeVersion(version) : null
  if (parsed && compareSemver(parsed, MINIMUM_OPENCODE_VERSION) < 0) {
    throw new Error(
      `OpenCode v${parsed} is too old. Upgrade to v${MINIMUM_OPENCODE_VERSION} or newer.`
    )
  }
  const port = await freePort()
  const args = ['serve', '--hostname=127.0.0.1', `--port=${port}`]
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
  const child = needsShell
    ? spawn('powershell.exe', psCommand(bin, args), { windowsHide: true })
    : spawn(bin, args, { windowsHide: true })
  serverChild = child

  return new Promise((resolve, reject) => {
    // Both streams feed the ready-line scan. A shim that prints its banner to
    // stderr is common enough that reading only stdout turned a clear startup
    // error into "exited with code 1" with the message discarded.
    let output = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // already exited
      }
      serverChild = null
      serverUrl = null
      reject(new Error('Timed out waiting for `opencode serve` to listen (30s).'))
    }, SERVER_START_TIMEOUT_MS)

    const onData = (chunk: Buffer): void => {
      output += chunk.toString('utf-8')
      const url = parseServerUrlFromOutput(output)
      if (url) {
        clearTimeout(timer)
        // Stop accumulating. The buffer used to grow for the whole process
        // lifetime, and nothing reads it once the server is up.
        child.stdout?.off('data', onData)
        child.stderr?.off('data', onData)
        resolve(url)
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (err) => {
      clearTimeout(timer)
      serverChild = null
      serverUrl = null
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      // The server is gone, so nothing that remembers it can still be true, and
      // its sessions died with it. This used to bail out early when a URL had
      // been recorded, which left the dead child's bookkeeping in place.
      serverChild = null
      serverUrl = null
      sessionsByDir.clear()
      reject(new Error(output.trim() || `opencode serve exited with code ${code ?? 'unknown'}`))
    })
  })
}

export interface OpencodeServerClient {
  baseUrl: string
  directory: string
}

function urlFor(client: OpencodeServerClient, path: string): string {
  const url = new URL(path, `${client.baseUrl.replace(/\/$/, '')}/`)
  url.searchParams.set('directory', client.directory)
  return url.toString()
}

function headersFor(directory: string, json: boolean): Record<string, string> {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    'x-opencode-directory': encodeURIComponent(directory)
  }
}

function unwrapData<T>(value: unknown): T {
  const rec = value as Record<string, unknown> | null
  if (rec && typeof rec === 'object' && rec.data !== undefined) return rec.data as T
  return value as T
}

async function serverRequest<T>(
  client: OpencodeServerClient,
  method: string,
  path: string,
  body: unknown,
  signal?: AbortSignal
): Promise<T> {
  const hasBody = body !== undefined
  const res = await net.fetch(urlFor(client, path), {
    method,
    headers: headersFor(client.directory, hasBody),
    body: hasBody ? JSON.stringify(body) : undefined,
    signal
  })
  const text = await res.text()
  const parsed: unknown = text ? JSON.parse(text) : undefined
  if (!res.ok) {
    const rec = parsed as Record<string, unknown> | undefined
    const nested = (rec?.error ?? rec?.data) as Record<string, unknown> | undefined
    const message =
      (typeof rec?.message === 'string' && rec.message) ||
      (typeof nested?.message === 'string' && nested.message) ||
      text ||
      `OpenCode HTTP ${res.status}`
    throw new Error(message.trim())
  }
  return unwrapData<T>(parsed)
}

export interface OpenCodeSession {
  id: string
  directory?: string
  title?: string
}

const sessionsByDir = new Map<string, string>()

function clientFor(baseUrl: string, directory: string): OpencodeServerClient {
  return { baseUrl, directory }
}

/** Reused session per directory/sessionId (WriteMd sends full history each turn). */
async function sessionFor(
  baseUrl: string,
  directory: string,
  sessionId?: string,
  signal?: AbortSignal
): Promise<string> {
  const key = sessionId ? `${directory}:${sessionId}` : directory
  const cached = sessionsByDir.get(key)
  if (cached) return cached
  const created = await serverRequest<OpenCodeSession>(
    clientFor(baseUrl, directory),
    'POST',
    '/session',
    { permission: [{ permission: '*', pattern: '*', action: 'deny' }] },
    signal
  )
  sessionsByDir.set(key, created.id)
  return created.id
}

export function dropOpencodeSession(directory: string, sessionId?: string): void {
  const key = sessionId ? `${directory}:${sessionId}` : directory
  sessionsByDir.delete(key)
}

export interface OpencodePromptInput {
  bin: string
  version: string | null
  directory: string
  model?: string
  prompt: string
  signal?: AbortSignal
  sessionId?: string
}

/** Blocking prompt; returns the assistant text. */
export async function opencodeChat(input: OpencodePromptInput): Promise<string> {
  const baseUrl = await ensureOpencodeServer(input.bin, input.version)
  const client = clientFor(baseUrl, input.directory)
  const model = parseOpenCodeModelSlug(input.model)
  const run = async (sessionId: string): Promise<unknown> =>
    serverRequest(
      client,
      'POST',
      `/session/${encodeURIComponent(sessionId)}/message`,
      {
        // Match the TUI (`Build · Big Pickle`): explicit build agent rather
        // than whatever the server default happens to be.
        agent: 'build',
        ...(model ? { model } : {}),
        parts: [{ type: 'text', text: input.prompt }]
      },
      input.signal
    )
  let sessionId = await sessionFor(baseUrl, input.directory, input.sessionId, input.signal)
  let data: unknown
  try {
    data = await run(sessionId)
  } catch (e) {
    // Sessions do not survive a server restart; retry once on a fresh one.
    if (e instanceof Error && /404|not found|no such session/i.test(e.message)) {
      dropOpencodeSession(input.directory, input.sessionId)
      sessionId = await sessionFor(baseUrl, input.directory, input.sessionId, input.signal)
      data = await run(sessionId)
    } else {
      throw e
    }
  }
  const rec = data as { info?: { role?: unknown; error?: unknown }; parts?: unknown }
  if (rec?.info?.error) {
    const err = rec.info.error as Record<string, unknown>
    throw new Error(
      (typeof err.message === 'string' && err.message) || 'opencode reported a model error'
    )
  }
  const text = extractAssistantTextFromMessage(data)
  if (text) return stripToolArtifacts(text) || text
  // Fallback: read the session's messages and take the last assistant text.
  const messages = await serverRequest<Array<{ info?: { role?: unknown }; parts?: unknown[] }>>(
    client,
    'GET',
    `/session/${encodeURIComponent(sessionId)}/message`,
    undefined,
    input.signal
  )
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (m.info?.role !== 'assistant' || !Array.isArray(m.parts)) continue
    const joined = m.parts
      .filter((p) => (p as { type?: unknown }).type === 'text')
      .map((p) => (p as { text?: unknown }).text)
      .filter((t): t is string => typeof t === 'string')
      .join('')
    if (joined) return stripToolArtifacts(joined) || joined
  }
  throw new Error('opencode returned no text')
}

export interface OpencodeStreamInput extends OpencodePromptInput {
  onDelta: (delta: string) => void
}

interface SseEventPayload {
  type?: unknown
  properties?: unknown
}

/**
 * Streaming prompt: `prompt_async` + the shared `/event` stream, ending on
 * `session.status` idle for our session. Resolves with the full text.
 */
export async function opencodeChatStream(input: OpencodeStreamInput): Promise<string> {
  const baseUrl = await ensureOpencodeServer(input.bin, input.version)
  const client = clientFor(baseUrl, input.directory)
  const sessionId = await sessionFor(baseUrl, input.directory, input.sessionId, input.signal)
  const assembler = new OpencodeStreamAssembler(sessionId)
  const model = parseOpenCodeModelSlug(input.model)

  const eventsUrl = urlFor(client, '/event')
  const controller = new AbortController()
  const onAbort = (): void => {
    controller.abort()
    void serverRequest(client, 'POST', `/session/${encodeURIComponent(sessionId)}/abort`, {}).catch(
      () => undefined
    )
  }
  if (input.signal?.aborted) return ''
  input.signal?.addEventListener('abort', onAbort, { once: true })

  // Subscribe before prompting so early deltas cannot slip past.
  const res = await net.fetch(eventsUrl, { headers: headersFor(client.directory, false) })
  if (!res.ok || !res.body) throw new Error(`OpenCode event stream failed: HTTP ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const { SseParser } = await import('./sse')
  const parser = new SseParser()

  let done = false
  const finish = (value: string): string => {
    if (done) return value
    done = true
    input.signal?.removeEventListener('abort', onAbort)
    try {
      controller.abort()
    } catch {
      // reader already closed
    }
    return value
  }

  const pump = (async (): Promise<string> => {
    let timedOut = false
    const timeout = setTimeout(() => {
      if (done) return
      timedOut = true
      void reader.cancel().catch(() => undefined)
      // Stop the turn server-side too. Cancelling only the reader left the
      // model generating, and billing tokens, for a client that had gone.
      void serverRequest(
        client,
        'POST',
        `/session/${encodeURIComponent(sessionId)}/abort`,
        {}
      ).catch(() => undefined)
    }, CHAT_TIMEOUT_MS)
    try {
      for (;;) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        for (const payload of parser.feed(decoder.decode(value, { stream: true }))) {
          const event = payload as SseEventPayload
          const error = OpencodeStreamAssembler.sessionError(event, sessionId)
          if (error) throw new Error(error)
          const delta = assembler.feedEvent(event)
          if (delta) input.onDelta(delta)
          if (OpencodeStreamAssembler.isIdleFor(event, sessionId)) {
            return finish(assembler.fullText)
          }
        }
      }
      for (const payload of parser.flush()) {
        const delta = assembler.feedEvent(payload)
        if (delta) input.onDelta(delta)
      }
      // Reported whether or not text arrived. Gating this on an empty answer
      // meant a stream that produced most of a reply and then stalled returned
      // that partial reply as if it were complete, with nothing on screen to say
      // it was cut off.
      if (timedOut) {
        throw new Error(
          'opencode took over 3 minutes without finishing - the free reasoning model may be queued. Try again, or pick a faster flash model.'
        )
      }
      return finish(assembler.fullText)
    } finally {
      clearTimeout(timeout)
    }
  })()

  // Fire the prompt once the subscription is live.
  const prompt = serverRequest(
    client,
    'POST',
    `/session/${encodeURIComponent(sessionId)}/prompt_async`,
    {
      agent: 'build',
      ...(model ? { model } : {}),
      parts: [{ type: 'text', text: input.prompt }]
    },
    input.signal
  ).catch(async (e: unknown) => {
    if (e instanceof Error && /404|not found|no such session/i.test(e.message)) {
      dropOpencodeSession(input.directory, input.sessionId)
      await sessionFor(baseUrl, input.directory, input.sessionId, input.signal)
      // Session id is captured; restart the whole stream on a fresh session.
      throw new OpencodeRetryWith()
    }
    throw e
  })

  try {
    // allSettled, not all: when the prompt fails (bad model, a 4xx) `all`
    // rejected the moment the handler was done with this function while `pump`
    // kept reading /event and pushing deltas at a renderer that had already
    // torn its listener down, holding the socket open until the timeout.
    const [promptResult, pumpResult] = await Promise.allSettled([prompt, pump])
    if (promptResult.status === 'rejected') throw promptResult.reason
    if (pumpResult.status === 'rejected') throw pumpResult.reason
    const text = finish(assembler.fullText)
    return stripToolArtifacts(text) || text
  } catch (e) {
    if (e instanceof OpencodeRetryWith) {
      // Simplest correct retry: one blocking call on the fresh session.
      return opencodeChat(input)
    }
    if (input.signal?.aborted) return finish(assembler.fullText)
    throw e
  } finally {
    // Anything still running stops here rather than outliving the handler.
    try {
      controller.abort()
      await reader.cancel()
    } catch {
      // already closed
    }
  }
}

/** Internal control flow: restart the turn on a fresh session. */
class OpencodeRetryWith {}
