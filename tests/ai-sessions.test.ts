import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  DEFAULT_TITLE,
  MAX_SESSIONS,
  MAX_TOTAL_CHARS,
  deriveTitle,
  makeSessionId,
  pruneSessions,
  removeSession,
  sanitizeSessions,
  upsertSession,
  type PersistedSession
} from '../src/shared/ai/sessions'
import type { ChatMessage } from '../src/shared/ai/types'

/**
 * This module is what a user is looking at when they reopen the app, so the
 * tests are about the two things that ruin that: losing a conversation, and
 * showing one in a state it cannot be reopened from.
 *
 * Everything here is pure, which is the point of the module and worth keeping
 * that way - so these tests need no filesystem and no mocks, only inputs and
 * the answer.
 */

function user(content: string): PersistedSession['messages'][number] {
  return { role: 'user', content }
}

function assistant(content: string): PersistedSession['messages'][number] {
  return { role: 'assistant', content }
}

function session(over: Partial<PersistedSession> = {}): PersistedSession {
  return {
    id: 's1',
    title: 'A conversation',
    providerId: 'openai',
    model: 'gpt-5',
    messages: [user('hello'), assistant('hi')],
    contextFile: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...over
  }
}

/** A deep copy, to prove a function left its input alone. */
function snapshot(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

function makeMany(count: number, startAt = 0): PersistedSession[] {
  return Array.from({ length: count }, (_, i) =>
    session({
      id: `s${startAt + i}`,
      title: `chat ${startAt + i}`,
      messages: [user(`message ${startAt + i}`)],
      createdAt: startAt + i,
      updatedAt: startAt + i
    })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('deriveTitle', () => {
  it('uses the first user message', () => {
    expect(deriveTitle([user('Rename my vault index'), assistant('done')])).toBe(
      'Rename my vault index'
    )
  })

  it('skips assistant turns, including one that comes first', () => {
    expect(deriveTitle([assistant('How can I help?'), user('Fix the front matter')])).toBe(
      'Fix the front matter'
    )
  })

  it('skips a user message with nothing usable in it', () => {
    expect(deriveTitle([user('   '), user('\n\t '), user('the real one')])).toBe('the real one')
  })

  it('collapses whitespace so a pasted paragraph stays one line', () => {
    expect(deriveTitle([user('  Summarize   the\n\nnotes\t\tfolder  ')])).toBe(
      'Summarize the notes folder'
    )
  })

  it('leaves a title at the limit alone, with no ellipsis', () => {
    const exact = 'a'.repeat(60)
    expect(deriveTitle([user(exact)])).toBe(exact)
  })

  it('cuts on a word boundary and marks that it did', () => {
    const long = `${'word '.repeat(20)}tail`
    const title = deriveTitle([user(long)])
    expect(title.length).toBeLessThanOrEqual(61)
    expect(title.endsWith('…')).toBe(true)
    expect(title).not.toContain('wor…')
    expect(long.startsWith(title.slice(0, -1))).toBe(true)
  })

  it('cuts a single long token where it lands rather than dropping it', () => {
    // No space to break on: the alternative is an empty title, which tells the
    // user nothing about the conversation they just had.
    const title = deriveTitle([user('b'.repeat(200))])
    expect(title).toBe(`${'b'.repeat(60)}…`)
  })

  it('reads the text out of a content-block message', () => {
    const message: ChatMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe   this' },
        { type: 'image', mimeType: 'image/png', data: 'AAAA' }
      ]
    }
    expect(deriveTitle([message])).toBe('Describe this')
  })

  it('falls through a user turn that is only an image', () => {
    const image: ChatMessage = {
      role: 'user',
      content: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }]
    }
    expect(deriveTitle([image, user('caption the diagram')])).toBe('caption the diagram')
    expect(deriveTitle([image])).toBe(DEFAULT_TITLE)
  })

  it('falls back when there is nothing to name the conversation after', () => {
    expect(deriveTitle([])).toBe(DEFAULT_TITLE)
    expect(deriveTitle([assistant('Hello')])).toBe('New chat')
  })
})

