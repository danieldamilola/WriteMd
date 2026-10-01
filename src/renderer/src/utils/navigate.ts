/** Single place that decides what a clicked link destination means. Renderer-safe. */

import { isAllowedExternalProtocol } from '../../../shared/external-url'
import type { ElectronAPI } from '../../../shared/electron-api'
import { isExternalUrl, resolveLinkPath } from './links'

export type LinkOutcome =
  'opened-document' | 'opened-external' | 'same-document' | 'not-a-document' | 'blocked' | 'failed'

const MARKDOWN_EXT = /\.(md|markdown|mdown|mkd)$/i

export interface NavigateDeps {
  /** Path of the document the link was clicked in, or null for a new unsaved buffer. */
  sourcePath: string | null
  /** Opens the resolved path as a document, typically `FileState.openFile`. */
  openFile: (path: string) => Promise<void>
  getApi: () => ElectronAPI | undefined
  /** Called for a `#anchor` link into the document already open. */
  scrollToAnchor?: (anchor: string) => void
  /** Called when a markdown link points at a document that does not exist. */
  onMissing?: (path: string) => void
  /** Create a missing note on click, Obsidian-style. Off by default. */
  createMissing?: (path: string) => Promise<void>
}

/**
 * Follow a markdown link destination.
 *
 * Order matters: anchor-only links stay in the current document, allowed web
 * schemes leave through the OS shell, and everything else is treated as a path
 * relative to `sourcePath` and opened as a document. The old behavior sent
 * every destination to `shell.openExternal`, which the main process refuses for
 * non-web schemes, so `[a](notes/b.md)` was a silent no-op.
 */
export async function navigateLink(rawTarget: string, deps: NavigateDeps): Promise<LinkOutcome> {
  const raw = rawTarget.trim()
  if (!raw) return 'not-a-document'

  // `#heading` and `file.md#heading`: the path part decides, the anchor is a hint.
  const hashIdx = raw.indexOf('#')
  const anchor = hashIdx >= 0 ? raw.slice(hashIdx + 1) : ''
  const bare = raw.startsWith('#') ? '' : raw

  if (!bare) {
    if (anchor) deps.scrollToAnchor?.(anchor)
    return 'same-document'
  }

  if (isAllowedExternalProtocol(bare)) {
    try {
      await deps.getApi()?.shell?.openExternal(bare)
      return 'opened-external'
    } catch {
      return 'failed'
    }
  }

  // A scheme we do not allow, or a protocol-relative URL. Never attempt to
  // turn one of these into a path.
  if (isExternalUrl(bare)) return 'blocked'

  const resolved = resolveLinkPath(deps.sourcePath, bare)
  if (!resolved) return 'not-a-document'

  try {
    await deps.openFile(resolved)
    if (anchor) deps.scrollToAnchor?.(anchor)
    return 'opened-document'
  } catch (err) {
    console.error('Failed to follow link:', resolved, err)
    return 'failed'
  }
}

/** True when a path names something this app can open as a document. */
export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXT.test(path)
}

/**
 * Resolve a markdown link to an existing vault document, creating it when the
 * caller opts in. Returns the path to open, or null when it cannot be made.
 */
export async function resolveOrCreateLink(
  rawTarget: string,
  deps: NavigateDeps
): Promise<string | null> {
  const raw = rawTarget.trim()
  const bare = raw.split('#')[0].split('?')[0].trim()
  if (!bare || isExternalUrl(raw)) return null

  const resolved = resolveLinkPath(deps.sourcePath, bare)
  if (!resolved) return null

  const exists = await deps.getApi()?.file?.exists?.(resolved)
  if (exists) return resolved

  const candidate = MARKDOWN_EXT.test(resolved) ? resolved : `${resolved}.md`
  if (deps.createMissing) {
    try {
      await deps.createMissing(candidate)
      return candidate
    } catch (err) {
      console.error('Failed to create linked note:', candidate, err)
      return null
    }
  }
  deps.onMissing?.(candidate)
  return null
}
