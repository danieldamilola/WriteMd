/**
 * Whether two paths name the same file.
 *
 * Slash-normalised, with a case-insensitive match on case-insensitive
 * filesystems only. Getting this wrong in either direction is expensive: too
 * strict and one file gets watched and saved as two, too loose and two files get
 * each other's writes.
 */
export function sameFilePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const forward = (p: string): string => p.replace(/\\/g, '/')
  if (forward(a) === forward(b)) return true
  const platform = typeof navigator !== 'undefined' ? (navigator.platform ?? '') : ''
  if (/^win|^mac/i.test(platform)) return forward(a).toLowerCase() === forward(b).toLowerCase()
  return false
}
