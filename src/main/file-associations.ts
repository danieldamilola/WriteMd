import { app } from 'electron'
import { join } from 'path'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { execFileSync } from 'child_process'

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd']

/**
 * Best-effort file associations for a source build.
 *
 * A packaged install gets its associations from the electron-builder installer,
 * so this only needs to run for `pnpm dev` and `pnpm start`. It used to run on
 * every launch of any build, which meant a packaged app silently rewrote the
 * user's registry and desktop database behind their back, and an unpackaged
 * `electron .` would point the `.md` handler at a temporary binary.
 *
 * `execFileSync` is used rather than `execSync` so no argument is ever
 * interpolated into a shell command line.
 */
export function registerFileAssociations(): void {
  if (app.isPackaged) return

  if (process.platform === 'win32') {
    registerWindowsAssociations()
  } else if (process.platform === 'linux') {
    registerLinuxAssociations()
  }
  // macOS needs no equivalent: associations come from the bundle's Info.plist,
  // and `app.on('open-file')` in index.ts handles delivery.
}

function registerWindowsAssociations(): void {
  const exePath = process.execPath
  const reg = (args: string[]): void => {
    try {
      execFileSync('reg', args, { stdio: 'ignore' })
    } catch {
      // Individual failures are not fatal; one extension may be locked by
      // another application.
    }
  }

  for (const ext of MARKDOWN_EXTENSIONS) {
    const progId = `WriteMd${ext.slice(1)}`
    reg(['add', `HKCU\\Software\\Classes\\${ext}`, '/ve', '/d', progId, '/f'])
    reg(['add', `HKCU\\Software\\Classes\\${progId}`, '/ve', '/d', 'Markdown File', '/f'])
    reg([
      'add',
      `HKCU\\Software\\Classes\\${progId}\\shell\\open\\command`,
      '/ve',
      '/d',
      `"${exePath}" "%1"`,
      '/f'
    ])
  }
}

function registerLinuxAssociations(): void {
  const desktopDir = join(homedir(), '.local/share/applications')
  const desktopFile = join(desktopDir, 'writemd.desktop')
  try {
    // Do not clobber an entry the packaging step or the user already owns.
    if (existsSync(desktopFile)) return
    if (!existsSync(desktopDir)) mkdirSync(desktopDir, { recursive: true })
    writeFileSync(
      desktopFile,
      `[Desktop Entry]\nName=WriteMd\nExec=${process.execPath} %F\nTerminal=false\nType=Application\nMimeType=text/markdown;text/x-markdown;\n`
    )
    try {
      execFileSync('update-desktop-database', [desktopDir], { stdio: 'ignore' })
    } catch {
      // The desktop database tool is optional.
    }
  } catch (err) {
    console.warn('Failed to register Linux file associations:', err)
  }
}
