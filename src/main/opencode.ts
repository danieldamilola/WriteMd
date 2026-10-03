import { execFile } from 'child_process'
import { access, readFile, stat } from 'fs/promises'
import { constants } from 'fs'
import { homedir } from 'os'
import { join, delimiter } from 'path'

export interface OpencodeFound {
  path: string
  version: string | null
  /** Major version: 1 = `opencode console login`, 2+ = `opencode auth login opencode`. */
  major: number | null
}

/** Major version from a `--version` string like `1.18.34` or `opencode v2.3.1`. */
export function opencodeMajor(version: string | null): number | null {
  if (!version) return null
  const m = version.match(/(\d+)\.\d+\.\d+/)
  return m ? parseInt(m[1], 10) : null
}

/** Console login command for the detected CLI generation. */
export function opencodeLoginCommand(major: number | null): string {
  return major !== null && major >= 2 ? 'opencode auth login opencode' : 'opencode console login'
}

/**
 * argv for running a `.cmd`/`.bat` shim via PowerShell's call operator.
 *
 * Pre-quoted strings must never travel through spawn argv on Windows: Node
 * escapes embedded `"` as `\"` when building the CreateProcess command line,
 * and `cmd.exe` does not understand backslash escapes - it tried to run a
 * program literally named `'"C:\…\opencode.cmd"'`. Single-quoted PowerShell
 * gives Node nothing to mangle (paths are also `'`-escaped for O'Brien-style
 * usernames), and `-Command & …` is unaffected by execution policy.
 */
export function psCommand(bin: string, args: string[]): string[] {
  const quoted = `'${bin.replace(/'/g, "''")}'`
  return ['-NoProfile', '-NonInteractive', '-Command', `& ${quoted} ${args.join(' ')}`.trim()]
}

/** Run a binary's `--version`, handling Windows `.cmd` shims via PowerShell. */
function runVersion(bin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const lower = bin.toLowerCase()
    const done = (err: unknown, stdout: string, stderr: string): void => {
      if (err) {
        // Attach the process output so diagnostics can show *why* a candidate
        // failed (e.g. "'node' is not recognized" when the shim's runtime is
        // missing from the app's PATH).
        const detail = (stderr || stdout || '').trim().split('\n')[0] ?? ''
        const cause = err instanceof Error ? err.message.split('\n')[0] : String(err)
        reject(new Error(detail ? `${cause} - ${detail}` : cause))
        return
      }
      resolve((stdout || stderr || '').trim())
    }
    if (process.platform === 'win32' && (lower.endsWith('.cmd') || lower.endsWith('.bat'))) {
      execFile(
        'powershell.exe',
        psCommand(bin, ['--version']),
        { timeout: 8000, windowsHide: true },
        done
      )
      return
    }
    execFile(bin, ['--version'], { timeout: 8000, windowsHide: true }, done)
  })
}

async function isRunnable(p: string): Promise<boolean> {
  try {
    await access(p, constants.X_OK)
    return true
  } catch {
    // .cmd shims may not have the executable bit; fall back to readability.
    try {
      await access(p, constants.R_OK)
      return true
    } catch {
      return false
    }
  }
}

/**
 * Map a candidate to the path that actually executes. An extensionless npm
 * shim (`.../npm/opencode`) is not runnable on Windows - its `.cmd` twin is -
 * so probe the extensions and hand back the runnable sibling instead of the
 * dead script.
 */
async function runnablePath(p: string): Promise<string | null> {
  if (await isRunnable(p)) return p
  if (process.platform === 'win32' && !/\.[a-z0-9]+$/i.test(p)) {
    for (const ext of ['.exe', '.cmd', '.bat', '.com']) {
      if (await isRunnable(p + ext)) return p + ext
    }
  }
  return null
}

/** PATH lookup. On Windows `where` returns the extensionless shim first - prefer runnable extensions. */
function lookupOnPath(): Promise<string[]> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('where', ['opencode'], { timeout: 8000, windowsHide: true }, (err, stdout) => {
        if (err) return resolve([])
        const lines = stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
        const runnable = lines.filter((l) => /\.(cmd|exe|bat|com|ps1)$/i.test(l))
        resolve([...runnable, ...lines.filter((l) => !runnable.includes(l))])
      })
      return
    }
    execFile('which', ['-a', 'opencode'], { timeout: 8000 }, (err, stdout) => {
      if (err) return resolve([])
      resolve(
        stdout
          .split(/\n/)
          .map((l) => l.trim())
          .filter(Boolean)
      )
    })
  })
}

