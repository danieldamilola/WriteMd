import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { makeTempRoot, cleanupTempRoot } from './helpers/temp-root'
import { ChangeJournal, findLatestEntry } from '../src/main/ai/journal'
import type { JournalEntry } from '../src/shared/ai/types'

/**
 * The journal is the only thing standing between "the assistant edited four
 * notes without asking" and "the user cannot get them back", so these tests
 * lean on one property above all others: an entry taken before a write has to
 * be able to put the file back exactly, and undo has to refuse - loudly, and
 * without touching the file - whenever doing that is no longer safe.
 *
 * The refusal cases are not defensive noise. "Changed since" is the common case
 * in real use: the user opens the note the assistant just rewrote, fixes a
 * typo, and only then goes looking for undo.
 */

const T0 = 1_700_000_000_000
const DAY_MS = 24 * 60 * 60 * 1000

let root: string
let vault: string
let journalPath: string

beforeEach(() => {
  root = makeTempRoot('ai-journal')
  vault = join(root, 'vault')
  mkdirSync(vault, { recursive: true })
  journalPath = join(root, 'state', 'journal.json')
})

afterEach(() => {
  vi.useRealTimers()
  cleanupTempRoot(root)
})

function notePath(name: string): string {
  return join(vault, name)
}

function writeNote(path: string, content: string): void {
  writeFileSync(path, content, 'utf-8')
}

function readNote(path: string): string {
  return readFileSync(path, 'utf-8')
}

function readJournalFile(): { version: number; entries: JournalEntry[] } {
  return JSON.parse(readFileSync(journalPath, 'utf-8')) as {
    version: number
    entries: JournalEntry[]
  }
}

describe('undo restores what was there before the write', () => {
  it('puts the original content back', () => {
    const path = notePath('idea.md')
    writeNote(path, '# original\n')

    const journal = new ChangeJournal(journalPath)
    const entry = journal.record({
      sessionId: 's1',
      path,
      before: '# original\n',
      after: '# rewritten\n',
      kind: 'modified'
    })
    writeNote(path, '# rewritten\n')

    expect(journal.undo(entry.id)).toEqual({ status: 'restored', path })
    expect(readNote(path)).toBe('# original\n')
    expect(journal.list()[0].revertedAt).toBeTypeOf('number')
  })

  it('records the change before the write, and refuses while the write has not landed', () => {
    // The caller is meant to record first. Undo while the file still holds the
    // pre-change content must refuse rather than "restore" a state it is
    // already in and report success for it.
    const path = notePath('idea.md')
    writeNote(path, '# original\n')

    const journal = new ChangeJournal(journalPath)
    const entry = journal.record({
      sessionId: 's1',
      path,
      before: '# original\n',
      after: '# rewritten\n',
      kind: 'modified'
    })

    expect(journal.undo(entry.id).status).toBe('changed-since')
    expect(readNote(path)).toBe('# original\n')
    expect(journal.list()[0].revertedAt).toBeNull()
  })

  it('restores an emptied file rather than deleting it', () => {
    // `before: ''` and `before: null` are different states: one is a file the
    // user had, the other is no file. A falsy check would delete it.
    const path = notePath('blank.md')
    writeNote(path, '')

    const journal = new ChangeJournal(journalPath)
    const entry = journal.record({
      sessionId: 's1',
      path,
      before: '',
      after: '# filled in\n',
      kind: 'modified'
    })
    writeNote(path, '# filled in\n')

    expect(journal.undo(entry.id)).toEqual({ status: 'restored', path })
    expect(existsSync(path)).toBe(true)
    expect(readNote(path)).toBe('')
  })

  it('recreates the directory when the file had been removed from under it', () => {
    const path = notePath('nested/deep/idea.md')
    mkdirSync(join(vault, 'nested', 'deep'), { recursive: true })
    writeNote(path, '# original\n')

    const journal = new ChangeJournal(journalPath)
    const entry = journal.record({
      sessionId: 's1',
      path,
      before: '# original\n',
      after: '# rewritten\n',
      kind: 'modified'
    })
    rmSync(join(vault, 'nested'), { recursive: true, force: true })
    // The file went with the directory, so undo refuses rather than guessing.
    expect(journal.undo(entry.id).status).toBe('changed-since')

    const restored = new ChangeJournal(journalPath).undo(entry.id)
    expect(restored.status).toBe('changed-since')
    expect(existsSync(path)).toBe(false)
  })
})

