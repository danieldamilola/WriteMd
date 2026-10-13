import { mkdirSync } from 'fs'
import { open, readFile, rename, unlink } from 'fs/promises'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import type { ChangeKind, JournalEntry } from '../../shared/ai/types'
import type { FileProposal } from './edit-protocol'
import type { ChangeJournal } from './journal'
import { resolveRealPath, statOrNull } from './paths'

/**
 * Proposals in, bytes on disk out.
 *
 * Everything above this layer is about what the model *meant*: parse the blocks,
 * apply them, see which ones failed. This is the layer that decides what happens
 * to the file, and most of it is about refusing.
 *
 * The refusals are the point. The assistant edits without asking, so the cost of
 * a wrong write is the user's own words replaced by something they never asked
 * for, with nothing on screen saying it happened. So:
 *
 * - A file with a failed block is not written at all. Three of five blocks
 *   matching is not "mostly applied", it is a document missing two changes that
 *   looks complete.
 * - A file that changed since the edit was computed is not written either. The
 *   model spent seconds thinking; the user may well have typed in that time, and
 *   a stale `before` written over their newer text is exactly the silent revert
 *   this exists to prevent.
 * - A change identical to what is already on disk is neither written nor
 *   journaled. An undo entry for nothing is an entry the user has to dismiss.
 *
 * Every write is preceded by a journal entry holding the prior content, so the
 * change can always be put back - see journal.ts for why that ordering is the
 * only safe one.
 *
 * Nothing here throws for a file-level problem. Three of the user's notes failing
 * is a normal outcome reported in `skipped`, not an exception that loses the
 * answer the model already streamed.
 */

/** Why a proposal did not land. Reported, never thrown. */
export type SkipReason = 'block-failed' | 'ambiguous' | 'changed-since' | 'unreadable' | 'too-large'

export interface ApplyOptions {
  sessionId: string
  /** Absolute directory a model-written relative path resolves against. */
  base: string
  journal: ChangeJournal
  /** Max bytes read/written per file. Refuse larger rather than stall. */
  maxFileBytes?: number
  /** Stop before committing another file when the user cancels the turn. */
  signal?: AbortSignal
}

export interface AppliedChange {
  /** Canonical absolute path. */
  path: string
  kind: ChangeKind
  /** Undo entry for this change, for "undo that one" in the transcript. */
  journalId: string
  blocks: number
}

export interface SkippedFile {
  /** Canonical absolute path, so the user can be sent to it. */
  path: string
  reason: SkipReason
  /** Written for a person to read. Never an exception message alone. */
  detail: string
}

export interface ApplyOutcome {
  applied: AppliedChange[]
  skipped: SkippedFile[]
}

/** Notes this size are read in one gulp, so this is about sanity, not capacity. */
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024

type FileOutcome =
  | { kind: 'applied'; change: AppliedChange }
  | { kind: 'skipped'; skip: SkippedFile }
  /** Nothing to do, and nothing to tell the user about. */
  | { kind: 'noop' }

/**
 * Write the proposals, one file at a time.
 *
 * Sequential on purpose. A turn touches a handful of notes, and a fixed order
 * makes the transcript's list of changes read in the order the model wrote them
 * rather than in whatever order the event loop happened to finish them in.
 */
export async function applyProposals(
  proposals: readonly FileProposal[],
  options: ApplyOptions
): Promise<ApplyOutcome> {
  // Missing options are a bug in the caller, not something the user can act on,
  // and reporting it as a skipped file would hide the bug. These three are the
  // only throws in this module.
  if (!Array.isArray(proposals)) throw new TypeError('applyProposals: proposals must be an array')
  if (!options || !options.journal)
    throw new TypeError('applyProposals: a ChangeJournal is required')
  if (!options.base) throw new TypeError('applyProposals: a base directory is required')
  if (typeof options.sessionId !== 'string') {
    throw new TypeError('applyProposals: a sessionId is required')
  }

  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  const applied: AppliedChange[] = []
  const skipped: SkippedFile[] = []

  for (const proposal of proposals) {
    if (options.signal?.aborted) break
    const outcome = await applyOne(proposal, options, maxFileBytes)
    if (outcome.kind === 'applied') applied.push(outcome.change)
    else if (outcome.kind === 'skipped') skipped.push(outcome.skip)
  }

  return { applied, skipped }
}

