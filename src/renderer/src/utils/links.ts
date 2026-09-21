/** Shared markdown/wiki link parsing and resolution. Renderer-safe (no Node APIs). */

export interface ExtractedLinks {
  /** Raw `[[...]]` targets, e.g. `note`, `note|alias`, `folder/note#heading`. */
  wiki: string[]
  /** Raw `(...)` destinations from inline markdown links and images. */
  md: string[]
}

const WIKI_RE = /\[\[([^\]]+)\]\]/g
const MD_LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g

export function extractLinks(content: string): ExtractedLinks {
  const wiki: string[] = []
  const md: string[] = []
  WIKI_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WIKI_RE.exec(content)) !== null) {
    if (m[1].trim()) wiki.push(m[1].trim())
  }
  MD_LINK_RE.lastIndex = 0
  while ((m = MD_LINK_RE.exec(content)) !== null) {
    if (m[1].trim()) md.push(m[1].trim())
  }
  return { wiki, md }
}

/** `[[target|alias]]` / `[[target#heading]]` → `target`. */
export function cleanWikiTarget(raw: string): string {
  return raw.split('|')[0].split('#')[0].trim()
}

export function isExternalUrl(target: string): boolean {
  const t = target.trim()
  return (
    t.startsWith('//') ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t) ||
    t.startsWith('mailto:') ||
    t.startsWith('#')
  )
}

/** True for http(s) website URLs, with or without scheme (`example.com` counts). */
export function isWebUrl(target: string): boolean {
  const t = target.trim()
  if (!t || /\s/.test(t)) return false
  if (/^https?:\/\//i.test(t)) return true
  // Other schemes (mailto:, ftp:, …), paths, anchors and wiki syntax are not websites.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t)) return false
  if (t.startsWith('/') || t.startsWith('.') || t.startsWith('#')) return false
  if (t.startsWith('[') || t.startsWith('<') || t.startsWith('!')) return false
  const host = t.split('/')[0]
  return /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+(:\d+)?$/.test(host)
}

/** Ensure a website URL has a scheme so markdown renderers linkify it. */
export function normalizeExternalUrl(target: string): string {
  const t = target.trim()
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}

/** Lowercased `/`-separated path with `.`/`..` resolved, drive letters kept. */
export function normalizePath(p: string): string {
  const forward = p.replace(/\\/g, '/')
  const drive = forward.match(/^[a-zA-Z]:\//) ? forward.slice(0, 2) : ''
  const rest = drive ? forward.slice(2) : forward
  const absolute = rest.startsWith('/')
  const out: string[] = []
  for (const seg of rest.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else if (!absolute && !drive) out.push('..')
      continue
    }
    out.push(seg)
  }
  return `${drive}${absolute ? '/' : ''}${out.join('/')}`.toLowerCase()
}

export function basenameNoExt(p: string): string {
  const base = p.replace(/\\/g, '/').split('/').pop() ?? p
  return base.replace(/\.[^/.]+$/, '')
}

function dirnameOf(p: string): string {
  const forward = p.replace(/\\/g, '/')
  const idx = forward.lastIndexOf('/')
  return idx >= 0 ? forward.slice(0, idx) : ''
}

/**
 * Resolve a markdown link destination against the linking file.
 * Returns a normalized absolute-ish path, or null for external/anchor links.
 */
export function resolveMdTarget(sourcePath: string, rawTarget: string): string | null {
  let t = rawTarget.trim()
  if (t.startsWith('<') && t.endsWith('>')) t = t.slice(1, -1).trim()
  t = t.split('#')[0].trim()
  if (!t || isExternalUrl(rawTarget.trim())) return null
  const forward = t.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(forward) || forward.startsWith('/')) {
    return normalizePath(forward)
  }
  return normalizePath(`${dirnameOf(sourcePath)}/${forward}`)
}

/**
 * Does any link in `sourceContent` (from `sourcePath`) point at `targetPath`?
 * Wiki-links match by file stem across folders; markdown links resolve
 * relative to the source file, so cross-folder references work.
 */
export function linksToFile(
  sourcePath: string,
  sourceContent: string,
  targetPath: string
): boolean {
  const normTarget = normalizePath(targetPath)
  const targetStem = basenameNoExt(normTarget)
  const { wiki, md } = extractLinks(sourceContent)
  for (const raw of wiki) {
    const cleaned = cleanWikiTarget(raw)
    if (!cleaned) continue
    if (basenameNoExt(cleaned.toLowerCase()) === targetStem) return true
    const asPath = cleaned.replace(/\\/g, '/')
    if (/^[a-zA-Z]:\//.test(asPath) || asPath.startsWith('/') || asPath.includes('/')) {
      const resolved = asPath.includes('/')
        ? normalizePath(
            /^[a-zA-Z]:\//.test(asPath) || asPath.startsWith('/')
              ? asPath
              : `${dirnameOf(sourcePath)}/${asPath}`
          )
        : null
      if (resolved === normTarget) return true
    }
  }
  for (const raw of md) {
    if (resolveMdTarget(sourcePath, raw) === normTarget) return true
  }
  return false
}

/** First content line containing a link to the target, trimmed for display. */
export function backlinkSnippet(
  sourceContent: string,
  sourcePath: string,
  targetPath: string,
  maxLen = 140
): string {
  const normTarget = normalizePath(targetPath)
  const targetStem = basenameNoExt(normTarget)
  for (const line of sourceContent.split('\n')) {
    const { wiki, md } = extractLinks(line)
    const hitWiki = wiki.some((raw) => {
      const cleaned = cleanWikiTarget(raw)
      return cleaned !== '' && basenameNoExt(cleaned.toLowerCase()) === targetStem
    })
    const hitMd = md.some((raw) => resolveMdTarget(sourcePath, raw) === normTarget)
    if (hitWiki || hitMd) {
      const trimmed = line.trim()
      return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 1)}…` : trimmed
    }
  }
  return ''
}

/** Display form for menus: last two path segments. */
export function shortPath(fullPath: string): string {
  const parts = fullPath.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
  return parts[parts.length - 1] ?? fullPath
}
