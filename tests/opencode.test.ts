import { describe, expect, it } from 'vitest'
import { psCommand, opencodeLoginCommand, opencodeMajor } from '../src/main/opencode'
import { collectModelIds, parseTextModelList, unionModelIds } from '../src/main/opencode'
import {
  compareSemver,
  extractAssistantTextFromMessage,
  OpencodeStreamAssembler,
  parseOpenCodeModelSlug,
  parseOpenCodeVersion,
  parseServerUrlFromOutput,
  stripToolArtifacts
} from '../src/main/opencode-server'

describe('psCommand quoting', () => {
  it('uses single quotes so Node argv quoting has nothing to mangle', () => {
    // Pre-quoted strings through spawn argv get backslash-escaped by Node,
    // which cmd.exe reads literally. Regression test for:
    // '"C:\…\opencode.cmd"' is not recognized as an internal or external command.
    expect(psCommand('C:\\npm\\opencode.cmd', ['--version'])).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `& 'C:\\npm\\opencode.cmd' --version`
    ])
    expect(psCommand(`C:\\O'Brien\\opencode.cmd`, ['--version'])[3]).toContain(
      `'C:\\O''Brien\\opencode.cmd'`
    )
  })
})

describe('opencode model list parsing', () => {
  it('collects slash ids and provider/model pairs', () => {
    expect(
      collectModelIds(['opencode/big-pickle', { providerID: 'opencode', modelID: 'glm-5' }])
    ).toEqual(['opencode/big-pickle', 'opencode/glm-5'])
  })

  it('prefixes bare names inside provider-keyed nests', () => {
    expect(collectModelIds({ opencode: { models: ['big-pickle'] } })).toEqual([
      'opencode/big-pickle'
    ])
    expect(collectModelIds({ providers: ['x'] })).toEqual([])
  })

  it('reads provider sections out of plain text', () => {
    const out = 'Providers:\nopencode\n  big-pickle   free\nanthropic\n  claude-sonnet-4-6\n'
    expect(parseTextModelList(out)).toEqual(['anthropic/claude-sonnet-4-6', 'opencode/big-pickle'])
  })

  it('reads one-per-line slash ids like `opencode models` prints', () => {
    const out = [
      'opencode/big-pickle',
      'opencode/fledge-alpha-free',
      'opencode/space-bunny-free'
    ].join('\n')
    expect(parseTextModelList(out)).toEqual([
      'opencode/big-pickle',
      'opencode/fledge-alpha-free',
      'opencode/space-bunny-free'
    ])
  })

  it('unions both list variants, sorted and deduplicated', () => {
    expect(unionModelIds(['b', 'a'], ['a', 'c'])).toEqual(['a', 'b', 'c'])
    expect(unionModelIds([], [])).toEqual([])
  })
})

describe('opencode console login command', () => {
  it('uses auth login on v2 and console login on v1', () => {
    expect(opencodeMajor('1.18.34')).toBe(1)
    expect(opencodeMajor('opencode v2.3.1')).toBe(2)
    expect(opencodeMajor(null)).toBeNull()
    expect(opencodeLoginCommand(2)).toBe('opencode auth login opencode')
    expect(opencodeLoginCommand(1)).toBe('opencode console login')
    expect(opencodeLoginCommand(null)).toBe('opencode console login')
  })
})

