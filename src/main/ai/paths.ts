import { basename, dirname, extname, isAbsolute, join, resolve } from 'path'
import { realpathSync, statSync, type Stats } from 'fs'

/**
 * Path handling for the AI's file tools.
 *
 * The user can point the assistant at any file, so there is no working
 * directory to confine it to and nothing here decides what the assistant may
 * touch. What is left is the part that has to be right for reasons that are not
 * about policy:
 *
 * - Every path is canonicalized before use, because the undo journal records the
 *   real path an edit landed on. A write made through a symlink that the
 *   journal stored under its alias would revert the wrong file, silently, after
 *   the user had already forgotten the edit existed.
 * - Paths that do not mean what they appear to mean are refused. A NUL truncates
 *   the path at the syscall boundary on some platforms, and a Windows device
 *   name resolves to a device rather than a file, so `nul.txt` is not a file you
 *   can create and reading it hangs.
 *
 * Reachable-by-anything is a choice about the assistant's usefulness, not a
 * safety property. The safety property here is that the user can always get a
 * change back.
 */

export type PathViolation = 'empty' | 'not-absolute' | 'nul-byte' | 'device-name' | 'unresolvable'

export function isMarkdownPath(path: string): boolean {
  return ['.md', '.markdown', '.mdown', '.mkd'].includes(extname(path).toLowerCase())
}

export class UnsafePathError extends Error {
  readonly violation: PathViolation

  constructor(violation: PathViolation, path: string) {
    super(
      violation === 'device-name'
        ? `${path} is a reserved Windows device name, not a file.`
        : violation === 'nul-byte'
          ? `${path} contains a NUL byte, which would truncate it at the filesystem boundary.`
          : `${path || '(empty path)'} is not a usable path (${violation}).`
    )
    this.name = 'UnsafePathError'
    this.violation = violation
  }
}

/**
 * Real path of `target`, following every symlink that already exists on the way
 * and keeping the components that do not.
 *
 * Walking up to the nearest existing ancestor is what lets a file the
 * assistant is about to create be resolved through the directory that will hold
 * it. It also means this cannot tell you whether the tail exists, which is why
 * callers that care ask `statOrNull`.
 *
 * Fails closed on anything other than "not there yet": a symlink loop (ELOOP) or
 * a permission error (EACCES) produces null rather than a plausible-looking
 * guess, because a wrong answer here means the journal points at the wrong file.
 */
export function canonicalize(target: string): string | null {
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

/**
 * Windows device names. The check is on the stem, so `nul.txt` is caught too,
 * and the list is the documented set rather than a pattern that would also
 * reject ordinary names like `console.md` or `null`.
 */
export function isReservedDeviceName(absolute: string): boolean {
  const stem = basename(absolute).split('.')[0] ?? ''
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)
}

/**
 * Resolve a path to absolute, canonical form, or throw with the reason.
 *
 * `base` is what a relative path resolves against. It has to be passed rather
 * than defaulted to `process.cwd()`: in an Electron main process that is
 * wherever the app happened to be launched from, which on Windows is frequently
 * somewhere other than the vault. A model that sends `notes/idea.md` meaning
 * the vault should get the vault, and one that sends an absolute path is
 * unaffected.
 */
export function resolveRealPath(candidate: string, base: string): string {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new UnsafePathError('empty', String(candidate ?? ''))
  }
  if (candidate.includes('\0')) throw new UnsafePathError('nul-byte', candidate)

  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(base, candidate)
  if (isReservedDeviceName(absolute)) throw new UnsafePathError('device-name', absolute)

  const canonical = canonicalize(absolute)
  if (!canonical) throw new UnsafePathError('unresolvable', candidate)
  if (isReservedDeviceName(canonical)) throw new UnsafePathError('device-name', canonical)
  return canonical
}

export function statOrNull(p: string): Stats | null {
  try {
    return statSync(p)
  } catch {
    return null
  }
}

/**
 * Case-insensitive comparison key on Windows only.
 *
 * Matching the OS is the whole point: two spellings of one path have to compare
 * equal for the journal to recognise its own entries, and they only differ by
 * case on a case-insensitive filesystem.
 */
export function pathKey(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

export function pathKeyEqual(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b)
}
