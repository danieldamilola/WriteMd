import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { makeTempRoot, cleanupTempRoot } from './helpers/temp-root'
import { ChangeJournal } from '../src/main/ai/journal'
import { applyProposals, type ApplyOptions, type ApplyOutcome } from '../src/main/ai/apply'
import { pathKey } from '../src/main/ai/paths'
import type { BlockFailure, EditBlock, FileProposal } from '../src/main/ai/edit-protocol'

/**
 * Real files, real journal, no mocks.
 *
 * This layer's whole job is the order of operations - stat, read, journal, write,
 * rename - and every one of those touches the filesystem. A mock would let a
 * reordering through that the user would only ever find out about by losing a
 * file, which is the failure the journal exists to prevent.
 *
 * So the assertions are mostly about what must NOT be true afterwards: no
 * journal entry without a change, no change without a journal entry, and no
 * write to a file that changed after the model read it.
 */

let root: string
let vault: string
let journal: ChangeJournal

beforeEach(() => {
  root = makeTempRoot('ai-apply')
  vault = join(root, 'vault')
  mkdirSync(vault, { recursive: true })
  journal = new ChangeJournal(join(root, 'state', 'journal.json'))
})

afterEach(() => {
  cleanupTempRoot(root)
})

function note(name: string): string {
  return join(vault, name)
}

function write(path: string, content: string): void {
  writeFileSync(path, content, 'utf-8')
}

function read(path: string): string {
  return readFileSync(path, 'utf-8')
}

/**
 * The path the implementation will actually use. On macOS a temp directory sits
 * behind a symlink, so the path we wrote through and the canonical path recorded
 * in the journal are not the same string. Comparing case-folded canonical paths
 * keeps the assertions about identity rather than about spelling.
 */
function key(path: string): string {
  return pathKey(realpathSync(path))
}

function block(search: string, replace: string): EditBlock {
  return { path: 'model-path.md', search, replace }
}

function notFound(search: string): BlockFailure {
  return { block: block(search, 'x'), reason: 'not-found' }
}

function proposal(over: {
  path: string
  before?: string
  after?: string
  blocks?: EditBlock[]
  failures?: BlockFailure[]
  isCreation?: boolean
}): FileProposal {
  return {
    path: over.path,
    requestedPath: over.path,
    before: over.before ?? '',
    after: over.after ?? '',
    blocks: over.blocks ?? [],
    failures: over.failures ?? [],
    isCreation: over.isCreation ?? false
  }
}

function run(proposals: FileProposal[], maxFileBytes?: number): Promise<ApplyOutcome> {
  return applyProposals(proposals, {
    sessionId: 's1',
    base: vault,
    journal,
    maxFileBytes
  })
}

