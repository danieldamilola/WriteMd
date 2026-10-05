import { test, expect } from '@playwright/test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launch, firstWindow } from './fixtures'

/**
 * The vault welcome note is written by the main process at launch, into a vault
 * root that has to be created as part of that same launch.
 *
 * Only the stand-down case is reachable from here. `--user-data-dir` redirects
 * the profile, not Electron's `documents` path, so a spec that lets the app
 * resolve its default vault lands in the developer's real
 * `~/Documents/WriteMd Vault/` — the leak the shared fixture's own comment warns
 * about, and the reason a fixture here has to set `files.vaultPath` explicitly.
 * That in turn means the folder exists before launch, which is the second
 * launch, not the first. The create-and-seed path is covered in
 * `tests/welcome-note.test.ts`, which drives the seeding directly.
 */

function profileWithVault(name: string): { userData: string; vault: string } {
  const root = mkdtempSync(join(tmpdir(), `writemd-e2e-${name}-`))
  const userData = join(root, 'userdata')
  const vault = join(root, 'Notes')
  mkdirSync(vault, { recursive: true })
  mkdirSync(userData, { recursive: true })
  return { userData, vault }
}

test.describe('Vault welcome note', () => {
  test('a vault the app did not create is never seeded', async () => {
    const { userData, vault } = profileWithVault('welcome-standdown')
    // A person who already keeps notes in the folder they pointed WriteMd at.
    writeFileSync(join(vault, 'PRD.md'), '# mine\n', 'utf-8')
    writeFileSync(
      join(userData, 'config.json'),
      JSON.stringify({ files: { vaultPath: vault } }, null, 2),
      'utf-8'
    )

    const app = await launch({ args: [`--user-data-dir=${userData}`, '.'] })
    try {
      await firstWindow(app)
      expect(existsSync(join(vault, 'Welcome.md'))).toBe(false)
      // And the note that was there is untouched.
      expect(readFileSync(join(vault, 'PRD.md'), 'utf-8')).toBe('# mine\n')
      expect(readdirSync(vault)).toEqual(['PRD.md'])
    } finally {
      await app.close()
      rmSync(join(vault, '..'), { recursive: true, force: true })
    }
  })

  test('an empty vault the user pointed at is still left alone', async () => {
    // Empty is the interesting half: a directory with nothing in it looks like
    // a first run, and treating it as one would put a file in a folder somebody
    // had just emptied on purpose.
    const { userData, vault } = profileWithVault('welcome-empty')
    writeFileSync(
      join(userData, 'config.json'),
      JSON.stringify({ files: { vaultPath: vault } }, null, 2),
      'utf-8'
    )

    const app = await launch({ args: [`--user-data-dir=${userData}`, '.'] })
    try {
      await firstWindow(app)
      expect(readdirSync(vault)).toEqual([])
    } finally {
      await app.close()
      rmSync(join(vault, '..'), { recursive: true, force: true })
    }
  })
})
