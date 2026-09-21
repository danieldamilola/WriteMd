import { dirname, extname, isAbsolute, resolve, sep } from 'path'

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

export function isPathInVault(p: string): boolean {
  const root = vaultRootProvider()
  if (!root) return false
  return isSubpath(p, root)
}

/** Read/write access: inside the vault, or a registered external path. */
export function canAccessPath(p: string): boolean {
  if (!p || !isAbsolute(p)) return false
  return isPathInVault(p) || registeredPaths.has(normalizePath(p))
}

/**
 * Existence probing: also allows siblings of registered paths (needed to
 * check a rename target before renaming).
 */
export function canProbePath(p: string): boolean {
  if (canAccessPath(p)) return true
  const dir = normalizePath(dirname(p))
  for (const registered of registeredPaths) {
    if (normalizePath(dirname(registered)) === dir) return true
  }
  return false
}

/** Rename: source must be accessible; target stays in the same directory. */
export function canRenamePath(oldPath: string, newPath: string): boolean {
  if (!canAccessPath(oldPath)) return false
  return normalizePath(dirname(newPath)) === normalizePath(dirname(oldPath))
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
  '.md',
  '.markdown',
  '.mdown',
  '.mkd',
  '.txt',
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