/**
 * Resolve the opencode CLI the way the known Windows pitfalls demand:
 * npm installs to %APPDATA%\npm\opencode.cmd (a batch shim `execFile`
 * cannot run directly), and `where` lists the extensionless shell script
 * before the runnable `.cmd`.
 *
 * Returns every probe attempted, so Settings can show *why* detection failed
 * instead of a bare "not found".
 */
export interface OpencodeAttempt {
  path: string
  ok: boolean
  detail: string
}

export async function resolveOpencodeBinary(
  customPath?: string
): Promise<{ found: OpencodeFound | null; attempts: OpencodeAttempt[] }> {
  const home = homedir()
  const appData =
    process.env.APPDATA || (process.platform === 'win32' ? join(home, 'AppData', 'Roaming') : '')
  const localAppData =
    process.env.LOCALAPPDATA || (process.platform === 'win32' ? join(home, 'AppData', 'Local') : '')

  const candidates: string[] = []
  const attempts: OpencodeAttempt[] = []
  const push = (p?: string | null): void => {
    if (p && !candidates.includes(p)) candidates.push(p)
  }
  const custom = customPath?.trim() || undefined
  if (custom && !/(^|[\\/])opencode[^\\/]*$/i.test(custom)) {
    // A stale Browse pick (e.g. another tool's shim) must not masquerade as
    // the opencode CLI: its --version would succeed and poison everything
    // downstream. Skip it loudly instead of trusting it.
    attempts.push({ path: custom, ok: false, detail: 'not an opencode binary - pick opencode.cmd' })
  } else {
    push(custom)
  }
  push(process.env.OPENCODE_BIN || undefined)
  push(process.env.OPENCODE_PATH || undefined)
  if (process.platform === 'win32') {
    if (appData) {
      push(join(appData, 'npm', 'opencode.cmd'))
      push(join(appData, 'npm', 'opencode.exe'))
      push(join(appData, 'npm', 'opencode'))
    }
    if (localAppData) push(join(localAppData, 'opencode', 'bin', 'opencode.exe'))
    push(join(home, '.opencode', 'bin', 'opencode.exe'))
    push(join(home, '.bun', 'bin', 'opencode.exe'))
    push(join(home, '.npm-global', 'bin', 'opencode.exe'))
    push(join(home, '.local', 'bin', 'opencode.exe'))
  } else {
    push(join(home, '.local', 'bin', 'opencode'))
    push(join(home, '.opencode', 'bin', 'opencode'))
    push(join(home, '.npm-global', 'bin', 'opencode'))
    push('/usr/local/bin/opencode')
    push('/opt/homebrew/bin/opencode')
  }

  for (const c of candidates) {
    const runnable = await runnablePath(c)
    if (!runnable) {
      attempts.push({ path: c, ok: false, detail: 'no runnable file (tried .exe/.cmd/.bat/.com)' })
      continue
    }
    try {
      const version = await runVersion(runnable)
      const v = version.split(/\s/).pop() || version || null
      const found = { path: runnable, version: v, major: opencodeMajor(v) }
      attempts.push({ path: runnable, ok: true, detail: v ?? 'ran, no version parsed' })
      return { found, attempts }
    } catch (e) {
      // Exists but does not execute (stale shim, node missing from this
      // process's PATH) - keep looking instead of returning a dead binary.
      attempts.push({
        path: runnable,
        ok: false,
        detail: e instanceof Error ? e.message : String(e)
      })
      continue
    }
  }

  const onPath = await lookupOnPath()
  if (onPath.length === 0)
    attempts.push({ path: '(PATH lookup)', ok: false, detail: 'where/which found nothing' })
  for (const found of onPath) {
    try {
      const version = await runVersion(found)
      const v = version.split(/\s/).pop() || version || null
      const result = { path: found, version: v, major: opencodeMajor(v) }
      attempts.push({ path: found, ok: true, detail: v ?? 'ran, no version parsed' })
      return { found: result, attempts }
    } catch (e) {
      // A path `where` knows but we cannot execute (permissions, stale shim).
      attempts.push({
        path: found,
        ok: false,
        detail: e instanceof Error ? e.message : String(e)
      })
      continue
    }
  }

  // Last resort: bare name works when PATH resolution differs per shell
  // (npm global bin visible to the user but not to this process).
  try {
    const version = await runVersion('opencode')
    const v = version.split(/\s/).pop() || version || null
    const result = { path: 'opencode', version: v, major: opencodeMajor(v) }
    attempts.push({ path: 'opencode', ok: true, detail: v ?? 'ran, no version parsed' })
    return { found: result, attempts }
  } catch (e) {
    attempts.push({
      path: 'opencode',
      ok: false,
      detail: e instanceof Error ? e.message : String(e)
    })
    return { found: null, attempts }
  }
}