describe('applyProposals', () => {
  it('does not write or journal proposals from an already cancelled turn', async () => {
    const path = note('cancelled.md')
    write(path, 'Original')
    const controller = new AbortController()
    controller.abort()
    const outcome = await applyProposals(
      [proposal({ path, before: 'Original', after: 'Changed' })],
      { sessionId: 's1', base: vault, journal, signal: controller.signal }
    )
    expect(outcome).toEqual({ applied: [], skipped: [] })
    expect(read(path)).toBe('Original')
    expect(journal.list('s1')).toEqual([])
  })

  it('checks cancellation before committing the atomic replacement', async () => {
    const path = note('cancelled.md')
    write(path, 'Original')
    const controller = new AbortController()
    const record = journal.record.bind(journal)
    vi.spyOn(journal, 'record').mockImplementation((input) => {
      const entry = record(input)
      queueMicrotask(() => controller.abort())
      return entry
    })
    const outcome = await applyProposals(
      [
        proposal({ path, before: 'Original', after: 'Changed' }),
        proposal({ path: note('later.md'), after: 'Later', isCreation: true })
      ],
      { sessionId: 's1', base: vault, journal, signal: controller.signal }
    )
    expect(outcome).toEqual({ applied: [], skipped: [] })
    expect(read(path)).toBe('Original')
    expect(existsSync(note('later.md'))).toBe(false)
    expect(readdirSync(vault).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  it('writes the proposed content and records one journal entry', async () => {
    const path = note('idea.md')
    write(path, '# old\n')

    const outcome = await run([
      proposal({ path, before: '# old\n', after: '# new\n', blocks: [block('old', 'new')] })
    ])

    expect(outcome.skipped).toEqual([])
    expect(outcome.applied).toHaveLength(1)
    expect(outcome.applied[0].kind).toBe('modified')
    expect(outcome.applied[0].blocks).toBe(1)
    expect(key(outcome.applied[0].path)).toBe(key(path))
    expect(read(path)).toBe('# new\n')

    const entries = journal.list('s1')
    expect(entries).toHaveLength(1)
    expect(pathKey(entries[0].path)).toBe(key(path))
    expect(outcome.applied[0].journalId).toBe(entries[0].id)
  })

  it('leaves the file untouched when one block failed', async () => {
    // The load-bearing case. Two of three blocks matched, so `after` is a
    // perfectly valid-looking document that is silently missing the third
    // change. Writing it would look like the assistant did what it was asked.
    const path = note('idea.md')
    const original = 'alpha\nbravo\ncharlie\n'
    write(path, original)

    const outcome = await run([
      proposal({
        path,
        before: original,
        after: 'A\nB\ncharlie\n',
        blocks: [block('alpha', 'A'), block('bravo', 'B'), block('absent', 'C')],
        failures: [notFound('absent')]
      })
    ])

    expect(read(path)).toBe(original)
    expect(outcome.applied).toEqual([])
    expect(outcome.skipped).toHaveLength(1)
    expect(outcome.skipped[0].reason).toBe('block-failed')
    expect(outcome.skipped[0].detail).toContain('1 of 3 blocks did not apply')
    // No journal entry either: the change did not happen, so there is nothing to
    // put back and an entry would be one more thing to dismiss.
    expect(journal.list()).toEqual([])
  })

  it('names the text it could not find, and says so when it was ambiguous', async () => {
    const path = note('idea.md')
    write(path, 'TODO one\nTODO two\n')

    const outcome = await run([
      proposal({
        path,
        before: 'TODO one\nTODO two\n',
        after: 'DONE\nTODO two\n',
        blocks: [block('TODO', 'DONE')],
        failures: [{ block: block('TODO', 'DONE'), reason: 'ambiguous', at: 0, occurrences: 2 }]
      })
    ])

    expect(outcome.skipped[0].reason).toBe('block-failed')
    expect(outcome.skipped[0].detail).toContain('"TODO"')
    expect(outcome.skipped[0].detail).toContain('appears 2 times')
    expect(read(path)).toBe('TODO one\nTODO two\n')
  })

  it('skips a file that changed after the proposal was computed', async () => {
    // The model read the note, thought for a few seconds, and the user typed in
    // that window. Writing now would silently revert them.
    const path = note('idea.md')
    write(path, '# original\n')
    const pending = proposal({
      path,
      before: '# original\n',
      after: '# assistant\n',
      blocks: [block('original', 'assistant')]
    })
    write(path, '# original\nedited by the user\n')

    const outcome = await run([pending])

    expect(outcome.applied).toEqual([])
    expect(outcome.skipped).toHaveLength(1)
    expect(outcome.skipped[0].reason).toBe('changed-since')
    expect(read(path)).toBe('# original\nedited by the user\n')
    expect(journal.list()).toEqual([])
  })

  it('reports changed-since when the file was deleted since the proposal', async () => {
    const path = note('idea.md')
    write(path, '# original\n')
    const pending = proposal({
      path,
      before: '# original\n',
      after: '# assistant\n',
      blocks: [block('original', 'assistant')]
    })
    rmSync(path)

    const outcome = await run([pending])

    expect(outcome.skipped[0].reason).toBe('changed-since')
    expect(outcome.skipped[0].detail).toContain('deleted')
    expect(existsSync(path)).toBe(false)
    expect(journal.list()).toEqual([])
  })

  it('skips a no-op proposal and records nothing for it', async () => {
    const path = note('idea.md')
    write(path, '# unchanged\n')

    const outcome = await run([
      proposal({
        path,
        before: '# unchanged\n',
        after: '# unchanged\n',
        blocks: [block('unchanged', 'unchanged')]
      })
    ])

    // Not a skip: nothing failed, so there is nothing to report to the user.
    expect(outcome.applied).toEqual([])
    expect(outcome.skipped).toEqual([])
    expect(read(path)).toBe('# unchanged\n')
    expect(journal.list()).toEqual([])
  })

  it('creates a new file, including its parent directories', async () => {
    const path = note(join('notes', 'deeper', 'new.md'))

    const outcome = await run([
      proposal({
        path,
        before: '',
        after: '# Created\n',
        blocks: [block('', '# Created\n')],
        isCreation: true
      })
    ])

    expect(outcome.applied[0].kind).toBe('created')
    expect(read(path)).toBe('# Created\n')
  })

  it('journals a creation with a null before, so undo deletes rather than blanks', async () => {
    const path = note('new.md')
    await run([proposal({ path, before: '', after: '# Created\n', isCreation: true })])

    const entry = journal.list()[0]
    expect(entry.kind).toBe('created')
    // '' would make undo write an empty file and leave it behind, which is not
    // the same as putting the vault back the way it was.
    expect(entry.before).toBeNull()
    expect(journal.undo(entry.id).status).toBe('gone')
    expect(existsSync(path)).toBe(false)
  })

  it('journals the original and new content so the change can be put back', async () => {
    const path = note('idea.md')
    write(path, '# original\n')

    await run([
      proposal({
        path,
        before: '# original\n',
        after: '# rewritten\n',
        blocks: [block('original', 'rewritten')]
      })
    ])

    const entry = journal.list('s1')[0]
    expect(entry.sessionId).toBe('s1')
    expect(entry.kind).toBe('modified')
    expect(entry.before).toBe('# original\n')
    expect(entry.after).toBe('# rewritten\n')

    expect(journal.undo(entry.id).status).toBe('restored')
    expect(read(path)).toBe('# original\n')
  })

  it('keeps going when one file fails', async () => {
    const a = note('a.md')
    const b = note('b.md')
    const c = note('c.md')
    write(a, 'a-original\n')
    write(b, 'b-original\n')
    write(c, 'c-original\n')

    const outcome = await run([
      proposal({ path: a, before: 'a-original\n', after: 'a-new\n' }),
      // Block failed: this one must not land while the others do.
      proposal({
        path: b,
        before: 'b-original\n',
        after: 'b-new\n',
        blocks: [block('original', 'new')],
        failures: [notFound('original')]
      }),
      proposal({ path: c, before: 'c-original\n', after: 'c-new\n' })
    ])

    expect(outcome.applied.map((change) => key(change.path))).toEqual([key(a), key(c)])
    expect(outcome.skipped).toHaveLength(1)
    expect(read(a)).toBe('a-new\n')
    expect(read(b)).toBe('b-original\n')
    expect(read(c)).toBe('c-new\n')
    expect(journal.list()).toHaveLength(2)
  })

  it('refuses a file over the size cap instead of reading it', async () => {
    const path = note('big.md')
    const big = 'x'.repeat(4096)
    write(path, big)

    const outcome = await run([proposal({ path, before: big, after: 'small\n' })], 100)

    expect(outcome.applied).toEqual([])
    expect(outcome.skipped).toHaveLength(1)
    expect(outcome.skipped[0].reason).toBe('too-large')
    expect(outcome.skipped[0].detail).toContain('100 bytes')
    expect(read(path)).toBe(big)
  })

  it('refuses to write a creation whose content is over the cap', async () => {
    // Nothing on disk to measure, so the read-side limit alone would not catch
    // a model that generated half a megabyte of Markdown.
    const path = note('huge.md')

    const outcome = await run(
      [proposal({ path, before: '', after: 'y'.repeat(500), isCreation: true })],
      100
    )

    expect(outcome.skipped[0].reason).toBe('too-large')
    expect(existsSync(path)).toBe(false)
    expect(journal.list()).toEqual([])
  })

  it('reports a directory as unreadable rather than throwing', async () => {
    const path = note('folder')
    mkdirSync(path, { recursive: true })

    const outcome = await run([proposal({ path, before: 'x', after: 'y' })])

    expect(outcome.skipped).toHaveLength(1)
    expect(outcome.skipped[0].reason).toBe('unreadable')
    expect(journal.list()).toEqual([])
  })

  it('reports a path that is not usable as a file', async () => {
    // A NUL truncates the path at the syscall boundary on some platforms and a
    // Windows device name opens a device rather than a file, so one bad path
    // from the model must not take the turn down with it.
    const outcome = await run([
      proposal({ path: join(vault, 'notes\u0000.md'), before: 'x', after: 'y' })
    ])

    expect(outcome.applied).toEqual([])
    expect(outcome.skipped[0].reason).toBe('unreadable')
    expect(outcome.skipped[0].detail).toContain('Not a usable file path')
  })

  it('leaves no temp files behind', async () => {
    const path = note('idea.md')
    write(path, '# original\n')

    await run([proposal({ path, before: '# original\n', after: '# new\n' })])

    expect(readdirSync(vault)).toEqual(['idea.md'])
  })

  it('resolves a relative proposal path against base', async () => {
    const path = note('idea.md')
    write(path, '# original\n')

    const outcome = await applyProposals(
      [proposal({ path: 'idea.md', before: '# original\n', after: '# new\n' })],
      { sessionId: 's1', base: vault, journal }
    )

    expect(outcome.applied).toHaveLength(1)
    expect(read(path)).toBe('# new\n')
  })

  it('throws for a caller that forgot the journal', async () => {
    // A missing dependency is a bug, and reporting it as a skipped file would
    // write nothing while looking like a normal outcome.
    const options = { sessionId: 's1', base: vault } as unknown as ApplyOptions
    await expect(applyProposals([], options)).rejects.toThrow(TypeError)
  })
})

describe('applyProposals file mode', () => {
  // Mode bits do not mean anything on Windows, where the read-only attribute is
  // the only one that survives, so asserting there would test the platform.
  const itPosix = process.platform === 'win32' ? it.skip : it

  itPosix('preserves the mode of the file it replaces', async () => {
    const path = note('secret.md')
    write(path, '# original\n')
    // A fresh temp file would come out 0644 and the rename would silently widen
    // a note the user had restricted.
    chmodSync(path, 0o640)

    const outcome = await run([proposal({ path, before: '# original\n', after: '# new\n' })])

    expect(outcome.applied).toHaveLength(1)
    expect(statSync(path).mode & 0o777).toBe(0o640)
  })

  itPosix('creates a new file owner-only', async () => {
    const path = note('fresh.md')

    await run([proposal({ path, before: '', after: '# new\n', isCreation: true })])

    expect(statSync(path).mode & 0o777).toBe(0o600)
  })
})
