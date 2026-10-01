import { dirname, extname, isAbsolute, resolve, sep } from 'path'
import { realpathSync } from 'fs'

/**
 * Path access control for renderer-initiated IPC filesystem calls.
 *
 * The renderer may only touch:
 * - paths inside the vault root (computed live, since the vault can change), and
 * - explicitly registered external paths (files the user picked in a dialog,
 *   opened from the OS shell, or restored from our own config on startup).
 *
 * No Electron imports here so unit tests can drive the registry directly.
 */

let vaultRootProvider: () => string = () => ''

export function setVaultRootProvider(provider: () => string): void {
  vaultRootProvider = provider
  cachedLexicalRoot = ''
  cachedRealRoot = null
}

const registeredPaths = new Set<string>()

function isWindows(): boolean {
  return process.platform === 'win32'
}

export function normalizePath(p: string): string {
  const resolved = resolve(p)
  return isWindows() ? resolved.toLowerCase() : resolved
}

export function registerExternalPath(p: string | null | undefined): void {
  if (!p) return
  if (!isAbsolute(p)) return
  registeredPaths.add(normalizePath(p))
  // Also register the resolved real path. A registered note that is a symlink
  // would otherwise grant permanent read/write on its target, and
  // registerPersistedPaths re-grants that on every launch. The lexical entry
  // stays because the file may not exist yet (a save dialog result is
  // registered before the first write), and `realpathBestEffort` then resolves
  // through to the parent directory.
  const real = realpathBestEffort(p)
  if (real) registeredPaths.add(real)
}

export function registerExternalPaths(paths: readonly (string | null | undefined)[]): void {
  for (const p of paths) registerExternalPath(p)
}

export function isSubpath(child: string, parent: string): boolean {
  const c = normalizePath(child)
  const p = normalizePath(parent)
  if (c === p) return true
  return c.startsWith(p.endsWith(sep) ? p : p + sep)
}

/**
 * Real path of the deepest component of `p` that exists on disk, so a
 * not-yet-created file still resolves through the directory that will hold it.
 * Returns null when even the filesystem root cannot be resolved.
 */
function realpathBestEffort(p: string): string | null {
  let current = normalizePath(p)
  for (;;) {
    try {
      return normalizePath(realpathSync(current))
    } catch {
      const parent = dirname(current)
      if (parent === current) return null
      current = parent
    }
  }
}

// The vault can be repointed at runtime, so the realpath cache is keyed on the
// lexical root and recomputed whenever that string changes.
let cachedLexicalRoot = ''
let cachedRealRoot: string | null = null

function realVaultRoot(lexicalRoot: string): string | null {
  if (lexicalRoot !== cachedLexicalRoot) {
    cachedLexicalRoot = lexicalRoot
    try {
      cachedRealRoot = normalizePath(realpathSync(lexicalRoot))
    } catch {
      // Vault root does not exist yet (fresh install, or a unit test using a
      // synthetic path). There is nothing to resolve, so lexical matching is
      // the best available check.
      cachedRealRoot = null
    }
  }
  return cachedRealRoot
}

export function isPathInVault(p: string): boolean {
  const root = vaultRootProvider()
  if (!root) return false
  if (!isSubpath(p, root)) return false
  // Lexical containment passed, but a symlink inside the vault can still point
  // out of it. Re-check against the vault's real path before trusting it.
  const realRoot = realVaultRoot(root)
  if (!realRoot) return true
  const real = realpathBestEffort(p)
  return real === null ? false : isSubpath(real, realRoot)
}

/**
 * Roots the vault may never be pointed at, regardless of who asks. A vault at
 * a filesystem root (or a user profile) would make `isPathInVault` true for
 * essentially the whole disk, which silently voids every other guard here.
 */
const FORBIDDEN_VAULT_ROOTS = new Set<string>(['/', 'C:\\', 'C:/'])

/**
 * Reject vault roots that would grant blanket filesystem access. A drive root
 * passes `isSubpath` trivially, and a home directory would hand the renderer
 * everything in the user's profile. Both turn one compromised renderer into
 * full user-level file access, which is the entire threat model of this module.
 */
