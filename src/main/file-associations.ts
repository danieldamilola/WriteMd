import { app } from 'electron'
import { join } from 'path'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { execSync } from 'child_process'

export function registerFileAssociations(): void {
  if (process.platform === 'win32') {
    registerWindowsAssociations()
  } else if (process.platform === 'darwin') {
    registerMacAssociations()
  } else if (process.platform === 'linux') {
    registerLinuxAssociations()
  }
}

function registerWindowsAssociations(): void {
  // The installer (electron-builder fileAssociations) owns real registration.
  // This is a best-effort fallback so dev builds open .md files.
  try {
    const exePath = process.execPath
    for (const ext of ['.md', '.markdown', '.mdown', '.mkd']) {
      const progId = `WriteMd${ext.slice(1)}`
      try {
        execSync(`reg add "HKCU\\Software\\Classes\\${ext}" /ve /d "${progId}" /f`, {
          stdio: 'ignore'
        })
        execSync(`reg add "HKCU\\Software\\Classes\\${progId}" /ve /d "Markdown File" /f`, {
          stdio: 'ignore'
        })
        execSync(
          `reg add "HKCU\\Software\\Classes\\${progId}\\shell\\open\\command" /ve /d "\\"${exePath}\\" \\"%1\\"" /f`,
          { stdio: 'ignore' }
        )
      } catch {
        // ignore individual failures
      }
    }
  } catch {
    console.warn('Failed to register Windows file associations')
  }
}

function registerMacAssociations(): void {
  if (app.dock && app.applicationMenu) {
    app.dock.setMenu(app.applicationMenu)
  }
}

function registerLinuxAssociations(): void {
  try {
    const desktopDir = join(homedir(), '.local/share/applications')
    if (!existsSync(desktopDir)) mkdirSync(desktopDir, { recursive: true })
    writeFileSync(
      join(desktopDir, 'writemd.desktop'),
      `[Desktop Entry]\nName=WriteMd\nExec=${process.execPath} %F\nTerminal=false\nType=Application\nMimeType=text/markdown;text/x-markdown;\n`
    )
    try {
      execSync('update-desktop-database ~/.local/share/applications', { stdio: 'ignore' })
    } catch {
      // desktop db tools may not exist, ignore
    }
  } catch {
    console.warn('Failed to register Linux file associations')
  }
}
