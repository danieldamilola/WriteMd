import { describe, it, expect } from 'vitest'
import { isAbsolute, join } from 'path'
import {
  parseEdits,
  applyEdits,
  editSystemPrompt,
  resolveRequestedPath,
  type ParsedEdits
} from '../src/main/ai/edit-protocol'

/**
 * The protocol is the seam between a language model and the user's files, and
 * its failure modes are silent rather than loud: a block that fails to match
 * produces a document missing that change, and if that gets written the user
 * sees an edit they never asked for and cannot account for.
 *
 * So the tests care most about what does NOT happen: a partial application is
 * never written, and an ambiguous match never picks one.
 */

const NO_RESOLVE = (p: string): string => p

function contents(
  entries: Record<string, string>
): Map<string, { content: string; exists: boolean }> {
  return new Map(
    Object.entries(entries).map(([path, content]) => [path, { content, exists: true }])
  )
}

describe('parseEdits', () => {
  it('reads a direct whole-document rewrite without an echoed original', () => {
    const parsed = parseEdits(
      '<<<<<<< REWRITE path="note.md"\n# New document\n\nNew body.\n>>>>>>> REPLACE',
      'open.md'
    )
    expect(parsed.blocks).toEqual([
      { path: 'note.md', search: '', replace: '# New document\n\nNew body.', wholeFile: true }
    ])
    expect(parsed.explanation).toBe('')
    const applied = applyEdits(
      parsed,
      contents({ 'note.md': 'Old body.' }),
      NO_RESOLVE,
      new Map([['note.md', 'Old body.']])
    )
    expect(applied.proposals[0].after).toBe('# New document\n\nNew body.')
    expect(applied.proposals[0].failures).toEqual([])
  })

  it('refuses a whole rewrite of a changed or unseen file', () => {
    const parsed = parseEdits('<<<<<<< REWRITE\nNew body.\n>>>>>>> REPLACE', 'note.md')
    for (const snapshots of [new Map<string, string>(), new Map([['note.md', 'Stale body.']])]) {
      const applied = applyEdits(
        parsed,
        contents({ 'note.md': 'Current body.' }),
        NO_RESOLVE,
        snapshots
      )
      expect(applied.skippedPaths).toEqual(['note.md'])
      expect(applied.proposals[0].after).toBe('Current body.')
    }
  })

  it('marks an unfinished rewrite incomplete, including after a completed local edit', () => {
    const parsed = parseEdits(
      '<<<<<<< SEARCH\nOld\n=======\nNew\n>>>>>>> REPLACE\n<<<<<<< REWRITE\nHalf a document',
      'note.md'
    )
    expect(parsed.incomplete).toBe(true)
    expect(parsed.blocks).toHaveLength(1)
  })
  it('reads a single block', () => {
    const result = parseEdits(
      '<<<<<<< SEARCH path="a.md"\nold line\n=======\nnew line\n>>>>>>> REPLACE',
      'default.md'
    )
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0]).toEqual({ path: 'a.md', search: 'old line', replace: 'new line' })
  })

  it('falls back to the open file when no path is given', () => {
    const result = parseEdits('<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE', 'open.md')
    expect(result.blocks[0].path).toBe('open.md')
  })

  it('accepts single-quoted and bare paths', () => {
    // Models are inconsistent here, and rejecting a variant the model used to
    // be helpful produces a confusing silent no-op.
    expect(
      parseEdits("<<<<<<< SEARCH path='a.md'\nx\n=======\ny\n>>>>>>> REPLACE", 'd').blocks[0].path
    ).toBe('a.md')
    expect(
      parseEdits('<<<<<<< SEARCH path=a.md\nx\n=======\ny\n>>>>>>> REPLACE', 'd').blocks[0].path
    ).toBe('a.md')
  })

  it('reads multiple blocks for multiple files', () => {
    const result = parseEdits(
      [
        '<<<<<<< SEARCH path="a.md"',
        'one',
        '=======',
        'ONE',
        '>>>>>>> REPLACE',
        '<<<<<<< SEARCH path="b.md"',
        'two',
        '=======',
        'TWO',
        '>>>>>>> REPLACE'
      ].join('\n'),
      'd.md'
    )
    expect(result.blocks.map((b) => b.path)).toEqual(['a.md', 'b.md'])
  })

  it('keeps the prose around the blocks as the explanation', () => {
    const result = parseEdits(
      'Tightened the intro.\n\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE',
      'd.md'
    )
    expect(result.explanation).toBe('Tightened the intro.')
  })

  it('reports a plain answer as not an edit', () => {
    const result = parseEdits('It defines a protocol for streaming.', 'd.md')
    expect(result.hasEdits).toBe(false)
    expect(result.blocks).toEqual([])
    expect(result.explanation).toContain('protocol')
  })

  it('preserves whitespace inside the search text', () => {
    // Indentation is meaning in Markdown and in every language with blocks.
    const result = parseEdits(
      '<<<<<<< SEARCH\n    - nested\n        deeper\n=======\n    - flat\n>>>>>>> REPLACE',
      'd.md'
    )
    expect(result.blocks[0].search).toBe('    - nested\n        deeper')
  })

  it('handles CRLF line endings', () => {
    const result = parseEdits(
      '<<<<<<< SEARCH path="a.md"\r\nold\r\n=======\r\nnew\r\n>>>>>>> REPLACE',
      'd.md'
    )
    expect(result.blocks[0].search).toBe('old')
    expect(result.blocks[0].replace).toBe('new')
  })

  it('handles an empty replacement, which is a deletion', () => {
    const result = parseEdits('<<<<<<< SEARCH\nremove me\n=======\n>>>>>>> REPLACE', 'd.md')
    expect(result.blocks[0].replace).toBe('')
  })
})