async function applyOne(
  proposal: FileProposal,
  options: ApplyOptions,
  maxFileBytes: number
): Promise<FileOutcome> {
  // A failed block is not a partial success. `after` still describes what the
  // file would be if the other blocks had matched, which is precisely why it
  // must not be written: the user would get a document with changes silently
  // missing from it and no indication that anything was dropped.
  if (proposal.failures.length > 0) {
    return skipped(proposal.path, 'block-failed', describeFailures(proposal))
  }

  // Blocks that matched but changed nothing. Journaling these would put entries
  // in the history that undo into an identical file, which is the kind of noise
  // that teaches people to stop reading the history.
  if (proposal.after === proposal.before) return { kind: 'noop' }

  // Re-canonicalize rather than trusting the proposal. The journal records the
  // path the bytes actually landed on, so a write and its undo entry have to be
  // about the same file; a path that has since become a symlink would otherwise
  // write through one and record the other. Also where NUL bytes and reserved
  // device names get refused, which is the one part of a model-written path
  // that is not merely cosmetic.
  let path: string
  try {
    path = resolveRealPath(proposal.path, options.base)
  } catch (err) {
    return skipped(
      proposal.requestedPath || proposal.path,
      'unreadable',
      `Not a usable file path: ${message(err)}`
    )
  }

  const stats = statOrNull(path)
  if (stats && !stats.isFile()) {
    return skipped(path, 'unreadable', 'That path is a directory or a device, not a file.')
  }
  if (stats && stats.size > maxFileBytes) {
    return skipped(
      path,
      'too-large',
      `${formatBytes(stats.size)} is over the ${formatBytes(maxFileBytes)} limit, so it was not read.`
    )
  }

  // The outgoing text counts too. A creation has nothing on disk to measure, and
  // writing 40 MB of generated Markdown because the only limit was on the read
  // side would be a rule with a hole in it.
  const written = Buffer.byteLength(proposal.after, 'utf-8')
  if (written > maxFileBytes) {
    return skipped(
      path,
      'too-large',
      `The proposed content is ${formatBytes(written)}, over the ${formatBytes(maxFileBytes)} limit.`
    )
  }

  // Optimistic concurrency. `before` is the snapshot the edit was computed
  // against; if the file no longer matches it, someone else got here first and
  // their version is the one the user is looking at.
  if (stats) {
    let current: string
    try {
      current = await readFile(path, 'utf-8')
    } catch (err) {
      return skipped(path, 'unreadable', `Could not read the file: ${message(err)}`)
    }
    if (current !== proposal.before) {
      return skipped(
        path,
        'changed-since',
        'It changed on disk while the assistant was writing it, so the newer version was kept.'
      )
    }
  } else if (!proposal.isCreation || proposal.before !== '') {
    // Absent now. That is only expected for a file the edit was computed
    // against as absent - a file that existed and has since been deleted is a
    // change, not a blank slate, and recreating it would resurrect a note the
    // user closed.
    return skipped(
      path,
      'changed-since',
      'It was deleted while the assistant was writing it, so it was not recreated.'
    )
  }

  const kind: ChangeKind = stats ? 'modified' : 'created'
  if (options.signal?.aborted) return { kind: 'noop' }
  // null, not '', for a creation. The journal reads null as "this file did not
  // exist", and undo of a creation has to delete rather than write an empty file
  // over the user's.
  const before = kind === 'created' ? null : proposal.before

  // Journal first, always. The window between here and the rename is small, and
  // dying inside it costs the user an undo entry for a change that did not
  // happen - an entry whose undo finds the file already correct. The other order
  // loses the prior content with nothing left pointing at it.
  let entry: JournalEntry
  try {
    entry = options.journal.record({
      sessionId: options.sessionId,
      path,
      before,
      after: proposal.after,
      kind
    })
  } catch (err) {
    // Unrecorded changes are unundoable, so the write does not happen. Same
    // reasoning as the ordering above, applied to a journal that cannot be
    // written at all.
    return skipped(path, 'unreadable', `Could not record the change for undo: ${message(err)}`)
  }

  try {
    // A fresh temp file gets 0644 by default, so the rename would silently
    // widen a note the user had restricted. Carry the original mode across, or
    // fall back to owner-only for a brand new file.
    const mode = stats ? stats.mode & 0o777 : 0o600
    await writeAtomic(path, proposal.after, mode, options.signal)
  } catch (err) {
    if (options.signal?.aborted) return { kind: 'noop' }
    // The journal entry stays. It describes a change that did not land, so
    // undoing it is a no-op rather than a corruption, which is the recoverable
    // direction to fail in.
    return skipped(path, 'unreadable', `Could not write the file: ${message(err)}`)
  }

  return {
    kind: 'applied',
    change: {
      path,
      kind,
      journalId: entry.id,
      blocks: proposal.blocks.length
    }
  }
}

/**
 * Replace a file's contents without ever having it half-written.
 *
 * The same shape as `file:write` in ipc.ts, deliberately: two code paths that
 * write a user's Markdown should not be able to disagree about what happens
 * when the disk fills up mid-write.
 */
async function writeAtomic(
  path: string,
  content: string,
  mode: number,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted()
  mkdirSync(dirname(path), { recursive: true })
  // Unique temp name: concurrent writes to the same file must not clobber
  // each other's temp file (and stale temps are cleaned up on failure).
  const tempPath = `${path}.${randomUUID()}.tmp`
  try {
    const handle = await open(tempPath, 'w', mode)
    try {
      await handle.writeFile(content, 'utf-8')
      // Flush before the rename, otherwise a crash can leave the renamed file
      // present but empty, which defeats the point of writing via temp.
      await handle.sync()
    } finally {
      await handle.close()
    }
    signal?.throwIfAborted()
    await rename(tempPath, path)
  } catch (e) {
    await unlink(tempPath).catch(() => {})
    throw e
  }
}

function skipped(path: string, reason: SkipReason, detail: string): FileOutcome {
  return { kind: 'skipped', skip: { path, reason, detail } }
}

/**
 * Say which blocks failed, not just how many. "1 of 3 blocks did not apply"
 * leaves the user to work out whether the assistant misread their note or their
 * note moved; naming the search text answers it.
 */
function describeFailures(proposal: FileProposal): string {
  const total = proposal.blocks.length
  const count = proposal.failures.length
  const shown = proposal.failures.slice(0, 3).map((failure) => {
    const text = snippet(failure.block.search)
    return failure.reason === 'ambiguous'
      ? `the text ${quote(text)} appears ${failure.occurrences ?? 2} times, so it is ambiguous`
      : `the text ${quote(text)} was not found`
  })
  const more = count > shown.length ? ` (and ${count - shown.length} more)` : ''
  const noun = total === 1 ? 'block' : 'blocks'
  return (
    `${count} of ${total} ${noun} did not apply: ${shown.join('; ')}${more}. ` +
    `The file was left as it was.`
  )
}

function snippet(text: string, max = 40): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}...` : flat
}

function quote(text: string): string {
  return text ? `"${text}"` : '(empty)'
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}
