import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { makeTempRoot, cleanupTempRoot } from './helpers/temp-root'
import { runTurn, type RunTurnRequest, type TurnEvent } from '../src/main/ai/turn'
import { ChangeJournal } from '../src/main/ai/journal'
import type { StreamEvent } from '../src/shared/ai/types'
import type { StreamRequest } from '../src/main/ai/providers/types'
import { geminiAdapter } from '../src/main/ai/providers/gemini'
import { NATIVE_TOOL_MARKUP_ERROR } from '../src/main/ai/providers/native-tool-markup'

const mocks = vi.hoisted(() => ({
  stream: vi.fn<(request: StreamRequest) => AsyncGenerator<StreamEvent>>(),
  searchWeb:
    vi.fn<
      (
        query: string,
        signal: AbortSignal
      ) => Promise<Array<{ title: string; url: string; snippet: string }>>
    >()
}))
vi.mock('../src/main/ai/providers', () => ({ adapterFor: () => ({ stream: mocks.stream }) }))
vi.mock('../src/main/ai/web-search', () => ({
  WEB_SEARCH_TOOL: {
    name: 'web_search',
    description: 'Search the web',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  },
  searchWeb: mocks.searchWeb
}))

let root: string
let request: RunTurnRequest

beforeEach(() => {
  root = makeTempRoot('ai-turn')
  const path = join(root, 'note.md')
  writeFileSync(path, 'Original')
  request = {
    sessionId: 'session',
    providerId: 'openai',
    baseUrl: 'https://example.test/v1',
    model: 'test',
    userText: 'Rewrite',
    context: {
      document: { path, content: 'Original', isOpen: true },
      base: root,
      selection: null,
      references: [],
      attachments: [],
      openPaths: [path]
    },
    history: [],
    historyTurns: 10,
    journal: new ChangeJournal(join(root, 'journal.json')),
    signal: new AbortController().signal
  }
  mocks.stream.mockReset()
  mocks.searchWeb
    .mockReset()
    .mockResolvedValue([{ title: 'Source', url: 'https://source.test', snippet: 'A useful fact.' }])
})