describe('applyEdits', () => {
  const single = (response: string): ParsedEdits => parseEdits(response, 'a.md')

  it('applies a block', () => {
    const result = applyEdits(
      single('<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE'),
      contents({ 'a.md': 'keep\nold\nkeep too\n' }),
      NO_RESOLVE
    )
    expect(result.proposals[0].after).toBe('keep\nnew\nkeep too\n')
    expect(result.proposals[0].failures).toEqual([])
  })

  it('applies several blocks in order', () => {
    const result = applyEdits(
      single(
        [
          '<<<<<<< SEARCH',
          'ALPHA',
          '=======',
          'a',
          '>>>>>>> REPLACE',
          '<<<<<<< SEARCH',
          'bravo',
          '=======',
          'b',
          '>>>>>>> REPLACE',
          '<<<<<<< SEARCH',
          'CHARLIE',
          '=======',
          'c',
          '>>>>>>> REPLACE'
        ].join('\n')
      ),
      contents({ 'a.md': 'ALPHA\nbravo\nCHARLIE\n' }),
      NO_RESOLVE
    )
    expect(result.proposals[0].after).toBe('a\nb\nc\n')
    expect(result.proposals[0].failures).toEqual([])
  })

  it('marks the file to skip when a block does not match', () => {
    // The load-bearing case. Writing this would commit a partial rewrite that
    // looks complete.
    const result = applyEdits(
      single('<<<<<<< SEARCH\nnot there\n=======\nx\n>>>>>>> REPLACE'),
      contents({ 'a.md': 'actual content\n' }),
      NO_RESOLVE
    )
    expect(result.proposals[0].failures[0].reason).toBe('not-found')
    expect(result.skippedPaths).toEqual(['a.md'])
  })

  it('skips the whole file when only one of several blocks failed', () => {
    const result = applyEdits(
      single(
        '<<<<<<< SEARCH\npresent\n=======\nchanged\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nabsent\n=======\nx\n>>>>>>> REPLACE'
      ),
      contents({ 'a.md': 'present\n' }),
      NO_RESOLVE
    )
    expect(result.proposals[0].failures).toHaveLength(1)
    expect(result.skippedPaths).toEqual(['a.md'])
  })

  it('refuses to guess when the search text appears more than once', () => {
    const result = applyEdits(
      single('<<<<<<< SEARCH\nTODO\n=======\nDONE\n>>>>>>> REPLACE'),
      contents({ 'a.md': 'TODO one\nTODO two\n' }),
      NO_RESOLVE
    )
    expect(result.proposals[0].failures[0].reason).toBe('ambiguous')
    expect(result.proposals[0].failures[0].occurrences).toBe(2)
    // Applying to the first hit is how a rewrite lands somewhere the model
    // never meant, so the content is untouched.
    expect(result.proposals[0].after).toBe('TODO one\nTODO two\n')
    expect(result.skippedPaths).toEqual(['a.md'])
  })

  it('applies a search that is genuinely unique even when other text repeats', () => {
    const result = applyEdits(
      single('<<<<<<< SEARCH\nUNIQUE-MARKER\n=======\nreplaced\n>>>>>>> REPLACE'),
      contents({ 'a.md': 'TODO\nUNIQUE-MARKER\nTODO\n' }),
      NO_RESOLVE
    )
    expect(result.proposals[0].failures).toEqual([])
    expect(result.proposals[0].after).toBe('TODO\nreplaced\nTODO\n')
  })

  it('applies a deletion', () => {
    const result = applyEdits(
      single('<<<<<<< SEARCH\ngone\n=======\n>>>>>>> REPLACE'),
      contents({ 'a.md': 'keep\ngone\nkeep\n' }),
      NO_RESOLVE
    )
    expect(result.proposals[0].after).toBe('keep\n\nkeep\n')
    expect(result.proposals[0].failures).toEqual([])
  })

  it('removes a whole line when the search includes its trailing newline', () => {
    // The form the system prompt has to describe. Search text is matched
    // literally, so a bare `gone` leaves the blank line that used to hold it -
    // a real behaviour rather than a bug, but the model needs to be told.
    // The newline that goes is the trailing one: including the leading one as
    // well joins the neighbouring lines instead.
    const parsed = single('<<<<<<< SEARCH\ngone\n\n=======\n>>>>>>> REPLACE')
    expect(parsed.blocks[0].search).toBe('gone\n')
    const result = applyEdits(parsed, contents({ 'a.md': 'keep\ngone\nkeep\n' }), NO_RESOLVE)
    expect(result.proposals[0].after).toBe('keep\nkeep\n')
    expect(result.proposals[0].failures).toEqual([])
  })

  it('applies blocks sequentially, against already-modified text', () => {
    const result = applyEdits(
      single(
        '<<<<<<< SEARCH\nA\n=======\nB\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nB C\n=======\nD\n>>>>>>> REPLACE'
      ),
      contents({ 'a.md': 'A C\n' }),
      NO_RESOLVE
    )
    expect(result.proposals[0].failures).toEqual([])
    expect(result.proposals[0].after).toBe('D\n')
  })

  it('rewrites a whole file from one block', () => {
    const result = applyEdits(
      single('<<<<<<< SEARCH\nold document\n=======\nbrand new\n>>>>>>> REPLACE'),
      contents({ 'a.md': 'old document' }),
      NO_RESOLVE
    )
    expect(result.proposals[0].after).toBe('brand new')
  })

  it('handles several files independently', () => {
    const parsed = parseEdits(
      '<<<<<<< SEARCH path="a.md"\nA\n=======\nA2\n>>>>>>> REPLACE\n<<<<<<< SEARCH path="b.md"\nB\n=======\nB2\n>>>>>>> REPLACE',
      'd.md'
    )
    const result = applyEdits(parsed, contents({ 'a.md': 'A', 'b.md': 'B' }), NO_RESOLVE)
    expect(result.proposals.map((p) => p.after).sort()).toEqual(['A2', 'B2'])
    expect(result.skippedPaths).toEqual([])
  })

  it('skips only the failing file when another succeeds', () => {
    const parsed = parseEdits(
      '<<<<<<< SEARCH path="a.md"\nA\n=======\nA2\n>>>>>>> REPLACE\n<<<<<<< SEARCH path="b.md"\nMISSING\n=======\nx\n>>>>>>> REPLACE',
      'd.md'
    )
    const result = applyEdits(parsed, contents({ 'a.md': 'A', 'b.md': 'B' }), NO_RESOLVE)
    expect(result.proposals.find((p) => p.path === 'a.md')?.failures).toEqual([])
    expect(result.skippedPaths).toEqual(['b.md'])
  })

  it('creates a file that does not exist yet', () => {
    const map = new Map([['a.md', { content: '', exists: false }]])
    const result = applyEdits(
      single('<<<<<<< SEARCH\n\n=======\n# Created\n>>>>>>> REPLACE'),
      map,
      NO_RESOLVE
    )
    expect(result.proposals[0].isCreation).toBe(true)
    expect(result.proposals[0].after).toBe('# Created')
    expect(result.proposals[0].failures).toEqual([])
  })

  it('treats an empty search on a file with content as ambiguous', () => {
    // An empty SEARCH matches everywhere, so it cannot mean one region. Saying
    // so is better than applying it at offset zero.
    const result = applyEdits(
      single('<<<<<<< SEARCH\n\n=======\nreplacement\n>>>>>>> REPLACE'),
      contents({ 'a.md': 'existing content\n' }),
      NO_RESOLVE
    )
    expect(result.proposals[0].failures[0].reason).toBe('ambiguous')
    expect(result.proposals[0].after).toBe('existing content\n')
    expect(result.skippedPaths).toEqual(['a.md'])
  })

  it('drops a block whose path cannot be resolved', () => {
    const parsed = parseEdits(
      '<<<<<<< SEARCH path="a.md"\nA\n=======\nA2\n>>>>>>> REPLACE\n<<<<<<< SEARCH path="nope.md"\nB\n=======\nB2\n>>>>>>> REPLACE',
      'd.md'
    )
    // Only the unknown path fails to resolve; the known one must still land.
    const result = applyEdits(parsed, contents({ 'a.md': 'A' }), (p) =>
      p === 'a.md' ? 'a.md' : null
    )
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].path).toBe('a.md')
    expect(result.proposals[0].after).toBe('A2')
  })

  it('produces nothing for a plain answer', () => {
    const result = applyEdits(
      single('Just a normal sentence.'),
      contents({ 'a.md': 'x' }),
      NO_RESOLVE
    )
    expect(result.hasEdits).toBe(false)
    expect(result.proposals).toEqual([])
  })
})