describe('pruneSessions', () => {
  it('keeps at most twenty conversations, newest first', () => {
    const kept = pruneSessions(makeMany(25))
    expect(kept).toHaveLength(MAX_SESSIONS)
    expect(kept[0].id).toBe('s24')
    expect(kept[kept.length - 1].id).toBe('s5')
  })

  it('leaves a store already inside the limits alone, newest first', () => {
    const sessions = makeMany(3)
    expect(pruneSessions(sessions)).toEqual([...sessions].reverse())
  })

  it('drops the oldest conversations once the character budget is spent', () => {
    const big = 'x'.repeat(99_000)
    const kept = pruneSessions([
      session({ id: 'newest', updatedAt: 3, messages: [user(big)] }),
      session({ id: 'middle', updatedAt: 2, messages: [user(big)] }),
      session({ id: 'oldest', updatedAt: 1, messages: [user(big)] })
    ])
    expect(kept.map((s) => s.id)).toEqual(['newest', 'middle'])
  })

  it('keeps a conversation that lands exactly on the budget', () => {
    const title = 't'
    const exact = 'x'.repeat(MAX_TOTAL_CHARS - title.length)
    expect(exact.length + title.length).toBe(MAX_TOTAL_CHARS)
    const kept = pruneSessions([
      session({ id: 'exact', title, updatedAt: 2, messages: [user(exact)] }),
      session({ id: 'one-too-many', updatedAt: 1, messages: [user('x')] })
    ])
    expect(kept.map((s) => s.id)).toEqual(['exact'])
  })

  it('skips a conversation that does not fit rather than dropping everything after it', () => {
    const kept = pruneSessions([
      session({ id: 'big', updatedAt: 3, messages: [user('x'.repeat(150_000))] }),
      session({ id: 'too-big', updatedAt: 2, messages: [user('x'.repeat(100_000))] }),
      session({ id: 'small', updatedAt: 1, messages: [user('x'.repeat(40_000))] })
    ])
    expect(kept.map((s) => s.id)).toEqual(['big', 'small'])
  })

  it('keeps the newest conversation even when it is alone over budget', () => {
    // Evicting the only conversation to satisfy a budget would leave the app
    // empty on launch, which is a worse failure than a file that is briefly big.
    const kept = pruneSessions([
      session({ id: 'huge', updatedAt: 2, messages: [user('x'.repeat(MAX_TOTAL_CHARS * 2))] })
    ])
    expect(kept.map((s) => s.id)).toEqual(['huge'])
  })

  it('does not mutate the array it was given', () => {
    const sessions = makeMany(25)
    const before = snapshot(sessions)
    const kept = pruneSessions(sessions)
    expect(sessions).toEqual(before)
    expect(kept).not.toBe(sessions)
    expect(kept[0]).not.toBe(sessions[24])
  })

  it('counts the title towards the budget and returns nothing for nothing', () => {
    const kept = pruneSessions([
      session({ id: 'a', updatedAt: 1, title: 't'.repeat(500), messages: [user('x')] })
    ])
    expect(kept).toHaveLength(1)
    expect(pruneSessions([])).toEqual([])
  })
})

describe('upsertSession', () => {
  it('stores a new conversation', () => {
    const kept = upsertSession([], session({ id: 'new' }))
    expect(kept.map((s) => s.id)).toEqual(['new'])
  })

  it('replaces a conversation with the same id instead of duplicating it', () => {
    const first = upsertSession(
      [],
      session({ id: 'a', title: 'Old title', messages: [user('one')] })
    )
    const second = upsertSession(
      first,
      session({ id: 'a', title: 'New title', messages: [user('two')] })
    )
    expect(second).toHaveLength(1)
    expect(second[0].title).toBe('New title')
    expect(second[0].messages.map((m) => m.content)).toEqual(['two'])
  })

  it('never stores a conversation with no messages', () => {
    expect(upsertSession([], session({ id: 'empty', messages: [] }))).toEqual([])
    const withOne = upsertSession([], session({ id: 'a' }))
    expect(upsertSession(withOne, session({ id: 'b', messages: [] })).map((s) => s.id)).toEqual([
      'a'
    ])
  })

  it('removes a conversation that has become empty', () => {
    const stored = upsertSession([], session({ id: 'a' }))
    expect(upsertSession(stored, session({ id: 'a', messages: [] }))).toEqual([])
  })

  it('leaves other conversations alone', () => {
    const first = upsertSession([], session({ id: 'a', updatedAt: 1 }))
    const second = upsertSession(first, session({ id: 'b', updatedAt: 2 }))
    expect(second.map((s) => s.id).sort()).toEqual(['a', 'b'])
  })

  it('applies the store limits', () => {
    const many = makeMany(MAX_SESSIONS)
    const kept = upsertSession(many, session({ id: 'newest', updatedAt: 9999 }))
    expect(kept).toHaveLength(MAX_SESSIONS)
    expect(kept[0].id).toBe('newest')
  })

  it('does not mutate the array or the session it was given', () => {
    const sessions = [session({ id: 'a', updatedAt: 1 })]
    const before = snapshot(sessions)
    const incoming = session({ id: 'a', updatedAt: 2 })
    const incomingBefore = snapshot(incoming)

    const kept = upsertSession(sessions, incoming)
    expect(sessions).toEqual(before)
    expect(incoming).toEqual(incomingBefore)
    expect(kept[0]).not.toBe(incoming)
    kept[0].messages[0].content = 'edited'
    expect(incoming.messages[0].content).toBe('hello')
  })
})

describe('removeSession', () => {
  it('drops one conversation', () => {
    const sessions = [session({ id: 'a' }), session({ id: 'b' })]
    expect(removeSession(sessions, 'a').map((s) => s.id)).toEqual(['b'])
  })

  it('does nothing for an id that is not there', () => {
    const sessions = [session({ id: 'a' })]
    expect(removeSession(sessions, 'nope')).toEqual(sessions)
    expect(removeSession([], 'nope')).toEqual([])
  })

  it('does not mutate what it was given', () => {
    const sessions = [session({ id: 'a' }), session({ id: 'b' })]
    const before = snapshot(sessions)
    const kept = removeSession(sessions, 'a')
    expect(sessions).toEqual(before)
    expect(kept[0]).not.toBe(sessions[1])
  })
})