describe('AI web search loop', () => {
  it.each([false, true])(
    'recovers native tool markup even when tools were initially disabled=%s',
    async (disabled) => {
      request.previewOnly = disabled
      request.context.selection = disabled ? 'Original' : null
      mocks.stream
        .mockImplementationOnce(async function* () {
          yield { type: 'error', message: NATIVE_TOOL_MARKUP_ERROR }
          yield { type: 'done', stopReason: 'error' }
        })
        .mockImplementationOnce(async function* () {
          yield {
            type: 'text',
            delta: '<<<<<<< SEARCH\nOriginal\n=======\nChanged\n>>>>>>> REPLACE'
          }
          yield { type: 'done', stopReason: 'end_turn' }
        })
      const events = await collect()
      expect(mocks.stream).toHaveBeenCalledTimes(2)
      const retry = mocks.stream.mock.calls[1][0]
      expect(retry.tools).toBeUndefined()
      expect(retry.disableThinking).toBe(true)
      expect(retry.system).toContain('No tools are available')
      expect(events.some((event) => event.type === 'error')).toBe(false)
      expect(mocks.searchWeb).not.toHaveBeenCalled()
    }
  )

  it('stops after one native-markup recovery attempt without modifying the file', async () => {
    mocks.stream.mockImplementation(async function* () {
      yield { type: 'error', message: NATIVE_TOOL_MARKUP_ERROR }
      yield { type: 'done', stopReason: 'error' }
    })
    const events = await collect()
    expect(mocks.stream).toHaveBeenCalledTimes(2)
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('No edits were applied')
    })
    expect(readFileSync(request.context.document!.path, 'utf8')).toBe('Original')
    expect(mocks.searchWeb).not.toHaveBeenCalled()
  })
  it.each([true, false])(
    'rewrites a large supplied document directly with previewOnly=%s',
    async (previewOnly) => {
      request.previewOnly = previewOnly
      const path = request.context.document!.path
      const original = '# Long note\n\n' + 'Old paragraph.\n\n'.repeat(8000) + 'DOCUMENT_END'
      const replacement = '# Rewritten note\n\nNew document.'
      request.context.document!.content = original
      writeFileSync(path, original)
      mocks.stream.mockImplementation(async function* (input) {
        expect(JSON.stringify(input.messages)).toContain('DOCUMENT_END')
        // Split the header one character at a time to catch protocol leaks.
        for (const delta of '<<<<<<< REWRITE\n') yield { type: 'text', delta }
        yield { type: 'text', delta: `${replacement}\n>>>>>>> REPLACE` }
        yield { type: 'done', stopReason: 'end_turn' }
      })
      const events = await collect()
      expect(events.filter((event) => event.type === 'text')).toEqual([])
      expect(events.some((event) => event.type === 'error')).toBe(false)
      if (previewOnly) {
        expect(events).toContainEqual({
          type: 'preview',
          changes: [{ path, original, content: replacement, kind: 'modified' }],
          skipped: []
        })
        expect(readFileSync(path, 'utf8')).toBe(original)
      } else {
        expect(readFileSync(path, 'utf8')).toBe(replacement)
        expect(request.journal.list()[0]).toMatchObject({ before: original, after: replacement })
      }
    }
  )

  it('appends a backlink using only the final passage of a large document', async () => {
    const path = request.context.document!.path
    const original = 'Unchanged paragraph.\n\n'.repeat(6000) + 'Unique ending.'
    request.context.document!.content = original
    writeFileSync(path, original)
    mocks.stream.mockImplementation(async function* () {
      yield {
        type: 'text',
        delta:
          '<<<<<<< SEARCH\nUnique ending.\n=======\nUnique ending.\n\n[[Related]]\n>>>>>>> REPLACE'
      }
      yield { type: 'done', stopReason: 'end_turn' }
    })
    expect((await collect()).filter((event) => event.type === 'text')).toEqual([])
    expect(readFileSync(path, 'utf8')).toBe(original + '\n\n[[Related]]')
  })

  it('does not overwrite newer text with a direct whole-document rewrite', async () => {
    const path = request.context.document!.path
    mocks.stream.mockImplementation(async function* () {
      writeFileSync(path, 'Newer user text')
      yield { type: 'text', delta: '<<<<<<< REWRITE\nRewritten text\n>>>>>>> REPLACE' }
      yield { type: 'done', stopReason: 'end_turn' }
    })
    const events = await collect()
    expect(readFileSync(path, 'utf8')).toBe('Newer user text')
    expect(events.find((event) => event.type === 'applied')).toMatchObject({
      outcome: { applied: [], skipped: [{ reason: 'block-failed' }] }
    })
    expect(request.journal.list()).toEqual([])
  })

  it('rejects an unfinished rewrite even after a complete local block', async () => {
    mocks.stream.mockImplementation(async function* () {
      yield {
        type: 'text',
        delta:
          '<<<<<<< SEARCH\nOriginal\n=======\nChanged\n>>>>>>> REPLACE\n<<<<<<< REWRITE\nUnfinished'
      }
      yield { type: 'done', stopReason: 'end_turn' }
    })
    expect(await collect()).toContainEqual({
      type: 'error',
      message: 'The edit ended before it was complete. No edits were applied. Try again.'
    })
    expect(readFileSync(request.context.document!.path, 'utf8')).toBe('Original')
  })
  it.each(['.md', '.markdown', '.mdown', '.mkd'])(
    'previews and applies an external %s file at its original path',
    async (extension) => {
      const external = makeTempRoot('external-ai-note')
      try {
        const path = join(external, `ExternalNote${extension}`)
        writeFileSync(path, 'Original')
        request.context.document = { path, content: 'Unsaved draft', isOpen: true }
        request.previewOnly = true
        mocks.stream.mockImplementation(async function* () {
          yield {
            type: 'text',
            delta: '<<<<<<< SEARCH\nUnsaved draft\n=======\nRevised draft\n>>>>>>> REPLACE'
          }
          yield { type: 'done', stopReason: 'end_turn' }
        })
        expect(await collect()).toContainEqual({
          type: 'preview',
          changes: [
            { path, original: 'Unsaved draft', content: 'Revised draft', kind: 'modified' }
          ],
          skipped: []
        })
        expect(readFileSync(path, 'utf8')).toBe('Original')
        expect(request.journal.list()).toEqual([])

        request.previewOnly = false
        request.context.document = null
        request.userText = `Change Original to Revised in ${path}`
        mocks.stream.mockImplementation(async function* () {
          yield {
            type: 'text',
            delta: `<<<<<<< SEARCH path="${path}"\nOriginal\n=======\nRevised\n>>>>>>> REPLACE`
          }
          yield { type: 'done', stopReason: 'end_turn' }
        })
        const events = await collect()
        expect(events.some((event) => event.type === 'error')).toBe(false)
        expect(readFileSync(path, 'utf8')).toBe('Revised')
        expect(existsSync(join(root, `ExternalNote${extension}`))).toBe(false)
        const entry = request.journal.list()[0]
        expect(entry).toMatchObject({ path, before: 'Original', after: 'Revised' })
        expect(request.journal.undo(entry.id).status).toBe('restored')
        expect(readFileSync(path, 'utf8')).toBe('Original')
      } finally {
        cleanupTempRoot(external)
      }
    }
  )

  it('replays Gemini signed parts unchanged across parallel and sequential searches', async () => {
    request.providerId = 'gemini'
    request.model = 'gemini-3-flash-preview'
    mocks.stream.mockImplementation((streamRequest) => geminiAdapter.stream(streamRequest))

    const firstParts = [
      { thought: true, text: 'Search plan', thoughtSignature: 'thought-signature' },
      { text: 'Checking sources.', thoughtSignature: 'text-signature' },
      {
        functionCall: { name: 'web_search', args: { query: 'First source' } },
        thoughtSignature: 'first-call-signature'
      },
      { functionCall: { name: 'web_search', args: { query: 'Second source' } } }
    ]
    const secondParts = [
      { text: 'Checking one more source.' },
      {
        functionCall: { name: 'web_search', args: { query: 'Third source' } },
        thoughtSignature: 'second-call-signature'
      },
      { text: '', thoughtSignature: 'final-part-signature' }
    ]
    const responses = [firstParts, secondParts, [{ text: 'A sourced answer.' }]]
    const bodies: Array<{ contents: Array<{ role: string; parts: unknown[] }> }> = []
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as (typeof bodies)[number]
      bodies.push(body)
      const step = bodies.length - 1
      const models = body.contents.filter((content) => content.role === 'model')
      // Simulate Gemini's validation of the actual follow-up HTTP request.
      const valid =
        (step < 1 || JSON.stringify(models[0]?.parts) === JSON.stringify(firstParts)) &&
        (step < 2 || JSON.stringify(models[1]?.parts) === JSON.stringify(secondParts))
      if (!valid) {
        return new Response(
          JSON.stringify({ error: { message: 'Function call is missing a thought_signature' } }),
          { status: 400, statusText: 'Bad Request' }
        )
      }
      const frames = responses[step].map((part, index, parts) => ({
        candidates: [
          {
            index: 0,
            content: { role: 'model', parts: [part] },
            ...(index === parts.length - 1 ? { finishReason: 'STOP' } : {})
          }
        ]
      }))
      const bytes = new TextEncoder().encode(
        frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')
      )
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
            controller.close()
          }
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const events = await collect()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(mocks.searchWeb.mock.calls.map(([query]) => query)).toEqual([
      'First source',
      'Second source',
      'Third source'
    ])
    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(events.filter((event) => event.type === 'text')).toEqual([
      { type: 'text', delta: 'Checking sources.' },
      { type: 'text', delta: 'Checking one more source.' },
      { type: 'text', delta: 'A sourced answer.' }
    ])
    expect(events).toContainEqual({ type: 'answer', text: 'A sourced answer.' })
    expect(events.at(-1)).toEqual({ type: 'done', text: 'A sourced answer.' })
    expect(readFileSync(request.context.document!.path, 'utf8')).toBe('Original')
    expect(request.journal.list()).toEqual([])
  })

  it('previews against the captured unsaved draft without writing the file or journal', async () => {
    request.previewOnly = true
    request.context.document!.content = 'Unsaved draft'
    const recorded = vi.spyOn(request.journal, 'record')
    mocks.stream.mockImplementation(async function* () {
      yield {
        type: 'text',
        delta: '<<<<<<< SEARCH\nUnsaved draft\n=======\nRevised draft\n>>>>>>> REPLACE'
      }
      yield { type: 'done', stopReason: 'end_turn' }
    })
    const events = await collect()
    expect(events).toContainEqual({
      type: 'preview',
      changes: [
        {
          path: request.context.document!.path,
          original: 'Unsaved draft',
          content: 'Revised draft',
          kind: 'modified'
        }
      ],
      skipped: []
    })
    expect(readFileSync(request.context.document!.path, 'utf8')).toBe('Original')
    expect(recorded).not.toHaveBeenCalled()
    expect(existsSync(join(root, 'journal.json'))).toBe(false)
    expect(events.some((event) => event.type === 'applied')).toBe(false)
  })

  it('previews only captured selected text even when it occurs twice in the full note', async () => {
    request.previewOnly = true
    writeFileSync(request.context.document!.path, 'PRIVATE CONTENT\nOriginal\nOriginal')
    request.context.document!.content = 'Original'
    request.context.selection = 'Original'
    mocks.stream.mockImplementation(async function* () {
      yield {
        type: 'text',
        delta: '<<<<<<< SEARCH\nOriginal\n=======\nSelected revision\n>>>>>>> REPLACE'
      }
      yield { type: 'done', stopReason: 'end_turn' }
    })
    const events = await collect()
    const preview = events.find((event) => event.type === 'preview')
    expect(preview).toMatchObject({
      changes: [{ original: 'Original', content: 'Selected revision' }],
      skipped: []
    })
    expect(mocks.stream.mock.calls[0][0].tools).toBeUndefined()
    expect(JSON.stringify(mocks.stream.mock.calls[0][0].messages)).not.toContain('PRIVATE CONTENT')
    expect(readFileSync(request.context.document!.path, 'utf8')).toBe(
      'PRIVATE CONTENT\nOriginal\nOriginal'
    )
  })

  it('previews other files in the vault without writing any of them', async () => {
    request.previewOnly = true
    request.context.document!.content = 'Original'
    const other = join(root, 'other.md')
    writeFileSync(other, 'OTHER CONTENT')
    mocks.stream.mockImplementation(async function* () {
      yield {
        type: 'text',
        delta: [
          '<<<<<<< SEARCH\nOriginal\n=======\nChanged\n>>>>>>> REPLACE',
          '<<<<<<< SEARCH path="other.md"\nOTHER CONTENT\n=======\nOther changed\n>>>>>>> REPLACE',
          '<<<<<<< SEARCH path="fresh.md"\n\n=======\nBrand new\n>>>>>>> REPLACE'
        ].join('\n')
      }
      yield { type: 'done', stopReason: 'end_turn' }
    })
    const events = await collect()
    expect(events).toContainEqual({
      type: 'preview',
      changes: [
        {
          path: request.context.document!.path,
          original: 'Original',
          content: 'Changed',
          kind: 'modified'
        },
        { path: other, original: 'OTHER CONTENT', content: 'Other changed', kind: 'modified' },
        { path: join(root, 'fresh.md'), original: '', content: 'Brand new', kind: 'created' }
      ],
      skipped: []
    })
    // Previewed, not written. That is the whole point of the preview path, and
    // it now holds for every file in the vault rather than just the open note.
    expect(readFileSync(other, 'utf8')).toBe('OTHER CONTENT')
    expect(existsSync(join(root, 'fresh.md'))).toBe(false)
    expect(request.journal.list()).toEqual([])
    expect(events.some((event) => event.type === 'applied')).toBe(false)
  })

  it('refuses ambiguous and nonmatching blocks and non-Markdown targets', async () => {
    request.previewOnly = true
    request.context.document!.content = 'Original Original'
    const other = join(root, 'other.md')
    writeFileSync(other, 'OTHER PRIVATE CONTENT')
    mocks.stream.mockImplementation(async function* () {
      yield {
        type: 'text',
        delta: [
          '<<<<<<< SEARCH\nOriginal\n=======\nChanged\n>>>>>>> REPLACE',
          '<<<<<<< SEARCH\nMissing\n=======\nChanged\n>>>>>>> REPLACE',
          '<<<<<<< SEARCH path="other.md"\nOTHER PRIVATE CONTENT\n=======\nChanged\n>>>>>>> REPLACE',
          '<<<<<<< SEARCH path="../escape.json"\n\n=======\nCreated\n>>>>>>> REPLACE'
        ].join('\n')
      }
      yield { type: 'done', stopReason: 'end_turn' }
    })
    const preview = (await collect()).find((event) => event.type === 'preview')
    expect(preview).toMatchObject({
      changes: [
        {
          path: other,
          original: 'OTHER PRIVATE CONTENT',
          content: 'Changed'
        }
      ]
    })
    // Order follows the model, not a sort: an ambiguous block belongs to the
    // open note and `../escape.json` was refused by the resolver.
    const skipped = preview && 'skipped' in preview ? preview.skipped : []
    expect(skipped).toContainEqual(
      expect.objectContaining({ path: '../escape.json', reason: 'unreadable' })
    )
    expect(skipped).toContainEqual(
      expect.objectContaining({ path: request.context.document!.path, reason: 'ambiguous' })
    )
    expect(readFileSync(other, 'utf8')).toBe('OTHER PRIVATE CONTENT')
    expect(request.journal.list()).toEqual([])
    expect(readFileSync(request.context.document!.path, 'utf8')).toBe('Original')
  })
  it.each(['event', 'throw'] as const)(
    'retries a model that explicitly rejects tools through a provider %s',
    async (failure) => {
      mocks.stream
        .mockImplementationOnce(async function* () {
          if (failure === 'throw') throw new Error('This model does not support tools.')
          yield { type: 'error', message: 'Function calling is not supported by this model.' }
          yield { type: 'done', stopReason: 'error' }
        })
        .mockImplementationOnce(async function* () {
          yield { type: 'text', delta: 'A plain answer.' }
          yield { type: 'done', stopReason: 'end_turn' }
        })
      const events = await collect()
      expect(mocks.stream).toHaveBeenCalledTimes(2)
      expect(mocks.stream.mock.calls[0][0].tools?.[0].name).toBe('web_search')
      expect(mocks.stream.mock.calls[1][0].tools).toBeUndefined()
      expect(events).toContainEqual({
        type: 'status',
        message: 'This model cannot search the web. Continuing without web search.'
      })
      expect(events.some((event) => event.type === 'error')).toBe(false)
      expect(events.at(-1)).toEqual({ type: 'done', text: 'A plain answer.' })
    }
  )

  it.each([
    'Invalid API key (401)',
    'Network connection failed',
    '403 Forbidden: tools are unsupported'
  ])('does not retry the provider failure %s', async (message) => {
    mocks.stream.mockImplementation(async function* () {
      yield { type: 'error', message }
      yield { type: 'done', stopReason: 'error' }
    })
    const events = await collect()
    expect(mocks.stream).toHaveBeenCalledOnce()
    expect(events).toContainEqual({ type: 'error', message })
    expect(events.some((event) => event.type === 'status')).toBe(false)
  })

  it('does not retry or apply a partial response that reports unsupported tools', async () => {
    mocks.stream.mockImplementation(async function* () {
      yield { type: 'text', delta: '<<<<<<< SEARCH\nOriginal\n=======\nChanged\n>>>>>>> REPLACE' }
      yield { type: 'error', message: 'This model does not support tools.' }
      yield { type: 'done', stopReason: 'error' }
    })
    const events = await collect()
    expect(mocks.stream).toHaveBeenCalledOnce()
    expect(events.some((event) => event.type === 'applied')).toBe(false)
    expect(readFileSync(request.context.document!.path, 'utf-8')).toBe('Original')
  })

  it('feeds a labeled tool result into a terminal answer and ignores intermediate edit blocks', async () => {
    mocks.stream
      .mockImplementationOnce(async function* () {
        yield { type: 'text', delta: '<<<<<<< SEARCH\nOriginal\n=======\nChanged\n>>>>>>> REPLACE' }
        yield {
          type: 'tool-call',
          call: { id: 'search-1', name: 'web_search', arguments: { query: 'Latest news' } }
        }
        yield { type: 'done', stopReason: 'tool_calls' }
      })
      .mockImplementationOnce(async function* () {
        yield { type: 'text', delta: 'A sourced answer.' }
        yield { type: 'done', stopReason: 'end_turn' }
      })
    const events = await collect()
    expect(mocks.searchWeb).toHaveBeenCalledExactlyOnceWith('Latest news', request.signal)
    expect(mocks.stream.mock.calls[0][0].tools?.[0].name).toBe('web_search')
    const messages = mocks.stream.mock.calls[1][0].messages
    const assistant = messages.find((message) => message.toolCalls?.length)
    expect(assistant?.toolCalls?.[0].id).toBe('search-1')
    const result = messages.find((message) => message.role === 'tool')!
    expect(result.toolCallId).toBe('search-1')
    expect(JSON.parse(result.content as string)).toEqual({
      untrusted: true,
      source: 'web_search',
      query: 'Latest news',
      results: [{ title: 'Source', url: 'https://source.test', snippet: 'A useful fact.' }]
    })
    expect(events).toContainEqual({
      type: 'status',
      message: expect.stringContaining('Searching the web')
    })
    expect(events).toContainEqual({ type: 'answer', text: 'A sourced answer.' })
    expect(events.at(-1)).toEqual({ type: 'done', text: 'A sourced answer.' })
    expect(events.some((event) => event.type === 'applied')).toBe(false)
    expect(readFileSync(request.context.document!.path, 'utf-8')).toBe('Original')
  })

  it('rejects a batch larger than the total tool limit', async () => {
    mocks.stream.mockImplementation(async function* () {
      for (let index = 0; index < 4; index++)
        yield {
          type: 'tool-call',
          call: { id: `call-${index}`, name: 'web_search', arguments: { query: 'News' } }
        }
      yield { type: 'done', stopReason: 'tool_calls' }
    })
    const events = await collect()
    expect(mocks.searchWeb).not.toHaveBeenCalled()
    expect(mocks.stream).toHaveBeenCalledOnce()
    expect(events).toContainEqual({
      type: 'error',
      message: expect.stringContaining('web search limit')
    })
  })

  it('stops after three provider rounds and omits tools from the final round', async () => {
    mocks.stream.mockImplementation(async function* () {
      yield {
        type: 'tool-call',
        call: { id: 'call', name: 'web_search', arguments: { query: 'News' } }
      }
      yield { type: 'done', stopReason: 'tool_calls' }
    })
    const events = await collect()
    expect(mocks.stream).toHaveBeenCalledTimes(3)
    expect(mocks.searchWeb).toHaveBeenCalledTimes(2)
    expect(mocks.stream.mock.calls[2][0].tools).toBeUndefined()
    expect(events).toContainEqual({
      type: 'error',
      message: expect.stringContaining('web search limit')
    })
  })

  it('caps total calls and runs an allowed batch serially before asking for a final answer', async () => {
    const order: string[] = []
    let active = 0
    mocks.searchWeb.mockImplementation(async (query) => {
      active++
      expect(active).toBe(1)
      order.push(query)
      await Promise.resolve()
      active--
      return []
    })
    mocks.stream
      .mockImplementationOnce(async function* () {
        for (let index = 0; index < 3; index++)
          yield {
            type: 'tool-call',
            call: {
              id: `call-${index}`,
              name: 'web_search',
              arguments: { query: `Query ${index}` }
            }
          }
        yield { type: 'done', stopReason: 'tool_calls' }
      })
      .mockImplementationOnce(async function* () {
        yield { type: 'text', delta: 'Finished.' }
        yield { type: 'done', stopReason: 'end_turn' }
      })
    expect((await collect()).at(-1)).toEqual({ type: 'done', text: 'Finished.' })
    expect(order).toEqual(['Query 0', 'Query 1', 'Query 2'])
    expect(mocks.stream.mock.calls[1][0].tools).toBeUndefined()
  })

  it('stops during a search without a follow-up request or disk writes', async () => {
    const controller = new AbortController()
    request.signal = controller.signal
    mocks.stream.mockImplementation(async function* () {
      yield {
        type: 'tool-call',
        call: { id: 'call', name: 'web_search', arguments: { query: 'News' } }
      }
      yield { type: 'done', stopReason: 'tool_calls' }
    })
    mocks.searchWeb.mockImplementation(async () => {
      controller.abort()
      throw new Error('Aborted')
    })
    const events = await collect()
    expect(mocks.stream).toHaveBeenCalledOnce()
    expect(events.some((event) => event.type === 'error' || event.type === 'applied')).toBe(false)
    expect(readFileSync(request.context.document!.path, 'utf-8')).toBe('Original')
  })

  it('returns a readable search failure to the model and still permits an honest answer', async () => {
    mocks.searchWeb.mockRejectedValue(new Error('Search service unavailable'))
    mocks.stream
      .mockImplementationOnce(async function* () {
        yield {
          type: 'tool-call',
          call: { id: 'call', name: 'web_search', arguments: { query: 'News' } }
        }
        yield { type: 'done', stopReason: 'tool_calls' }
      })
      .mockImplementationOnce(async function* () {
        yield { type: 'text', delta: 'I could not retrieve web results.' }
        yield { type: 'done', stopReason: 'end_turn' }
      })
    const events = await collect()
    expect(events).toContainEqual({
      type: 'status',
      message: 'Web search is unavailable. Continuing without web results.'
    })
    const result = mocks.stream.mock.calls[1][0].messages.find(
      (message) => message.role === 'tool'
    )!
    expect(JSON.parse(result.content as string).error).toContain('Search service unavailable')
    expect(events.at(-1)).toEqual({ type: 'done', text: 'I could not retrieve web results.' })
  })

  it('rejects an unrecognized tool without invoking web search', async () => {
    mocks.stream
      .mockImplementationOnce(async function* () {
        yield {
          type: 'tool-call',
          call: { id: 'call', name: 'execute_command', arguments: { query: 'News' } }
        }
        yield { type: 'done', stopReason: 'tool_calls' }
      })
      .mockImplementationOnce(async function* () {
        yield { type: 'text', delta: 'That tool is unavailable.' }
        yield { type: 'done', stopReason: 'end_turn' }
      })
    await collect()
    expect(mocks.searchWeb).not.toHaveBeenCalled()
    const result = mocks.stream.mock.calls[1][0].messages.find(
      (message) => message.role === 'tool'
    )!
    expect(JSON.parse(result.content as string).error).toBe('Unsupported tool: execute_command')
  })

  it('does not expose tools or apply edits in a selection action', async () => {
    request.context.selectionOnly = true
    mocks.stream.mockImplementation(async function* () {
      yield { type: 'text', delta: '<<<<<<< SEARCH\nOriginal\n=======\nChanged\n>>>>>>> REPLACE' }
      yield { type: 'done', stopReason: 'end_turn' }
    })
    const events = await collect()
    expect(mocks.stream.mock.calls[0][0].tools).toBeUndefined()
    expect(events.some((event) => event.type === 'applied')).toBe(false)
    expect(readFileSync(request.context.document!.path, 'utf-8')).toBe('Original')
  })

  it.each(['max_tokens', 'error'] as const)(
    'does not execute tools from a failed %s stream',
    async (stopReason) => {
      mocks.stream.mockImplementation(async function* () {
        yield {
          type: 'tool-call',
          call: { id: 'call', name: 'web_search', arguments: { query: 'News' } }
        }
        yield { type: 'done', stopReason }
      })
      expect((await collect()).some((event) => event.type === 'error')).toBe(true)
      expect(mocks.searchWeb).not.toHaveBeenCalled()
    }
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  cleanupTempRoot(root)
})

