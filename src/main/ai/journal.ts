import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import type { ChangeKind, JournalEntry } from '../../shared/ai/types'
import { pathKey, statOrNull } from './paths'

/**
 * Undo for everything the assistant writes.
 *
 * Changes are applied without asking - that is the point of the feature, and a
 * confirmation dialog on every fix would make it slower than editing by hand.
 * This is what makes that safe: every write is recorded with its prior content
 * before it happens, so any of it can be put back.
 *
 * Three decisions worth stating, because each trades something:
 *
 * - Undo is per-change, not per-turn. A turn that rewrote twelve notes can be
 *   undone one note at a time. All-or-nothing over a turn means the one file you
 *   did not want changed stops you reverting the eleven you did.
 *
 * - Undo refuses when the file has changed since. If the current content is not
 *   what the assistant wrote, someone else has been editing, and writing the old
 *   content back would destroy that. Refusing is the lesser evil: the entry is
 *   left in place and the caller is told why.
 *
 * - Reverted entries are pruned, and pruning is oldest-first. Keeping undo for
 *   last month's changes forever means holding last month's file contents
 *   forever, which is not a trade anyone wants made silently.
 */

export interface JournalRecordInput {
  sessionId: string
  path: string
  before: string | null
  after: string
  kind: ChangeKind
}

export type UndoOutcome =
  | { status: 'restored'; path: string }
  /** The file no longer exists and was not created by the change. */
  | { status: 'gone'; path: string }
  | { status: 'already-reverted'; path: string }
  | { status: 'changed-since'; path: string; entry: JournalEntry }
  | { status: 'unknown'; id: string }

/** Reverted entries older than this are dropped. */
const REVERTED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Ceiling on the journal file. Past it, the oldest reverted entries go first;
 * un-reverted entries are never dropped, because dropping one silently removes
 * the user's ability to undo something that actually happened.
 */
const MAX_JOURNAL_BYTES = 64 * 1024 * 1024

/**
 * Overrides for the two limits, so they can be exercised without materialising
 * 64 MiB of file content or waiting seven days. Unset values are the defaults.
 */
export interface JournalLimits {
  revertedRetentionMs?: number
  maxBytes?: number
}

interface JournalFile {
  version: 1
  entries: JournalEntry[]
}

/**
 * Validate and normalize one persisted entry.
 *
 * `revertedAt` gets explicit handling because getting it wrong is silent. An
 * entry loaded without the field - written by an older build, or trimmed by a
 * partial write that happened to stay parseable - leaves it `undefined`, and
 * `undefined !== null` reads as "already reverted" in `undo`. The user is then
 * told the change cannot be undone when it can, which is the one failure the
 * journal exists to prevent. An absent field means "not reverted"; a field of
 * the wrong type is malformed and the entry is dropped.
 */
function toEntry(value: unknown): JournalEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const e = value as Partial<JournalEntry>
  if (
    typeof e.id !== 'string' ||
    typeof e.sessionId !== 'string' ||
    typeof e.path !== 'string' ||
    typeof e.after !== 'string' ||
    typeof e.createdAt !== 'number' ||
    (e.before !== null && typeof e.before !== 'string') ||
    (e.kind !== 'created' && e.kind !== 'modified')
  ) {
    return null
  }
  if (e.revertedAt !== undefined && e.revertedAt !== null && typeof e.revertedAt !== 'number') {
    return null
  }
  return {
    id: e.id,
    sessionId: e.sessionId,
    path: e.path,
    kind: e.kind,
    before: e.before,
    after: e.after,
    createdAt: e.createdAt,
    revertedAt: e.revertedAt ?? null
  }
}

export class ChangeJournal {
  private entries: JournalEntry[] = []
  private loaded = false
  private readonly retentionMs: number
  private readonly maxBytes: number

  constructor(
    private readonly filePath: string,
    limits: JournalLimits = {}
  ) {
    this.retentionMs = limits.revertedRetentionMs ?? REVERTED_RETENTION_MS
    this.maxBytes = limits.maxBytes ?? MAX_JOURNAL_BYTES
  }