describe('sanitizeSessions', () => {
  it('drops malformed legacy text blocks without displaying objects as chat text', () => {
    const cleaned = sanitizeSessions([
      {
        ...session(),
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'text', text: { malformed: true } },
              { type: 'text', text: 42 },
              null,
              { type: 'text', text: 'Real answer' }
            ]
          }
        ]
      }
    ])
    expect(cleaned[0].messages).toEqual([assistant('Real answer')])
  })
  it('returns nothing for anything that is not an array', () => {
    expect(sanitizeSessions(undefined)).toEqual([])
    expect(sanitizeSessions(null)).toEqual([])
    expect(sanitizeSessions('nope')).toEqual([])
    expect(sanitizeSessions({ sessions: [] })).toEqual([])
  })

  it('keeps a well-formed conversation as it is', () => {
    const stored = session()
    expect(sanitizeSessions([stored])).toEqual([stored])
  })

  it('drops a conversation it cannot identify or reopen', () => {
    const stored = session()
    expect(
      sanitizeSessions([
        { ...stored, id: '' },
        { ...stored, id: '   ' },
        { ...stored, id: 7 },
        { ...stored, id: undefined },
        'not an object',
        null,
        { ...stored, messages: 'not an array' },
        { ...stored, messages: undefined }
      ])
    ).toEqual([])
  })

  it('keeps the conversation and drops only the messages it cannot use', () => {
    const stored = session()
    const [cleaned] = sanitizeSessions([
      {
        ...stored,
        messages: [
          user('keep me'),
          { role: 'tool', content: 'result', toolCallId: 't1' },
          { role: 'system', content: 'you are a helpful assistant' },
          { role: 'user', content: 42 },
          { role: 'user' },
          { role: 'assistant', content: [{ type: 'text', text: 'block text' }] },
          { role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }] },
          'nope'
        ]
      }
    ])
    expect(cleaned.messages).toEqual([user('keep me'), assistant('block text')])
  })

  it('recovers a missing title from the conversation', () => {
    const [, withoutTitle] = sanitizeSessions([
      session({ id: 'a', title: undefined as unknown as string }),
      session({ id: 'b', title: '   ', messages: [user('Rename the vault index')] })
    ])
    expect(withoutTitle.title).toBe('Rename the vault index')
  })

  it('recovers a missing timestamp as zero', () => {
    const [cleaned] = sanitizeSessions([
      session({
        id: 'b',
        createdAt: undefined as unknown as number,
        updatedAt: undefined as unknown as number
      })
    ])
    expect(cleaned.createdAt).toBe(0)
    expect(cleaned.updatedAt).toBe(0)
  })

  it('recovers a timestamp that is not a number', () => {
    const [cleaned] = sanitizeSessions([session({ updatedAt: 'yesterday' as unknown as number })])
    expect(cleaned.updatedAt).toBe(0)
    const [nan] = sanitizeSessions([session({ updatedAt: Number.NaN })])
    expect(nan.updatedAt).toBe(0)
  })

  it('recovers the model and context file', () => {
    const [cleaned] = sanitizeSessions([
      session({
        model: undefined as unknown as string,
        contextFile: undefined as unknown as string
      })
    ])
    expect(cleaned.model).toBeNull()
    expect(cleaned.contextFile).toBeNull()
  })

  it('trims an id and a title', () => {
    const [cleaned] = sanitizeSessions([session({ id: '  padded  ', title: '  spaced  ' })])
    expect(cleaned.id).toBe('padded')
    expect(cleaned.title).toBe('spaced')
  })

  it('never returns a message the store could not have written', () => {
    // The guarantee the whole file format rests on: what comes back can go
    // straight back out, and nothing outside it survives a round trip. Typed as
    // `unknown` because a file written by an older build is not obliged to look
    // like anything this code declares.
    const stored: unknown = [
      { role: 'user', content: 'text', toolCallId: 't1', name: 'read_file' },
      { role: 'assistant', content: 'text', toolCalls: [{ id: 't', name: 'n', arguments: {} }] }
    ]
    const cleaned = sanitizeSessions([
      session({ messages: stored as PersistedSession['messages'] })
    ])
    expect(cleaned[0].messages).toEqual([user('text'), assistant('text')])
    expect(sanitizeSessions(cleaned)).toEqual(cleaned)
  })

  it('feeds straight into the store', () => {
    const loaded = sanitizeSessions([session({ id: 'a' }), { junk: true }])
    expect(pruneSessions(loaded).map((s) => s.id)).toEqual(['a'])
  })
})

describe('makeSessionId', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  it('is a v4 uuid', () => {
    expect(makeSessionId()).toMatch(UUID)
  })

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 500 }, () => makeSessionId()))
    expect(ids.size).toBe(500)
  })

  it('falls back when the platform has no randomUUID', () => {
    vi.stubGlobal('crypto', {})
    expect(makeSessionId()).toMatch(UUID)
    expect(makeSessionId()).not.toBe(makeSessionId())
  })
})