describe('opencode serve contract', () => {
  it('parses provider/model slugs, keeping the full model id', () => {
    expect(parseOpenCodeModelSlug('opencode/big-pickle')).toEqual({
      providerID: 'opencode',
      modelID: 'big-pickle'
    })
    expect(parseOpenCodeModelSlug('anthropic/claude-sonnet-4-6')).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4-6'
    })
    expect(parseOpenCodeModelSlug('glm-5')).toBeNull()
    expect(parseOpenCodeModelSlug('/model')).toBeNull()
    expect(parseOpenCodeModelSlug('provider/')).toBeNull()
    expect(parseOpenCodeModelSlug(null)).toBeNull()
  })

  it('parses versions and compares semver', () => {
    expect(parseOpenCodeVersion('opencode 1.18.34')).toBe('1.18.34')
    expect(parseOpenCodeVersion('nope')).toBeNull()
    expect(compareSemver('1.18.34', '1.14.19')).toBeGreaterThan(0)
    expect(compareSemver('1.14.19', '1.14.19')).toBe(0)
    expect(compareSemver('1.9.0', '1.14.19')).toBeLessThan(0)
  })

  it('finds the server URL in serve output', () => {
    expect(parseServerUrlFromOutput('opencode server listening on http://127.0.0.1:4096\n')).toBe(
      'http://127.0.0.1:4096'
    )
    expect(parseServerUrlFromOutput('booting...\n')).toBeNull()
  })

  it('pulls assistant text out of a blocking message response', () => {
    expect(
      extractAssistantTextFromMessage({
        info: { role: 'assistant' },
        parts: [
          { type: 'text', text: 'hello ' },
          { type: 'text', text: 'world' },
          { type: 'tool', state: {} }
        ]
      })
    ).toBe('hello world')
    expect(extractAssistantTextFromMessage({ info: { role: 'user' }, parts: [] })).toBe('')
  })

  it('buffers early deltas and ends on idle', () => {
    const asm = new OpencodeStreamAssembler()
    const session = 'ses_1'
    // Deltas racing ahead of the role announcement buffer instead of leaking.
    expect(
      asm.feedEvent({ type: 'message.part.delta', properties: { partID: 'p1', delta: 'hi' } })
    ).toBe('')
    asm.feedEvent({
      type: 'message.updated',
      properties: { info: { id: 'm1', role: 'assistant' } }
    })
    expect(
      asm.feedEvent({
        type: 'message.part.updated',
        properties: { part: { id: 'p1', type: 'text', messageID: 'm1', text: 'hi there' } }
      })
    ).toBe('hi there')
    // Live deltas on a known-assistant part stream through.
    expect(
      asm.feedEvent({ type: 'message.part.delta', properties: { partID: 'p1', delta: '!' } })
    ).toBe('!')
    // User-role parts never leak into the transcript.
    asm.feedEvent({
      type: 'message.updated',
      properties: { info: { id: 'm2', role: 'user' } }
    })
    expect(
      asm.feedEvent({
        type: 'message.part.updated',
        properties: { part: { id: 'p2', type: 'text', messageID: 'm2', text: 'echo?' } }
      })
    ).toBe('')
    expect(
      asm.feedEvent({ type: 'message.part.delta', properties: { partID: 'p2', delta: 'echo?' } })
    ).toBe('')
    expect(OpencodeStreamAssembler.isIdleFor({ type: 'other', properties: {} }, session)).toBe(
      false
    )
    expect(
      OpencodeStreamAssembler.isIdleFor(
        { type: 'session.status', properties: { sessionID: session, status: { type: 'idle' } } },
        session
      )
    ).toBe(true)
    expect(asm.fullText).toBe('hi there!')
  })

  it('surfaces session errors', () => {
    expect(
      OpencodeStreamAssembler.sessionError(
        {
          type: 'session.error',
          properties: { sessionID: 's', error: { name: 'E', data: { message: 'boom' } } }
        },
        's'
      )
    ).toBe('boom')
    expect(
      OpencodeStreamAssembler.sessionError(
        { type: 'session.error', properties: { sessionID: 'other', error: { name: 'E' } } },
        's'
      )
    ).toBeNull()
  })
})

describe('stripToolArtifacts', () => {
  it('removes tool-call markup but keeps prose and code', () => {
    const input = [
      'Checking the docs.',
      '[minimax][<tool-call>][minimax][<invoke name="bash">]',
      '```python',
      'print("hi")',
      '```',
      '<tool_call>{"a":1}</tool_call>'
    ].join('\n')
    const out = stripToolArtifacts(input)
    expect(out).toContain('Checking the docs.')
    expect(out).toContain('print("hi")')
    expect(out).not.toContain('tool-call')
    expect(out).not.toContain('tool_call')
    expect(out).not.toContain('<invoke')
  })

  it('leaves normal markdown alone', () => {
    const md = '# Title\n\nSome **bold** text.\n\n- item\n\n```writemd-replace\nnew\n```'
    expect(stripToolArtifacts(md)).toBe(md)
  })
})