  /** Read the journal from disk, tolerating absence and corruption. */
  load(): void {
    if (this.loaded) return
    this.loaded = true
    let raw: string
    try {
      raw = readFileSync(this.filePath, 'utf-8')
    } catch {
      // No journal yet is the normal first-run case, not a failure.
      this.entries = []
      return
    }
    try {
      const parsed = JSON.parse(raw) as Partial<JournalFile>
      const list = Array.isArray(parsed.entries) ? parsed.entries : []
      this.entries = list.map(toEntry).filter((e): e is JournalEntry => e !== null)
    } catch {
      // A truncated journal is worth keeping on disk for the user to look at,
      // and worth replacing so the next read starts from something valid rather
      // than re-parsing the wreck on every launch.
      let quarantined = false
      try {
        renameSync(this.filePath, `${this.filePath}.corrupt`)
        quarantined = true
      } catch {
        /* nothing useful to do */
      }
      this.entries = []
      // Only over the top of the quarantined file. If the move failed the old
      // content is still sitting there, and writing over it would destroy the
      // one thing this branch exists to preserve.
      if (quarantined) this.persist()
    }
  }

  /** Record a change. Call before the write lands, or the prior content is lost. */
  record(input: JournalRecordInput): JournalEntry {
    this.load()
    const entry: JournalEntry = {
      id: randomUUID(),
      sessionId: input.sessionId,
      path: input.path,
      kind: input.kind,
      before: input.before,
      after: input.after,
      createdAt: Date.now(),
      revertedAt: null
    }
    this.entries.push(entry)
    this.prune()
    this.persist()
    return entry
  }

