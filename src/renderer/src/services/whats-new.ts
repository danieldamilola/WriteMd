import { api } from '../api'
import { SettingsStore } from '../state/settings'

const notesModules = import.meta.glob('../../../../docs/release-notes/RELEASE_NOTES_*.md', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

function notesForVersion(version: string): string | null {
  for (const [path, md] of Object.entries(notesModules)) {
    if (path.includes(`v${version}`)) return md
  }
  return null
}

/**
 * A few lines of an update's notes, for the hover card on the toolbar button.
 *
 * The notes files open with `# Release Notes - v1.3.0`, then a `**Features**`
 * heading and one `- **Bold title**: prose...` bullet per feature. The bold
 * lead-in is the only part worth a hover card, so those are lifted out and the
 * prose dropped. Falls back to the first prose lines when a release has no
 * feature bullets, so an unusual notes file still says something.
 */
export function summarizeNotes(markdown: string, maxItems = 3): string[] {
  const withoutTitle = markdown.replace(/^#\s+.*\n+/, '')

  const bullets: string[] = []
  for (const line of withoutTitle.split('\n')) {
    const bullet = /^\s*[-*]\s+\*\*(.+?)\*\*/.exec(line)
    if (bullet) bullets.push(bullet[1].trim())
    if (bullets.length >= maxItems) return bullets
  }
  if (bullets.length > 0) return bullets

  // No feature bullets: take the first few prose lines that are not headings.
  // A `**Features**` section marker is a heading written in bold, and would
  // otherwise survive the `*_#-` strip as the fragment `Features**`.
  const prose: string[] = []
  for (const line of withoutTitle.split('\n')) {
    const trimmed = line.trim()
    if (/^\*\*.+\*\*:?$/.test(trimmed)) continue
    const text = trimmed.replace(/^[*_#-]+\s*/, '').trim()
    if (!text || text.startsWith('**')) continue
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