describe('editSystemPrompt', () => {
  it('names the open file as the default so single-file prompts stay short', () => {
    const prompt = editSystemPrompt('notes/idea.md')
    expect(prompt).toContain('path="notes/idea.md"')
  })

  it('omits the path when there is no default', () => {
    expect(editSystemPrompt('')).not.toContain('path=')
  })

  it('states the rules that stop silent partial writes', () => {
    const prompt = editSystemPrompt('a.md')
    expect(prompt).toContain('exactly once')
    expect(prompt).toContain('not applied')
  })
})

describe('resolveRequestedPath', () => {
  // path.join uses the platform separator, so these compare against join()
  // rather than a hardcoded string that is only right on one OS.
  it('keeps an absolute path', () => {
    const absolute = isAbsolute('C:/vault/a.md') ? 'C:/vault/a.md' : '/vault/a.md'
    expect(resolveRequestedPath(absolute, '/other')).toBe(absolute)
  })

  it('resolves a relative path against the base', () => {
    const base = isAbsolute('C:/vault') ? 'C:/vault' : '/vault'
    expect(resolveRequestedPath('notes/a.md', base)).toBe(join(base, 'notes/a.md'))
  })

  it('rejects an empty path', () => {
    expect(resolveRequestedPath('   ', 'C:/vault')).toBeNull()
  })

  it('rejects a NUL byte', () => {
    expect(resolveRequestedPath('a.md\0.png', 'C:/vault')).toBeNull()
  })
})