async function collect(): Promise<TurnEvent[]> {
  const events: TurnEvent[] = []
  for await (const event of runTurn(request)) events.push(event)
  return events
}

describe('AI turn completion', () => {
  it.each([undefined, 65536])(
    'uses output limit %s without substituting a 4K cap',
    async (limit) => {
      request.maxTokens = limit
      mocks.stream.mockImplementation(async function* () {
        yield { type: 'text', delta: 'Answer.' }
        yield { type: 'done', stopReason: 'end_turn' }
      })
      await collect()
      expect(mocks.stream.mock.calls[0][0].maxTokens).toBe(limit)
    }
  )

  it('identifies the configured output limit and leaves truncated edits unapplied', async () => {
    request.maxTokens = 65536
    mocks.stream.mockImplementation(async function* () {
      yield {
        type: 'text',
        delta: '<<<<<<< SEARCH\nOriginal\n=======\nIncomplete\n>>>>>>> REPLACE'
      }
      yield { type: 'done', stopReason: 'max_tokens' }
    })
    expect(await collect()).toContainEqual({
      type: 'error',
      message: expect.stringContaining('65,536-token output limit')
    })
    expect(readFileSync(request.context.document!.path, 'utf8')).toBe('Original')
    expect(request.journal.list()).toEqual([])
  })
  it.each([true, false])(
    'prepares an article in an empty note with previewOnly=%s',
    async (previewOnly) => {
      const path = request.context.document!.path
      writeFileSync(path, '')
      request.context.document!.content = ''
      request.userText = 'please write an article on rust and please use the unslop skill.'
      request.previewOnly = previewOnly
      const article = '# Rust\n\nRust uses ownership to manage memory.'
      mocks.stream
        .mockImplementationOnce(async function* () {
          yield { type: 'text', delta: article }
          yield { type: 'done', stopReason: 'end_turn' }
        })
        .mockImplementationOnce(async function* () {
          yield { type: 'text', delta: `<<<<<<< SEARCH\n=======\n${article}\n>>>>>>> REPLACE` }
          yield { type: 'done', stopReason: 'end_turn' }
        })
      const events = await collect()
      expect(mocks.stream).toHaveBeenCalledTimes(2)
      expect(events.some((event) => event.type === 'error')).toBe(false)
      if (previewOnly) {
        expect(events).toContainEqual({
          type: 'preview',
          changes: [{ path, original: '', content: article, kind: 'modified' }],
          skipped: []
        })
        expect(readFileSync(path, 'utf8')).toBe('')
      } else {
        expect(readFileSync(path, 'utf8')).toBe(article)
        expect(request.journal.list()[0]).toMatchObject({ path, before: '', after: article })
      }
    }
  )

  it('reports a drafting failure when a model ignores the edit format twice', async () => {
    request.userText = 'Write an article on Rust'
    mocks.stream.mockImplementation(async function* () {
      yield { type: 'text', delta: 'Rust is a programming language.' }
      yield { type: 'done', stopReason: 'end_turn' }
    })
    const events = await collect()
    expect(mocks.stream).toHaveBeenCalledTimes(2)
    expect(events).toContainEqual({
      type: 'error',
      message: expect.stringContaining('replied in chat')
    })
    expect(events.some((event) => event.type === 'done' || event.type === 'applied')).toBe(false)
    expect(readFileSync(request.context.document!.path, 'utf8')).toBe('Original')
  })

  it.each([
    'What is Rust?',
    'Explain how to write an article',
    'Write an article on Rust in chat only',
    "Please write an article, but don't modify the file"
  ])('keeps %s as a chat reply', async (userText) => {
    request.userText = userText
    mocks.stream.mockImplementation(async function* () {
      yield { type: 'text', delta: 'A chat reply.' }
      yield { type: 'done', stopReason: 'end_turn' }
    })
    expect(await collect()).toContainEqual({ type: 'answer', text: 'A chat reply.' })
    expect(mocks.stream).toHaveBeenCalledOnce()
    expect(readFileSync(request.context.document!.path, 'utf8')).toBe('Original')
  })

  it('does not apply edits when the provider stream ends without completion', async () => {
    mocks.stream.mockImplementation(async function* () {
      yield { type: 'text', delta: '<<<<<<< SEARCH\nOriginal\n=======\nChanged\n>>>>>>> REPLACE' }
    })
    const events = await collect()
    expect(events).toContainEqual({
      type: 'error',
      message: expect.stringContaining('before it was complete')
    })
    expect(events.some((event) => event.type === 'applied')).toBe(false)
    expect(readFileSync(request.context.document!.path, 'utf-8')).toBe('Original')
  })

  it('stops before applying a proposal when cancellation arrives while reporting it', async () => {
    const controller = new AbortController()
    request.signal = controller.signal
    mocks.stream.mockImplementation(async function* () {
      yield { type: 'text', delta: '<<<<<<< SEARCH\nOriginal\n=======\nChanged\n>>>>>>> REPLACE' }
      yield { type: 'done', stopReason: 'end_turn' }
    })
    for await (const event of runTurn(request)) {
      if (event.type === 'proposal') controller.abort()
      expect(event.type).not.toBe('applied')
    }
    expect(readFileSync(request.context.document!.path, 'utf-8')).toBe('Original')
  })

  it.each(['max_tokens', 'error'] as const)(
    'does not apply edits from a response ending in %s',
    async (stopReason) => {
      mocks.stream.mockImplementation(async function* () {
        yield { type: 'text', delta: '<<<<<<< SEARCH\nOriginal\n=======\nChanged\n>>>>>>> REPLACE' }
        yield { type: 'done', stopReason }
      })
      const events = await collect()
      expect(events.some((event) => event.type === 'error')).toBe(true)
      expect(events.some((event) => event.type === 'applied')).toBe(false)
      expect(readFileSync(request.context.document!.path, 'utf-8')).toBe('Original')
    }
  )

  it('reports an empty response instead of saving a blank assistant bubble', async () => {
    mocks.stream.mockImplementation(async function* () {
      yield { type: 'done', stopReason: 'end_turn' }
    })
    expect(await collect()).toEqual([
      { type: 'error', message: expect.stringContaining('empty response') }
    ])
  })

  it('does not apply edits when cancellation arrives after the last chunk', async () => {
    const controller = new AbortController()
    request.signal = controller.signal
    mocks.stream.mockImplementation(async function* () {
      yield { type: 'text', delta: '<<<<<<< SEARCH\nOriginal\n=======\nChanged\n>>>>>>> REPLACE' }
      controller.abort()
      yield { type: 'done', stopReason: 'end_turn' }
    })
    expect((await collect()).some((event) => event.type === 'applied')).toBe(false)
    expect(readFileSync(request.context.document!.path, 'utf-8')).toBe('Original')
  })
})
