import { api } from '../api'
import { SettingsStore } from '../state/settings'

const notesModules = import.meta.glob('../../../../RELEASE_NOTES_*.md', {
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
  const version = (await api()?.app?.getVersion?.().catch(() => '')) ?? ''
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