describe('undo of a creation', () => {
  it('deletes the file', () => {
    const path = notePath('fresh.md')
    const journal = new ChangeJournal(journalPath)
    const entry = journal.record({
      sessionId: 's1',
      path,
      before: null,
      after: '# new note\n',
      kind: 'created'
    })
    writeNote(path, '# new note\n')

    expect(journal.undo(entry.id)).toEqual({ status: 'gone', path })
    expect(existsSync(path)).toBe(false)
    expect(journal.list()[0].revertedAt).toBeTypeOf('number')
  })

  it('deletes a file the user has not touched since', () => {
    const path = notePath('fresh.md')
    writeNote(path, '# new note\n')
    const journal = new ChangeJournal(journalPath)
    const entry = journal.record({
      sessionId: 's1',
      path,
      before: null,
      after: readNote(path),
      kind: 'created'
    })

    expect(journal.undo(entry.id).status).toBe('gone')
    expect(existsSync(path)).toBe(false)
  })
})

describe('undo refuses when it is no longer safe', () => {
  it('reports changed-since and leaves the newer edit alone', () => {
    const path = notePath('idea.md')
    writeNote(path, '# original\n')

    const journal = new ChangeJournal(journalPath)
    const entry = journal.record({
      sessionId: 's1',
      path,
      before: '# original\n',
      after: '# rewritten\n',
      kind: 'modified'
    })
    writeNote(path, '# rewritten\n')
    writeNote(path, '# rewritten, then the user fixed a typo\n')

    const outcome = journal.undo(entry.id)
    expect(outcome.status).toBe('changed-since')
    if (outcome.status !== 'changed-since') throw new Error('expected changed-since')
    expect(outcome.path).toBe(path)
    expect(outcome.entry.id).toBe(entry.id)
    expect(readNote(path)).toBe('# rewritten, then the user fixed a typo\n')

    // Not marked reverted, so the refusal is repeatable and still correct after
    // the user closes the app and comes back.
    expect(journal.list()[0].revertedAt).toBeNull()
    expect(journal.undo(entry.id).status).toBe('changed-since')
  })

  it('reports changed-since when a modified file has since been deleted', () => {
    const path = notePath('idea.md')
    writeNote(path, '# original\n')

    const journal = new ChangeJournal(journalPath)
    const entry = journal.record({
      sessionId: 's1',
      path,
      before: '# original\n',
      after: '# rewritten\n',
      kind: 'modified'
    })
    writeNote(path, '# rewritten\n')
    rmSync(path)

    expect(journal.undo(entry.id).status).toBe('changed-since')
    // Writing `before` back would resurrect a file the user has deleted.
    expect(existsSync(path)).toBe(false)
    expect(journal.list()[0].revertedAt).toBeNull()
  })

  it('reports already-reverted for an entry that has been undone', () => {
    const path = notePath('idea.md')
    writeNote(path, '# original\n')

    const journal = new ChangeJournal(journalPath)
    const entry = journal.record({
      sessionId: 's1',
      path,
      before: '# original\n',
      after: '# rewritten\n',
      kind: 'modified'
    })
    writeNote(path, '# rewritten\n')

    expect(journal.undo(entry.id).status).toBe('restored')
    expect(journal.undo(entry.id)).toEqual({ status: 'already-reverted', path })
    expect(readNote(path)).toBe('# original\n')
  })

  it('reports unknown for an id it has never seen', () => {
    const journal = new ChangeJournal(journalPath)
    expect(journal.undo('not-a-real-id')).toEqual({ status: 'unknown', id: 'not-a-real-id' })
  })

  it('reports changed-since when the file has become a directory', () => {
    const path = notePath('idea.md')
    writeNote(path, '# original\n')
    const journal = new ChangeJournal(journalPath)
    const entry = journal.record({
      sessionId: 's1',
      path,
      before: '# original\n',
      after: '# rewritten\n',
      kind: 'modified'
    })
    writeNote(path, '# rewritten\n')
    rmSync(path)
    mkdirSync(path)

    expect(journal.undo(entry.id).status).toBe('changed-since')
    expect(journal.list()[0].revertedAt).toBeNull()
  })
})

