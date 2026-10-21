/**
 * Links that point at the project itself rather than at a document.
 *
 * The star action appears in two places (Settings → About and the home screen),
 * so the URL, the in-app star, and the browser fallback live here instead of
 * being copied.
 */
import { api } from '../api'

export const REPO_URL = 'https://github.com/danieldamilola/WriteMd'

/**
 * Open the repository in the system browser.
 *
 * A refused protocol or a machine with no browser is not worth an error
 * dialog: the click does nothing, the same as any other outbound link.
 */
export function openRepo(): void {
  const open = api()?.shell?.openExternal
  if (!open) return
  void open(REPO_URL).catch(() => undefined)
}

/**
 * Star the repository without leaving the app.
 *
 * Main resolves the GitHub CLI login and calls the API, so no browser, no
 * sign-in screen, and no token in the renderer. When that is not possible (no
 * CLI login, offline, GitHub refused) the browser is still a working route, so
 * the click never becomes a dead end. `starred` means "do not offer this
 * again"; `opened` means "the rest is up to the browser".
 */
export async function starRepo(): Promise<'starred' | 'opened'> {
  try {
    const result = await api()?.github?.star?.()
    if (result?.ok) return 'starred'
  } catch {
    // Fall through to the browser: a failed IPC call is not a reason to do
    // nothing when opening the page still lets the user star the repo.
  }
  openRepo()
  return 'opened'
}

/** Whether this account has already starred the repository, when known. */
export async function repoStarred(): Promise<boolean> {
  try {
    const status = await api()?.github?.status?.()
    return status?.starred === true
  } catch {
    return false
  }
}
