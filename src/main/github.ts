/**
 * Starring the WriteMd repository from inside the app.
 *
 * GitHub has no anonymous star: `PUT /user/starred/:owner/:repo` needs a token
 * for the acting account. Rather than asking every user to create one, this
 * reuses the GitHub CLI login they may already have - `gh auth token` prints the
 * token it keeps in the OS keychain. The token stays in this module: it is never
 * written to disk, never logged, and never crosses the bridge to the renderer.
 *
 * When there is no CLI login the caller opens the repository in the browser
 * instead, which is what the button did before this existed.
 */
import { execFile } from 'child_process'
import { join } from 'path'
import log from 'electron-log'

const OWNER = 'danieldamilola'
const NAME = 'WriteMd'
const API = 'https://api.github.com'
const REQUEST_TIMEOUT_MS = 8000
const CLI_TIMEOUT_MS = 4000

export type GithubReason = 'no-cli' | 'offline' | 'rejected'

export interface GithubStatus {
  /** False when no CLI login was found, or GitHub refused the token. */
  connected: boolean
  /** The account the token belongs to, when GitHub answered. */
  login: string | null
  /** Whether that account has starred the repository, when known. */
  starred: boolean | null
  reason?: GithubReason
}

export type GithubStarResult =
  { ok: true; starred: true } | { ok: false; reason: GithubReason; message: string }

/**
 * Resolved once per run. `undefined` means "not looked yet", `null` means
 * "looked and found nothing" - both matter, and an empty string cannot stand in
 * for the second without pretending a token was found.
 */
let cachedToken: string | null | undefined

function cliCandidates(): string[] {
  const candidates = ['gh']
  if (process.platform === 'win32') {
    const programFiles = process.env['ProgramFiles']
    const localAppData = process.env['LOCALAPPDATA']
    if (programFiles) candidates.push(join(programFiles, 'GitHub CLI', 'gh.exe'))
    if (localAppData) candidates.push(join(localAppData, 'Programs', 'GitHub CLI', 'gh.exe'))
  }
  return candidates
}

function runGh(file: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      file,
      ['auth', 'token', '--hostname', 'github.com'],
      { timeout: CLI_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        const token = stdout.trim()
        // A signed-out CLI prints an error rather than a token, and an OAuth
        // token is the only shape with a scope that can star. Anything else is
        // treated as "no login" rather than sent to GitHub.
        resolve(/^(gho_|ghp_|github_pat_)[A-Za-z0-9_]+$/.test(token) ? token : null)
      }
    )
  })
}

async function readToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken
  for (const candidate of cliCandidates()) {
    const token = await runGh(candidate)
    if (token) {
      cachedToken = token
      return token
    }
  }
  cachedToken = null
  return null
}

function request(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'WriteMd',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
}

/** Whether the app can star without opening a browser, and whether it already has. */
export async function githubStatus(): Promise<GithubStatus> {
  const token = await readToken()
  if (!token) return { connected: false, login: null, starred: null, reason: 'no-cli' }

  try {
    const [user, star] = await Promise.all([
      request('/user', token),
      request(`/user/starred/${OWNER}/${NAME}`, token)
    ])
    if (user.status === 401 || star.status === 401) {
      // Not `null`: that would pin the rejection for the rest of the run, so a
      // `gh auth login` in another window could never take effect. Forgetting
      // the lookup costs one CLI spawn per check, and only after a rejection.
      cachedToken = undefined
      return { connected: false, login: null, starred: null, reason: 'rejected' }
    }
    const login = user.ok ? (((await user.json()) as { login?: string }).login ?? null) : null
    return { connected: true, login, starred: star.status === 204 }
  } catch (err) {
    log.warn('github: status check failed', err)
    return { connected: true, login: null, starred: null, reason: 'offline' }
  }
}

/** PUT is idempotent: starring twice is not an error. */
export async function starRepository(): Promise<GithubStarResult> {
  const token = await readToken()
  if (!token) {
    return { ok: false, reason: 'no-cli', message: 'GitHub CLI is not signed in.' }
  }

  try {
    const response = await request(`/user/starred/${OWNER}/${NAME}`, token, { method: 'PUT' })
    if (response.status === 204) return { ok: true, starred: true }
    if (response.status === 401) {
      cachedToken = undefined
      return { ok: false, reason: 'rejected', message: 'GitHub rejected the stored sign-in.' }
    }
    return {
      ok: false,
      reason: 'rejected',
      message: `GitHub refused the star (${response.status}).`
    }
  } catch (err) {
    log.warn('github: star failed', err)
    return { ok: false, reason: 'offline', message: 'GitHub could not be reached.' }
  }
}

/** Test seam: forget the CLI lookup so the next call runs it again. */
export function resetGithubCache(): void {
  cachedToken = undefined
}
