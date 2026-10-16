import { api } from '../api'
import { SettingsStore } from '../state/settings'

const changelogModules = import.meta.glob('../../../../CHANGELOG.md', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

// Take the single match by suffix rather than by the pattern key: the bundler is
// free to normalize the key, and a literal lookup silently produced an empty
// changelog in a production build while the dev build worked.
const changelog =
  Object.entries(changelogModules).find(([path]) => path.endsWith('CHANGELOG.md'))?.[1] ?? ''

/**
 * One version's block from the changelog, without its heading.
 *
 * The file is the single record in Keep a Changelog form, so a version is a `##`
 * heading followed by `###` sections and bullets until the next `##`. Lines
 * above the first version heading, including the format preamble, are skipped so
 * a malformed heading can never return the whole file.
 */
export function changelogSection(markdown: string, version: string): string | null {
  const wanted = `## [${version}]`
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => line.startsWith(wanted))
  if (start === -1) return null
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  const body = (end === -1 ? lines.slice(start + 1) : lines.slice(start + 1, end)).join('\n')
  return body.trim() || null
}

function notesForVersion(version: string): string | null {
  if (!version) return null
  return changelogSection(changelog, version)
}

/**
 * A few lines of a release's notes, for the hover card on the toolbar button.
 *
 * Only the bold lead-in of each bullet is worth a hover card, so the prose is
 * dropped. Falls back to the first prose lines when a section has no bold
 * lead-ins, so an unusual entry still says something.
 */
export function summarizeNotes(markdown: string, maxItems = 3): string[] {
  const bullets: string[] = []
  for (const line of markdown.split('\n')) {
    const bullet = /^\s*[-*]\s+\*\*(.+?)\*\*/.exec(line)
    if (bullet) bullets.push(bullet[1].trim())
    if (bullets.length >= maxItems) return bullets
  }
  if (bullets.length > 0) return bullets

  // No bold lead-ins: take the first few prose lines that are not headings.
  const prose: string[] = []
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const text = trimmed
      .replace(/^[-*_]+\s*/, '')
      .replace(/\s*[-:]$/, '')
      .trim()
    if (!text) continue
    prose.push(text)
    if (prose.length >= maxItems) break
  }
  return prose
}

/** The summarized notes for a version that is not running yet, if bundled. */
export function summarizeNotesForVersion(version: string, maxItems = 3): string[] {
  if (!version) return []
  const md = notesForVersion(version)
  return md ? summarizeNotes(md, maxItems) : []
}

interface WhatsNewElement extends HTMLElement {
  open: boolean
  version: string
  markdown: string
}

function ensureDialog(): Promise<WhatsNewElement> {
  return import('../components/WhatsNewDialog').then(() => {
    let dialog = document.querySelector<WhatsNewElement>('writemd-whats-new')
    if (!dialog) {
      dialog = document.createElement('writemd-whats-new') as WhatsNewElement
      document.body.appendChild(dialog)
    }
    return dialog
  })
}

export async function showWhatsNew(version: string, markdown: string): Promise<void> {
  const dialog = await ensureDialog()
  dialog.version = version
  dialog.markdown = markdown
  dialog.open = true
}

/** Open the release notes for the version currently running. */
export async function showCurrentWhatsNew(): Promise<boolean> {
  const version =
    (await api()
      ?.app?.getVersion?.()
      .catch(() => '')) ?? ''
  const markdown = version ? notesForVersion(version) : null
  if (!markdown) return false
  await showWhatsNew(version, markdown)
  return true
}

/**
 * Show the release notes once, right after an update installs. On the very
 * first run there is no stored version, so we only record it and stay quiet.
 */
export async function maybeShowWhatsNew(): Promise<void> {
  const version =
    (await api()
      ?.app?.getVersion?.()
      .catch(() => '')) ?? ''
  if (!version) return
  const store = SettingsStore.getInstance()
  const last = store.get<string>('updates.lastSeenWhatsNewVersion', '')
  if (last && last !== version) {
    const md = notesForVersion(version)
    if (md) await showWhatsNew(version, md)
  }
  if (last !== version) {
    store.set('updates.lastSeenWhatsNewVersion', version)
  }
}