describe('list and listSince', () => {
  it('filters by session and orders newest first', () => {
    vi.useFakeTimers()
    const journal = new ChangeJournal(journalPath)

    vi.setSystemTime(T0)
    const first = journal.record({
      sessionId: 's1',
      path: notePath('a.md'),
      before: 'a0',
      after: 'a1',
      kind: 'modified'
    })
    vi.setSystemTime(T0 + 1000)
    const other = journal.record({
      sessionId: 's2',
      path: notePath('b.md'),
      before: 'b0',
      after: 'b1',
      kind: 'modified'
    })
    vi.setSystemTime(T0 + 2000)
    const second = journal.record({
      sessionId: 's1',
      path: notePath('c.md'),
      before: 'c0',
      after: 'c1',
      kind: 'modified'
    })

    expect(journal.list().map((e) => e.id)).toEqual([second.id, other.id, first.id])
    expect(journal.list('s1').map((e) => e.id)).toEqual([second.id, first.id])
    expect(journal.list('nobody')).toEqual([])
  })

  it('orders entries recorded in the same millisecond newest first', () => {
    // Twelve notes rewritten in one turn land inside one tick. Ordering those by
    // clock alone returns them in the order they happened, which is backwards.
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const journal = new ChangeJournal(journalPath)
    const ids = ['a', 'b', 'c'].map(
      (name) =>
        journal.record({
          sessionId: 's1',
          path: notePath(`${name}.md`),
          before: `${name}0`,
          after: `${name}1`,
          kind: 'modified'
        }).id
    )
    expect(journal.list().map((e) => e.id)).toEqual([...ids].reverse())
  })

  it('listSince returns only un-reverted changes at or after the cut-off', () => {
    vi.useFakeTimers()
    const path = notePath('created.md')
    const journal = new ChangeJournal(journalPath)

    vi.setSystemTime(T0)
    const early = journal.record({
      sessionId: 's1',
      path,
      before: null,
      after: 'created\n',
      kind: 'created'
    })
    vi.setSystemTime(T0 + 1000)
    const late = journal.record({
      sessionId: 's1',
      path: notePath('created.md'),
      before: null,
      after: 'created again\n',
      kind: 'created'
    })
    writeNote(path, 'created\n')
    expect(journal.undo(early.id).status).toBe('gone')

    expect(journal.listSince('s1', T0 + 1000).map((e) => e.id)).toEqual([late.id])
    // Everything still undoable from the start of the turn, reverted excluded.
    expect(journal.listSince('s1', T0).map((e) => e.id)).toEqual([late.id])
    expect(journal.listSince('s2', T0)).toEqual([])
  })
})

describe('undoMany', () => {
  it('unwinds overlapping edits to one file back to the original', () => {
    const path = notePath('idea.md')
    writeNote(path, 'v0')

    const journal = new ChangeJournal(journalPath)
    const first = journal.record({
      sessionId: 's1',
      path,
      before: 'v0',
      after: 'v1',
      kind: 'modified'
    })
    writeNote(path, 'v1')
    const second = journal.record({
      sessionId: 's1',
      path,
      before: 'v1',
      after: 'v2',
      kind: 'modified'
    })
    writeNote(path, 'v2')

    // Newest first. Oldest first would fail on the first step, because by then
    // the file holds 'v2' and no longer matches the older entry's 'after'.
    const outcomes = journal.undoMany([first.id, second.id])
    expect(outcomes.map((o) => o.status)).toEqual(['restored', 'restored'])
    expect(readNote(path)).toBe('v0')
  })

  it('undoes several unrelated changes and reports the ones it cannot', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const journal = new ChangeJournal(journalPath)

    const keepPath = notePath('keep.md')
    writeNote(keepPath, 'keep0')
    const keep = journal.record({
      sessionId: 's1',
      path: keepPath,
      before: 'keep0',
      after: 'keep1',
      kind: 'modified'
    })
    writeNote(keepPath, 'keep1')

    vi.setSystemTime(T0 + 1000)
    const touchPath = notePath('touched.md')
    writeNote(touchPath, 'touch0')
    const touched = journal.record({
      sessionId: 's1',
      path: touchPath,
      before: 'touch0',
      after: 'touch1',
      kind: 'modified'
    })
    writeNote(touchPath, 'touch1')
    writeNote(touchPath, 'the user got there first')

    const outcomes = journal.undoMany([touched.id, 'missing-id', keep.id])
    expect(outcomes.map((o) => o.status).sort()).toEqual(['changed-since', 'restored', 'unknown'])
    expect(readNote(keepPath)).toBe('keep0')
    expect(readNote(touchPath)).toBe('the user got there first')
  })
})

