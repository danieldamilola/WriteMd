import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

/**
 * The e2e specs launch Electron against `out/main/index.js` (package.json's
 * "main"). Nothing built that bundle before the specs ran, so a fresh clone ran
 * them against a missing file.
 */
export default function globalSetup(): void {
  const mainBundle = join(process.cwd(), 'out', 'main', 'index.js')
  const preloadBundle = join(process.cwd(), 'out', 'preload', 'index.js')
  const rendererBundle = join(process.cwd(), 'out', 'renderer', 'index.html')

  const missing = [mainBundle, preloadBundle, rendererBundle].filter((p) => !existsSync(p))
  if (missing.length === 0) return

  // ELECTRON_RUN_AS_NODE=1 in the shell makes any Electron launch fail with
  // "bad option: --remote-debugging-port=0".
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: undefined }
  execFileSync('npm', ['run', 'build'], { stdio: 'inherit', env })
}