export function isSaneVaultRoot(p: string): boolean {
  if (!p || !isAbsolute(p)) return false
  const resolved = resolve(p)
  const real = realpathBestEffort(resolved)
  if (!real) return false
  if (FORBIDDEN_VAULT_ROOTS.has(real)) return false
  // A vault one or two levels below the root (`/Users`, `/home`) is almost
  // always a mistake, and it covers a large fraction of the disk.
  const depth = real
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .filter(Boolean).length
  if (isWindows() && /^[a-z]:$/i.test(resolved)) return false
  if (depth < 2) return false
  return true
}

/** Extensions the document layer may create or overwrite. */
const WRITABLE_DOCUMENT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.mdown',
  '.mkd',
  '.txt',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.bmp'
])

/**
 * Write and rename targets must stay inside the document extension set.
 * Without this a compromised renderer can drop `evil.bat` or `evil.html`
 * anywhere in the vault, or rename a note in place to an executable suffix.
 * `canOpenWithShell` stops WriteMd from *launching* such a file, but the file
 * still lands on disk where the OS or the user's other tools will run it.
 */
export function canWriteDocument(p: string): boolean {
  return WRITABLE_DOCUMENT_EXTENSIONS.has(extname(p).toLowerCase())
}

/** Read/write access: inside the vault, or a registered external path. */
export function canAccessPath(p: string): boolean {
  if (!p || !isAbsolute(p)) return false
  return isPathInVault(p) || registeredPaths.has(normalizePath(p))
}

/**
 * Extensions WriteMd is allowed to write into a document's `_assets/` folder.
 * Pasted and dropped images arrive here, and the extension reaches this module
 * straight from the renderer, so it is matched against a fixed set. Without
 * this, a crafted extension carrying `../` segments escapes the asset folder
 * and turns image paste into an arbitrary file write.
 */
const WRITABLE_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.bmp'
])

export function canWriteImageExtension(ext: string): boolean {
  const cleaned = ext.startsWith('.') ? ext : `.${ext}`
  return WRITABLE_IMAGE_EXTENSIONS.has(cleaned.toLowerCase())
}

const DOCUMENT_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.txt'])

/**
 * Existence probing: also allows siblings of registered paths, because a
 * rename has to check its target before the rename happens. Restricted to
 * document extensions so probing cannot be used to enumerate arbitrary
 * filenames in a directory the user merely happened to open a file from.
 */
export function canProbePath(p: string): boolean {
  if (canAccessPath(p)) return true
  if (!DOCUMENT_EXTENSIONS.has(extname(p).toLowerCase())) return false
  const dir = normalizePath(dirname(p))
  for (const registered of registeredPaths) {
    if (normalizePath(dirname(registered)) === dir) return true
  }
  return false
}

/** Rename: source must be accessible; target stays in the same directory. */
export function canRenamePath(oldPath: string, newPath: string): boolean {
  if (!canAccessPath(oldPath)) return false
  if (normalizePath(dirname(oldPath)) !== normalizePath(dirname(newPath))) return false
  // Without this, a note can be renamed in place from `.md` to `.bat`, which
  // the same-directory check above happily allows.
  return canWriteDocument(newPath)
}

export function assertCanAccess(p: string): void {
  if (!canAccessPath(p)) {
    throw new Error(`Access denied for path: ${p}`)
  }
}

/**
 * Extensions the renderer may ask the OS to open directly (`shell.openPath`).
 * Reading vs launching are different risks: a document opener is expected,
 * but an executable, installer, or script handler must never be reachable
 * from rendered content without an explicit user dialog.
 */
const OPENABLE_EXTENSIONS = new Set([
  ...DOCUMENT_EXTENSIONS,
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.bmp'
])

export function canOpenWithShell(p: string): boolean {
  return OPENABLE_EXTENSIONS.has(extname(p).toLowerCase())
}

export { isAllowedExternalProtocol } from '../shared/external-url'

/** Test seam: drop every registered external path. */
export function resetRegisteredPaths(): void {
  registeredPaths.clear()
}
