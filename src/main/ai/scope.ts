import { basename, dirname, isAbsolute, join, resolve } from 'path'
import { realpathSync, statSync, type Stats } from 'fs'

/**
 * The boundary an AI session operates inside.
 *
 * The agent is not the user: it acts on instructions derived from text, and
 * text can come from a web page it read. So every path it touches is resolved
 * against one root - the "cd into a project" the user pointed it at - and
 * nothing outside that root is reachable, whatever the model asks for.
 *
 * Deliberately separate from `path-guard.ts`, which governs the *renderer*.
 * That module restricts the editor to document extensions because a renderer
 * bug writing `evil.html` into a note folder is a real risk and the editor has
 * no reason to write anything else. An agent working in a code project has
 * every reason to write `.ts`, and the user's boundary is the directory, not
 * the suffix. Mixing the two would mean the agent's tools inherit a document
 * allowlist, or that loosening it for the agent loosens the editor too.
 */

/** A resolved working root. Construct with `createScope`. */
export interface Scope {
  /** The path the user chose. For display only - never for comparison. */
  root: string
  /** Canonical form of `root`. Every containment check runs against this. */
  realRoot: string
}

/** Why a path was refused. Tool results carry this so the model can react. */
export type ScopeViolation =
  | 'empty'
  | 'not-absolute-root'
  | 'nul-byte'
  | 'outside-root'
  | 'is-root'
  | 'unresolvable'
  | 'not-a-directory'
  | 'not-found'

export class ScopeError extends Error {
  readonly violation: ScopeViolation

  constructor(violation: ScopeViolation, path: string, detail?: string) {
    super(
      violation === 'outside-root'
        ? `Refused: ${path} is outside this session's working directory (${detail}). Work relative to the working directory, or ask the user to move the session there.`
        : `Refused: ${path} (${violation})`
    )
    this.name = 'ScopeError'
    this.violation = violation
  }
}

/**
 * Canonical path of `target`, following every symlink that already exists on
 * the way and keeping the components that do not.
 *
 * This is what makes the guard worth having. `resolve()` alone only collapses
 * `..` textually, so `root/link/../../etc/passwd` passes a naive prefix check
 * while a symlink named `link` quietly points somewhere else entirely. Walking
 * up to the nearest component that resolves and re-appending the rest means a
 * new file is guarded by its real parent directory, and a symlinked one is
 * judged by where it actually lands.
 *
 * Fails closed on anything other than "not there yet": a symlink loop (ELOOP)
 * or a permission error (EACCES) produces null rather than a guess.
 */
function canonicalize(target: string): string | null {
  let current = resolve(target)
  const tail: string[] = []
  for (;;) {
    try {
      const real = realpathSync(current)
      return tail.length ? join(real, ...tail) : real
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return null
      const parent = dirname(current)
      if (parent === current) return null
      tail.unshift(basename(current))
      current = parent
    }
  }
}

function compareKey(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

/**
 * Case-sensitive containment. Not a `startsWith` on the raw strings: a prefix
 * match would accept `C:\dev\writemd-evil` as inside `C:\dev\writemd`, and on
 * a case-insensitive filesystem it would also disagree with the OS about which
 * of two spellings is the real one.
 */
function contains(parent: string, child: string): boolean {
  const p = compareKey(parent).replace(/[\\/]+$/, '')
  const c = compareKey(child)
  if (c === p) return true
  const sep = p.includes('\\') ? '\\' : '/'
  return c.startsWith(p + sep)
}

/**
 * Build a scope from a user-chosen root.
 *
 * The root must exist and be a directory, and that is checked rather than
 * assumed. `canonicalize` deliberately walks up to the nearest existing
 * ancestor, which is what lets a not-yet-created *file* be guarded by the
 * directory that will hold it. Applied to the root that same behaviour is a
 * hole: a scope built on `~/projects/typo` would resolve to `~/projects` and
 * hand the agent everything in the parent, so a typo in a path becomes a
 * silently wider boundary than the user picked.
 */
export function createScope(root: string): Scope {
  if (!root || !isAbsolute(root)) throw new ScopeError('not-absolute-root', root)
  const absolute = resolve(root)
  let stats: Stats
  try {
    stats = statSync(absolute)
  } catch {
    throw new ScopeError('not-found', root)
  }
  if (!stats.isDirectory()) throw new ScopeError('not-a-directory', root)
  const realRoot = canonicalize(absolute)
  if (!realRoot) throw new ScopeError('unresolvable', root)
  return { root: absolute, realRoot }
}

/** True when `candidate` resolves to the scope root itself. */
export function isScopeRoot(scope: Scope, candidate: string): boolean {
  const canonical = canonicalize(isAbsolute(candidate) ? candidate : join(scope.root, candidate))
  return canonical !== null && compareKey(canonical) === compareKey(scope.realRoot)
}

export interface ResolveOptions {
  /**
   * Allow the path to be the root itself. Reads and directory listings want
   * this; writes and deletes do not, because "delete ." is never the intent.
   */
  allowRoot?: boolean
  /** Require the path to exist. Writes to a new file must not set this. */
  mustExist?: boolean
  /** Require a directory. Listing and globbing want this. */
  mustBeDirectory?: boolean
}

/**
 * Turn a model-supplied path into an absolute one that is provably inside the
 * scope, or throw.
 *
 * Relative paths resolve against the root, which is what the model means when
 * it says `src/index.ts`. Absolute paths are accepted when they land inside the
 * root, because a path echoed back from a tool result or a user's own message
 * is usually absolute and rejecting it would only teach the model to reformat.
 */
export function resolveInScope(
  scope: Scope,
  candidate: string,
  options: ResolveOptions = {}
): string {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new ScopeError('empty', String(candidate))
  }
  // A NUL truncates the path at the syscall boundary on some platforms, so
  // `root/ok\0/../../etc` can pass every check above and open something else.
  if (candidate.includes('\0')) throw new ScopeError('nul-byte', candidate)

  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(scope.root, candidate)
  const canonical = canonicalize(absolute)
  if (!canonical) throw new ScopeError('unresolvable', candidate)

  const inside = contains(scope.realRoot, canonical)
  if (!inside) throw new ScopeError('outside-root', candidate, scope.root)

  const isRoot = compareKey(canonical) === compareKey(scope.realRoot)
  if (isRoot && !options.allowRoot) throw new ScopeError('is-root', candidate)

  // Only now, after the path is known to be inside the root, is it safe to ask
  // the filesystem what is there.
  if (options.mustExist || options.mustBeDirectory) {
    const stats = statOrNull(canonical)
    if (!stats) throw new ScopeError('not-found', candidate)
    if (options.mustBeDirectory && !stats.isDirectory()) {
      throw new ScopeError('not-a-directory', candidate)
    }
  }
  return canonical
}

function statOrNull(p: string): Stats | null {
  try {
    return statSync(p)
  } catch {
    return null
  }
}

/** Path relative to the scope root, for display and for telling the model. */
export function relativeToScope(scope: Scope, absolute: string): string {
  const rel = absolute.slice(scope.realRoot.length).replace(/^[\\/]+/, '')
  return rel || '.'
}

/**
 * Windows device names. `nul.txt` and `aux` resolve to a device rather than a
 * file, so a write there does not create what the user thinks it creates and a
 * read hangs. The agent has no reason to name a file `con.md`.
 */
export function isReservedSystemPath(absolute: string): boolean {
  const stem = basename(absolute).split('.')[0] ?? ''
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)
}