describe('persistence', () => {
  it('sees entries written by an earlier instance', () => {
    const path = notePath('idea.md')
    writeNote(path, '# original\n')

    const first = new ChangeJournal(journalPath)
    const entry = first.record({
      sessionId: 's1',
      path,
      before: '# original\n',
      after: '# rewritten\n',
      kind: 'modified'
    })
    writeNote(path, '# rewritten\n')

    // A restart is the normal case: the app closed between the edit and the
    // undo, and the journal on disk is the only thing that remembers.
    const second = new ChangeJournal(journalPath)
    expect(second.list().map((e) => e.id)).toEqual([entry.id])
    expect(second.undo(entry.id)).toEqual({ status: 'restored', path })
    expect(readNote(path)).toBe('# original\n')
  })

  it('writes a versioned file holding every field undo needs', () => {
    const path = notePath('idea.md')
    const journal = new ChangeJournal(journalPath)
    journal.record({ sessionId: 's1', path, before: null, after: 'x\n', kind: 'created' })

    const onDisk = readJournalFile()
    expect(onDisk.version).toBe(1)
    expect(onDisk.entries).toHaveLength(1)
    expect(onDisk.entries[0]).toMatchObject({
      sessionId: 's1',
      path,
      kind: 'created',
      before: null,
      after: 'x\n',
      revertedAt: null
    })
    expect(typeof onDisk.entries[0].id).toBe('string')
    expect(onDisk.entries[0].createdAt).toBeTypeOf('number')
  })

  it('keeps an un-reverted entry loadable as un-reverted', () => {
    // `revertedAt: undefined` reads as "already reverted" to any check written
    // as `!== null`, and an entry that has never been undone would then report
    // itself un-undoable. Silent, and the worst possible time for it.
    const path = notePath('idea.md')
    writeNote(path, '# original\n')
    mkdirSync(dirname(journalPath), { recursive: true })
    writeFileSync(
      journalPath,
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: 'e1',
            sessionId: 's1',
            path,
            kind: 'modified',
            before: '# original\n',
            after: '# rewritten\n',
            createdAt: T0
          }
        ]
      }),
      'utf-8'
    )
    writeNote(path, '# rewritten\n')

    const journal = new ChangeJournal(journalPath)
    expect(journal.list()[0].revertedAt).toBeNull()
    expect(journal.undo('e1')).toEqual({ status: 'restored', path })
    expect(readNote(path)).toBe('# original\n')
  })

  it('drops entries that are not usable rather than loading them', () => {
    mkdirSync(dirname(journalPath), { recursive: true })
    writeFileSync(
      journalPath,
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: 'good',
            sessionId: 's1',
            path: 'a.md',
            kind: 'modified',
            before: null,
            after: '',
            createdAt: T0
          },
          { sessionId: 's1', path: 'b.md', kind: 'modified', before: null, after: '' },
          { id: 'no-after', sessionId: 's1', path: 'c.md', kind: 'modified', before: null },
          {
            id: 'bad-kind',
            sessionId: 's1',
            path: 'd.md',
            kind: 'deleted',
            before: null,
            after: ''
          },
          'not an object',
          null
        ]
      }),
      'utf-8'
    )

    const journal = new ChangeJournal(journalPath)
    expect(journal.list().map((e) => e.id)).toEqual(['good'])
  })

  it('treats a missing journal as an empty one', () => {
    const journal = new ChangeJournal(journalPath)
    expect(() => journal.load()).not.toThrow()
    expect(journal.list()).toEqual([])
    // Reading does not manufacture a file; only a change does.
    expect(existsSync(journalPath)).toBe(false)

    journal.record({
      sessionId: 's1',
      path: notePath('idea.md'),
      before: null,
      after: '# hi\n',
      kind: 'created'
    })
    expect(existsSync(journalPath)).toBe(true)
    expect(new ChangeJournal(journalPath).list()).toHaveLength(1)
  })

  it('moves a corrupt journal aside, replaces it, and keeps going', () => {
    mkdirSync(dirname(journalPath), { recursive: true })
    writeFileSync(journalPath, '{"version":1,"entries":[{"id":"e1"', 'utf-8')

    const journal = new ChangeJournal(journalPath)
    expect(() => journal.load()).not.toThrow()
    expect(journal.list()).toEqual([])

    // Kept for the user, replaced at the original path so the next launch does
    // not re-parse the wreck.
    expect(existsSync(`${journalPath}.corrupt`)).toBe(true)
    expect(readFileSync(`${journalPath}.corrupt`, 'utf-8')).toContain('"e1"')
    expect(readJournalFile()).toEqual({ version: 1, entries: [] })

    const path = notePath('idea.md')
    writeNote(path, '# original\n')
    journal.record({
      sessionId: 's1',
      path,
      before: '# original\n',
      after: '# rewritten\n',
      kind: 'modified'
    })
    writeNote(path, '# rewritten\n')

    const reopened = new ChangeJournal(journalPath)
    expect(reopened.list()).toHaveLength(1)
    expect(reopened.undo(reopened.list()[0].id).status).toBe('restored')
    expect(readNote(path)).toBe('# original\n')
  })

  it('ignores a journal whose shape is not what it expects', () => {
    mkdirSync(dirname(journalPath), { recursive: true })
    writeFileSync(journalPath, JSON.stringify({ version: 1, entries: 'nope' }), 'utf-8')
    expect(new ChangeJournal(journalPath).list()).toEqual([])

    writeFileSync(journalPath, JSON.stringify([1, 2, 3]), 'utf-8')
    expect(new ChangeJournal(journalPath).list()).toEqual([])
  })

  it('creates the directory the journal lives in', () => {
    const nested = join(root, 'deep', 'deeper', 'journal.json')
    const journal = new ChangeJournal(nested)
    journal.record({
      sessionId: 's1',
      path: notePath('idea.md'),
      before: null,
      after: '# hi\n',
      kind: 'created'
    })
    expect(existsSync(nested)).toBe(true)
  })
})

