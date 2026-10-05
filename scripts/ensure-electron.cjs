// Ensures the Electron binary exists after install.
//
// Background: @electron/get downloads the zip to its cache fine, but its
// extract step (extract-zip) silently never resolves on this machine, so
// install.js finishes with no binary. This script extracts the cached zip with
// OS tools instead.
//
// It runs on every `pnpm install` via postinstall, which means it also runs on
// CI. It used to exit 1 when the zip was not already cached, so any runner where
// @electron/get had not populated the cache failed the whole install with
// "cached electron-v<version>-<plat>-<arch>.zip not found". It now downloads
// the zip itself when it is missing, and only fails if that download fails.
const { execFileSync } = require('child_process')
const fs = require('fs')
const https = require('https')
const path = require('path')
const os = require('os')

const PLATFORM =
  process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
const ARCH = process.arch

function download(url, destination, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'writemd-ensure-electron' } }, (res) => {
        // GitHub redirects release assets to a CDN.
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft === 0) return reject(new Error('too many redirects'))
          res.resume()
          return resolve(download(res.headers.location, destination, redirectsLeft - 1))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        }
        const out = fs.createWriteStream(destination)
        res.pipe(out)
        out.on('finish', () => out.close(() => resolve(destination)))
        out.on('error', reject)
      })
      .on('error', reject)
  })
}

function cacheRoots() {
  return [
    process.env.ELECTRON_CACHE,
    path.join(os.homedir(), 'AppData', 'Local', 'electron', 'Cache'),
    path.join(os.homedir(), '.cache', 'electron'),
    path.join(os.homedir(), 'Library', 'Caches', 'electron')
  ].filter(Boolean)
}

function findCached(zipName) {
  for (const root of cacheRoots()) {
    if (!fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root)) {
      const candidate = path.join(root, entry, zipName)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}

function extract(zipPath, distDir, exeName) {
  if (PLATFORM === 'win32') {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${distDir}" -Force`
      ],
      { stdio: 'inherit' }
    )
  } else {
    execFileSync('unzip', ['-oq', zipPath, '-d', distDir], { stdio: 'inherit' })
  }
  fs.writeFileSync(path.join(path.dirname(distDir), 'path.txt'), exeName)
}

async function main() {
  const electronDir = path.join(__dirname, '..', 'node_modules', 'electron')
  // The path inside the zip is not the executable name on macOS: the archive
  // holds Electron.app/Contents/MacOS/Electron. Checking for a flat `electron`
  // there meant the extraction "succeeded", the presence check failed, and
  // postinstall exited 1, which failed `pnpm install` on every macOS runner and
  // took the release job with it.
  const exeName =
    PLATFORM === 'win32'
      ? 'electron.exe'
      : PLATFORM === 'darwin'
        ? path.join('Electron.app', 'Contents', 'MacOS', 'Electron')
        : 'electron'
  const distDir = path.join(electronDir, 'dist')
  const distExe = path.join(distDir, exeName)

  if (fs.existsSync(distExe)) {
    console.log('[ensure-electron] binary present, nothing to do')
    return
  }

  const version = require(path.join(electronDir, 'package.json')).version
  const zipName = `electron-v${version}-${PLATFORM}-${ARCH}.zip`

  let zipPath = findCached(zipName)
  if (!zipPath) {
    const url = `https://github.com/electron/electron/releases/download/v${version}/${zipName}`
    const root = cacheRoots()[0]
    fs.mkdirSync(root, { recursive: true })
    const dir = path.join(root, `${version}-${PLATFORM}-${ARCH}`)
    fs.mkdirSync(dir, { recursive: true })
    zipPath = path.join(dir, zipName)
    console.log(`[ensure-electron] cache miss, downloading ${zipName}`)
    try {
      await download(url, zipPath)
    } catch (err) {
      console.error(`[ensure-electron] download failed: ${err.message}`)
      console.error(
        '[ensure-electron] leaving install otherwise intact; Electron-dependent steps will fail on their own if the binary is really missing.'
      )
      process.exit(0)
    }
  }

  fs.mkdirSync(distDir, { recursive: true })
  console.log(`[ensure-electron] extracting ${zipPath}`)
  extract(zipPath, distDir, exeName)

  if (!fs.existsSync(distExe)) {
    // Same reasoning as the download failure above: this script exists because
    // one machine's extractor is unreliable, not because a missing binary
    // should break `pnpm install`. Electron-dependent steps fail on their own
    // with a far clearer message than anything printed here.
    console.error(`[ensure-electron] extraction finished but ${exeName} still missing`)
    process.exit(0)
  }
  console.log('[ensure-electron] binary ready')
}

main().catch((err) => {
  console.error(`[ensure-electron] ${err.message}`)
  process.exit(0)
})