/** Best-effort model list from the CLI; null when the command is unavailable. */
export async function listOpencodeModels(bin: string, cwd?: string): Promise<string[] | null> {
  const tryArgs = async (args: string[]): Promise<string[] | null> => {
    const out = await runCli(bin, args, cwd, 15000).catch(() => null)
    if (!out) return null
    try {
      const ids = collectModelIds(JSON.parse(out) as unknown)
      return ids.length > 0 ? ids : null
    } catch {
      const ids = parseTextModelList(out)
      return ids.length > 0 ? ids : null
    }
  }

  // Both variants are attempted and unioned: `--format json` can succeed with
  // a partial shape on some builds, in which case plain `models` still has
  // the full list (and vice versa).
  const [jsonIds, textIds] = await Promise.all([
    tryArgs(['models', '--format', 'json']),
    tryArgs(['models'])
  ])
  const merged = unionModelIds(jsonIds ?? [], textIds ?? [])
  return merged.length > 0 ? merged : null
}

/** Sorted union of model id lists. Pure for testing. */
export function unionModelIds(...lists: string[][]): string[] {
  return [...new Set(lists.flat())].sort()
}

const PROVIDER_KEYS = ['providerID', 'providerId', 'provider_id', 'provider']
const MODEL_KEYS = ['modelID', 'modelId', 'model_id', 'model']
const SCOPE_STOPWORDS = new Set([
  'data',
  'models',
  'providers',
  'result',
  'results',
  'items',
  'list'
])

function firstString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

/**
 * Model ids out of whatever shape `models --format json` returns: slash
 * strings, {provider, model} pairs in any casing, or provider-keyed nests
 * like `{ opencode: { models: [...] } }` where bare names need their parent
 * as prefix.
 */
export function collectModelIds(data: unknown): string[] {
  const ids: string[] = []
  const collect = (v: unknown, scope?: string): void => {
    if (typeof v === 'string') {
      if (v.includes('/')) ids.push(v)
      else if (scope) ids.push(`${scope}/${v}`)
      return
    }
    if (Array.isArray(v)) {
      v.forEach((item) => collect(item, scope))
      return
    }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      const provider = firstString(o, PROVIDER_KEYS)
      const model = firstString(o, [...MODEL_KEYS, 'id', 'name'])
      if (provider && model) {
        ids.push(model.includes('/') ? model : `${provider}/${model}`)
        return
      }
      for (const [k, val] of Object.entries(o)) {
        const childScope =
          /^[a-z][a-z0-9_-]*$/i.test(k) &&
          !SCOPE_STOPWORDS.has(k.toLowerCase()) &&
          (Array.isArray(val) || (val !== null && typeof val === 'object'))
            ? k
            : scope
        collect(val, childScope)
      }
    }
  }
  collect(data)
  return [...new Set(ids)].sort()
}

/**
 * Model ids out of plain-text `models` output: inline `provider/model`
 * tokens plus bare names under an unindented provider header.
 */
export function parseTextModelList(out: string): string[] {
  const ids = new Set<string>()
  for (const m of out.matchAll(/[a-z0-9_-]+\/[a-z0-9_.\-+]+/gi)) ids.add(m[0])
  let scope: string | null = null
  for (const raw of out.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) continue
    const indent = line.length - line.trimStart().length
    const first = line.trim().split(/\s+/)[0]
    if (indent === 0 && /^[a-z][a-z0-9_-]*:?$/i.test(line.trim()) && !first.includes('/')) {
      const name = first.replace(/:$/, '')
      scope = SCOPE_STOPWORDS.has(name.toLowerCase()) ? null : name
      continue
    }
    if (scope && indent > 0 && /^[a-z0-9_.\-+]+$/i.test(first) && !first.includes('/')) {
      ids.add(`${scope}/${first}`)
    }
  }
  return [...ids].sort()
}