describe('pruning', () => {
  it('drops reverted entries once the retention window has passed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const journal = new ChangeJournal(journalPath)

    const reverted = journal.record({
      sessionId: 's1',
      path: notePath('gone.md'),
      before: null,
      after: 'gone\n',
      kind: 'created'
    })
    writeNote(notePath('gone.md'), 'gone\n')
    expect(journal.undo(reverted.id).status).toBe('gone')
    expect(journal.list()).toHaveLength(1)

    // Still inside the window a moment later.
    vi.setSystemTime(T0 + 6 * DAY_MS)
    const recent = journal.record({
      sessionId: 's1',
      path: notePath('recent.md'),
      before: null,
      after: 'recent\n',
      kind: 'created'
    })
    expect(journal.list().map((e) => e.id)).toEqual([recent.id, reverted.id])

    // A week later the reverted one is worth nothing: it cannot be undone, and
    // holding its file content forever costs disk for no benefit.
    vi.setSystemTime(T0 + 8 * DAY_MS)
    const later = journal.record({
      sessionId: 's1',
      path: notePath('later.md'),
      before: null,
      after: 'later\n',
      kind: 'created'
    })
    expect(journal.list().map((e) => e.id)).toEqual([later.id, recent.id])
  })

  it('never drops a live entry, however old it is', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const journal = new ChangeJournal(journalPath)
    const live = journal.record({
      sessionId: 's1',
      path: notePath('idea.md'),
      before: 'v0',
      after: 'v1',
      kind: 'modified'
    })

    vi.setSystemTime(T0 + 400 * DAY_MS)
    journal.record({
      sessionId: 's1',
      path: notePath('other.md'),
      before: null,
      after: 'x\n',
      kind: 'created'
    })

    expect(journal.list().map((e) => e.id)).toContain(live.id)
  })

  it('never drops a live entry to stay under the size cap', () => {
    // The cap is on disk, not on the guarantee. A journal over budget with
    // nothing to evict has to stay over budget rather than quietly forgetting a
    // change that happened.
    const journal = new ChangeJournal(journalPath, { maxBytes: 1024 })
    const bulk = 'x'.repeat(400)
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      ids.push(
        journal.record({
          sessionId: 's1',
          path: notePath(`note-${i}.md`),
          before: bulk,
          after: bulk,
          kind: 'modified'
        }).id
      )
    }
    expect(
      journal
        .list()
        .map((e) => e.id)
        .sort()
    ).toEqual([...ids].sort())
    expect(new ChangeJournal(journalPath).list()).toHaveLength(5)
  })

  it('drops reverted entries oldest first to stay under the size cap', () => {
    const journal = new ChangeJournal(journalPath, { maxBytes: 1200 })
    const bulk = 'x'.repeat(400)

    const spent = journal.record({
      sessionId: 's1',
      path: notePath('spent.md'),
      before: null,
      after: bulk,
      kind: 'created'
    })
    writeNote(notePath('spent.md'), bulk)
    expect(journal.undo(spent.id).status).toBe('gone')
    expect(journal.list()).toHaveLength(1)

    const live = journal.record({
      sessionId: 's1',
      path: notePath('live.md'),
      before: bulk,
      after: bulk,
      kind: 'modified'
    })

    const kept = journal.list()
    expect(kept.map((e) => e.id)).toEqual([live.id])
    expect(new ChangeJournal(journalPath).list().map((e) => e.id)).toEqual([live.id])
  })
})