  /** Every entry, newest first. Used by the history view. */
  list(sessionId?: string): JournalEntry[] {
    this.load()
    const filtered = sessionId
      ? this.entries.filter((e) => e.sessionId === sessionId)
      : this.entries
    // Entries recorded inside the same millisecond are ordered by position, not
    // by the clock. A turn that rewrites twelve notes lands inside one tick on
    // any normal machine, and a stable sort on equal timestamps alone would hand
    // those twelve back in the order they happened - which is the opposite of
    // what "newest first" is for.
    return filtered
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => b.entry.createdAt - a.entry.createdAt || b.index - a.index)
      .map(({ entry }) => entry)
  }

  /** Changes from one turn, for "undo what this just did". */
  listSince(sessionId: string, since: number): JournalEntry[] {
    return this.list(sessionId).filter((e) => e.createdAt >= since && e.revertedAt === null)
  }

  /**
   * Put a file back the way it was before the recorded change.
   *
   * Refuses when the file no longer holds what the assistant wrote. That is the
   * common case in practice - the user opened the note, fixed a typo, and then
   * went looking for undo - and overwriting their fix to satisfy a stale undo
   * request is worse than telling them it is not available.
   */
  undo(id: string): UndoOutcome {
    this.load()
    const entry = this.entries.find((e) => e.id === id)
    if (!entry) return { status: 'unknown', id }
    if (entry.revertedAt !== null) return { status: 'already-reverted', path: entry.path }

    const current = statOrNull(entry.path)
    if (current) {
      let onDisk: string
      try {
        onDisk = readFileSync(entry.path, 'utf-8')
      } catch {
        return { status: 'changed-since', path: entry.path, entry }
      }
      if (onDisk !== entry.after) return { status: 'changed-since', path: entry.path, entry }
    } else if (entry.kind === 'modified') {
      // It was modified and is now absent. Something else deleted it, so the
      // pre-change content is no longer a description of a live file.
      return { status: 'changed-since', path: entry.path, entry }
    }

    try {
      if (entry.before === null) {
        rmSync(entry.path, { force: true })
      } else {
        mkdirSync(dirname(entry.path), { recursive: true })
        // Deliberately NOT temp-and-rename, which is what every other write in
        // this app does.
        //
        // An atomic replace on Windows deletes the target and renames a fresh
        // file into place. The new file gets the permissions of the process
        // that made it, not the ones the user gave the original - so undoing a
        // change to a note inside a synced or access-controlled folder quietly
        // strips its ACL. The note then behaves differently from every other
        // file around it, and nothing on screen says so.
        //
        // The cost is a window where a crash mid-write truncates the file. That
        // window only exists on the restore path, where the content being
        // written is by definition a copy of something that was already there
        // and the journal still holds it. A restored-then-crashed note is
        // recoverable from the journal; a note that lost its folder permissions
        // is not something the user can see or undo.
        writeFileSync(entry.path, entry.before, 'utf-8')
      }
    } catch {
      return { status: 'changed-since', path: entry.path, entry }
    }

    entry.revertedAt = Date.now()
    this.prune()
    this.persist()
    return entry.before === null
      ? { status: 'gone', path: entry.path }
      : { status: 'restored', path: entry.path }
  }

  /** Revert several entries, newest first, so overlapping edits unwind cleanly. */
  undoMany(ids: string[]): UndoOutcome[] {
    // Newest first, and it matters: undoing the older of two edits to one file
    // would find the file holding the newer edit's `after` and refuse, leaving
    // the turn half-undone. Ids the journal has never heard of sort last and
    // report `unknown`, rather than jumping to the front of the queue.
    const rank = new Map<string, number>()
    let next = 0
    for (const entry of this.list()) {
      if (ids.includes(entry.id) && !rank.has(entry.id)) rank.set(entry.id, next++)
    }
    const position = (id: string): number => rank.get(id) ?? Number.MAX_SAFE_INTEGER
    return [...ids].sort((a, b) => position(a) - position(b)).map((id) => this.undo(id))
  }

  /** Drop entries that can no longer be undone, oldest first. */
  private prune(): void {
    const cutoff = Date.now() - this.retentionMs
    this.entries = this.entries.filter((e) => e.revertedAt === null || e.revertedAt > cutoff)

    let size = this.approximateBytes()
    while (size > this.maxBytes) {
      // Oldest reverted first. Live entries are never dropped: the journal
      // existing at all is the guarantee, and quietly forgetting an un-reverted
      // change would break it without anyone noticing.
      const victim = this.entries.find((e) => e.revertedAt !== null)
      if (!victim) break
      this.entries.splice(this.entries.indexOf(victim), 1)
      size = this.approximateBytes()
    }
  }

  private approximateBytes(): number {
    // Cheap: entry count times the average of the two payloads. Exactness is
    // not worth a full serialization on every write.
    if (this.entries.length === 0) return 0
    const total = this.entries.reduce(
      (sum, e) => sum + (e.before?.length ?? 0) + e.after.length + e.path.length + 120,
      0
    )
    return total
  }

  private persist(): void {
    const payload = JSON.stringify({ version: 1, entries: this.entries } satisfies JournalFile)
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.${randomUUID()}.tmp`
    try {
      writeFileSync(temp, payload, { encoding: 'utf-8', mode: 0o600 })
      renameSync(temp, this.filePath)
    } catch {
      // Losing the journal is bad but not worth failing the edit over; the file
      // is in memory and the next successful write persists the lot.
      try {
        rmSync(temp, { force: true })
      } catch {
        /* nothing useful to do */
      }
    }
  }
}

/**
 * Case-folded lookup of the newest undoable change to `path`, so Windows
 * spellings of one path find one journal entry.
 *
 * Newest by `createdAt`, not by position in the array. The caller usually has
 * `list()` output, which is already newest-first, so returning the first match
 * happens to be right - and returning the first match is also what happens
 * when someone passes `record()` order, where it hands back the oldest edit to
 * a file. "Undo the last thing the assistant did here" has to mean one thing.
 */
export function findLatestEntry(
  entries: readonly JournalEntry[],
  path: string
): JournalEntry | undefined {
  const key = pathKey(path)
  let latest: JournalEntry | undefined
  for (const entry of entries) {
    if (entry.revertedAt !== null || pathKey(entry.path) !== key) continue
    if (!latest || entry.createdAt >= latest.createdAt) latest = entry
  }
  return latest
}