function runCli(bin: string, args: string[], cwd?: string, timeoutMs = 15000): Promise<string> {
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
  return new Promise((resolve, reject) => {
    const cb = (err: unknown, stdout: string, stderr: string): void => {
      if (err) reject(err)
      else resolve(stdout || stderr || '')
    }
    if (needsShell) {
      execFile(
        'powershell.exe',
        psCommand(bin, args),
        {
          timeout: timeoutMs,
          cwd,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024
        },
        cb
      )
      return
    }
    execFile(
      bin,
      args,
      { timeout: timeoutMs, cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      cb
    )
  })
}

/** PATH entries shown in Settings so the user can see where detection looked. */
export function opencodeSearchHints(): string[] {
  const home = homedir()
  const parts = (process.env.PATH || '').split(delimiter).filter(Boolean)
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming')
    return [join(appData, 'npm'), ...parts.slice(0, 6)]
  }
  return parts.slice(0, 8)
}

export interface OpencodeAuth {
  /** True when the Console/opencode credential is present. */
  loggedIn: boolean
  /** Human line for Settings, e.g. "opencode credential present (auth.json)". */
  detail: string
}

/** Directories holding auth.json (V1) / opencode.db (V2 credentials). */
function opencodeDataDirs(): string[] {
  const home = homedir()
  const dirs: string[] = []
  if (process.env.XDG_DATA_HOME) dirs.push(join(process.env.XDG_DATA_HOME, 'opencode'))
  dirs.push(join(home, '.local', 'share', 'opencode'))
  if (process.platform === 'win32') {
    // Troubleshooting docs: Windows uses %USERPROFILE%\.local\share\opencode.
    dirs.push(join(home, '.config', 'opencode'))
  }
  return [...new Set(dirs)]
}

/**
 * Console login status via `opencode auth list` (v1 shows help for bare
 * `auth status` - that is a command group, not a status readout). Falls back
 * to the credential files (auth.json with an "opencode" entry, or a V2
 * opencode.db import).
 */
export async function getOpencodeAuthStatus(bin: string, cwd?: string): Promise<OpencodeAuth> {
  // Short timeout: some builds prompt interactively here, and a hung Recheck
  // is worse than falling back to the credential files.
  const out = await runCli(bin, ['auth', 'list'], cwd, 8000).catch(() => null)
  if (out) {
    const lower = out.toLowerCase()
    if (lower.includes('opencode')) {
      const loggedIn =
        /logged\s*in|authenticated|connected|ok\b/.test(lower) &&
        !/not\s+(logged|authenticated)/.test(lower)
      // `auth status` lists providers; an opencode row existing at all usually
      // means the credential is stored, even when the wording differs by build.
      return {
        loggedIn,
        detail: loggedIn
          ? 'opencode credential present (auth status)'
          : 'opencode listed but not logged in'
      }
    }
  }
  for (const dir of opencodeDataDirs()) {
    try {
      const raw = await readFile(join(dir, 'auth.json'), 'utf-8')
      const data = JSON.parse(raw) as Record<string, unknown>
      if (data && typeof data === 'object' && 'opencode' in data) {
        return { loggedIn: true, detail: 'opencode credential present (auth.json)' }
      }
      if (out === null) {
        return {
          loggedIn: false,
          detail: 'auth.json exists but has no opencode entry - run the Console login command'
        }
      }
    } catch {
      // Missing or unreadable - try the next location.
    }
  }
  // V2 keeps credentials in SQLite; presence alone cannot prove login, but its
  // absence proves there is nothing to import.
  for (const dir of opencodeDataDirs()) {
    try {
      const st = await stat(join(dir, 'opencode.db'))
      if (st.size > 0) {
        return {
          loggedIn: out !== null,
          detail:
            out !== null
              ? 'credential database present (opencode.db) - confirm with `opencode auth list`'
              : 'credential database present but login unconfirmed - run the Console login command'
        }
      }
    } catch {
      // no db here
    }
  }
  return { loggedIn: false, detail: 'not logged in - run the Console login command below' }
}