describe('findLatestEntry', () => {
  let path: string
  let other: string

  beforeEach(() => {
    path = notePath('idea.md')
    other = notePath('other.md')
  })

  function entry(
    id: string,
    entryPath: string,
    createdAt: number,
    revertedAt: number | null
  ): JournalEntry {
    return {
      id,
      sessionId: 's1',
      path: entryPath,
      kind: 'modified',
      before: '',
      after: '',
      createdAt,
      revertedAt
    }
  }

  it('finds the newest undoable change to a path', () => {
    const entries = [
      entry('old', path, T0, null),
      entry('other-file', other, T0 + 500, null),
      entry('new', path, T0 + 1000, null)
    ]
    expect(findLatestEntry(entries, path)?.id).toBe('new')
  })

  it('does not depend on the order it is handed the entries in', () => {
    // Oldest-first is what `record()` leaves behind in memory. Returning the
    // first match there would undo the least recent edit and call it "the last
    // thing the assistant did here".
    const entries = [entry('old', path, T0, null), entry('new', path, T0 + 1000, null)]
    expect(findLatestEntry([...entries].reverse(), path)?.id).toBe('new')
    expect(findLatestEntry(entries, path)?.id).toBe('new')
  })

  it('skips reverted entries and paths it does not know', () => {
    const entries = [entry('done', path, T0 + 1000, T0 + 2000), entry('live', path, T0, null)]
    expect(findLatestEntry(entries, path)?.id).toBe('live')
    expect(findLatestEntry(entries, notePath('never.md'))).toBeUndefined()
    expect(findLatestEntry([], path)).toBeUndefined()
  })

  it('matches one file across case on Windows', { skip: process.platform !== 'win32' }, () => {
    const entries = [entry('live', path, T0, null)]
    expect(findLatestEntry(entries, path.toUpperCase())?.id).toBe('live')
  })

  it(
    'keeps differently cased files separate on POSIX',
    { skip: process.platform === 'win32' },
    () => {
      const entries = [entry('live', path, T0, null)]
      expect(findLatestEntry(entries, path.toUpperCase())).toBeUndefined()
    }
  )
})
