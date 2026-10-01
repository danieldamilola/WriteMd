import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Per-file temp root for tests that need a real directory.
 *
 * The suite used to hardcode `C:/Temp/writemd-<name>-test`, which is
 * Windows-only (so the unit tests could not run on the ubuntu/macos legs of the
 * release workflow) and uses a fixed name per file, so two vitest workers
 * pointing at the same directory would race. `mkdtemp` gives each run a unique
 * directory, and `tmpdir()` makes it work on every platform.
 */
export function makeTempRoot(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `writemd-${name}-`))
  // Consumers expect the directory to already exist.
  mkdirSync(dir, { recursive: true })
  return dir
}

export function cleanupTempRoot(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
