// Ensures the Electron binary exists after install.
// Background: @electron/get downloads the zip to the cache fine, but its
// extract step (extract-zip) silently never resolves on this machine, so
// install.js finishes with no binary. This script extracts the cached zip
// with OS tools instead. Runs on every `pnpm install` via postinstall.
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

function main() {
  const electronDir = path.join(__dirname, '..', 'node_modules', 'electron')
  const distExe = path.join(
    electronDir,
    'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron'
  )
  if (fs.existsSync(distExe)) {
    console.log('[ensure-electron] binary present, nothing to do')
    return
  }

  const pkg = require(path.join(electronDir, 'package.json'))
  const version = pkg.version
  const plat =
    process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
  const arch = process.arch
  const zipName = `electron-v${version}-${plat}-${arch}.zip`

  const cacheRoots = [
    process.env.ELECTRON_CACHE,
    path.join(os.homedir(), 'AppData', 'Local', 'electron', 'Cache'),
    path.join(os.homedir(), '.cache', 'electron')
  ].filter(Boolean)

  let zipPath = null
  for (const root of cacheRoots) {
    if (!root || !fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root)) {
      const candidate = path.join(root, entry, zipName)
      if (fs.existsSync(candidate)) {
        zipPath = candidate
        break
      }
    }
    if (zipPath) break
  }

  if (!zipPath) {
    console.error(`[ensure-electron] cached ${zipName} not found, cannot extract`)
    process.exit(1)
  }

  const distDir = path.join(electronDir, 'dist')
  fs.mkdirSync(distDir, { recursive: true })
  console.log(`[ensure-electron] extracting ${zipPath}`)
  if (process.platform === 'win32') {
    execSync(`Expand-Archive -Path "${zipPath}" -DestinationPath "${distDir}" -Force`, {
      shell: 'powershell.exe',
      stdio: 'inherit'
    })
    fs.writeFileSync(path.join(electronDir, 'path.txt'), 'electron.exe')
  } else {
    execSync(`unzip -oq "${zipPath}" -d "${distDir}"`, { stdio: 'inherit' })
    fs.writeFileSync(path.join(electronDir, 'path.txt'), 'electron')
  }

  if (!fs.existsSync(distExe)) {
    console.error('[ensure-electron] extraction finished but binary still missing')
    process.exit(1)
  }
  console.log('[ensure-electron] binary ready')
}

main()
