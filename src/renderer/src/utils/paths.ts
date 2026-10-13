/** Filesystems where two paths differing only in case still name one file. */
function caseInsensitiveFs(): boolean {
  const platform = typeof navigator !== 'undefined' ? (navigator.platform ?? '') : ''
  return /^win|^mac/i.test(platform)
}

/**
 * Identity key for a path: slash-normalised, case-folded where the filesystem
 * is case-insensitive. For comparing and deduplicating only. Never display it,
 * because the case fold loses a filename's real casing.
 */
export function filePathKey(path: string | null | undefined): string | null {
  if (!path) return null
  const forward = path.replace(/\\/g, '/')
  return caseInsensitiveFs() ? forward.toLowerCase() : forward
}

/**
 * Whether `path` sits inside `dir`. Compares by identity key, so a backslash
 * path still matches a forward-slash vault root, and requires a separator at
 * the boundary so `Vault2/note.md` is not treated as living in `Vault`.
 */
export function isInsideDir(path: string | null | undefined, dir: string | null | undefined): boolean {
  const key = filePathKey(path)
  const dirKey = filePathKey(dir)
  if (key === null || dirKey === null) return false
  const base = dirKey.replace(/\/+$/, '')
  if (!base) return false
  return key === base || key.startsWith(`${base}/`)
}

/**
 * Whether two paths name the same file.
 *
 * Slash-normalised, with a case-insensitive match on case-insensitive
 * filesystems only. Getting this wrong in either direction is expensive: too
 * strict and one file gets watched and saved as two, too loose and two files get
 * each other's writes.
 */
export function sameFilePath(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = filePathKey(a)
  if (key === null) return false
  return key === filePathKey(b)
}
