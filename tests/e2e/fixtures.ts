import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

/**
 * A throwaway vault and userData dir per spec file.
 *
 * Both existing specs used to `electron.launch({ args: ['.'] })`, which starts
 * the app against the developer's real profile. `find.spec.ts` then pressed
 * Ctrl+N and typed, and with autoSave on by default that wrote a file into
 * ~/Documents/WriteMd Vault/. Both also branched on `if (await welcome
 * .isVisible())`, so which code path ran depended on whatever tabs the last run
 * left persisted.
 */
export function makeFixture(
  name: string,
  files?: string[]
): {
  vault: string
  userData: string
  args: string[]
  cleanup: () => void
} {
  const root = join(tmpdir(), `writemd-e2e-${name}-${process.pid}-${Date.now()}`)
  const vault = join(root, 'vault')
  const userData = join(root, 'userdata')
  mkdirSync(vault, { recursive: true })
  mkdirSync(userData, { recursive: true })
  // A vault with notes in it, so the welcome screen has something to show and
  // restoreTabs has real files to restore. `files` overrides the set for specs
  // that need specific names or enough tabs to overflow the strip.
  const notes = files ?? [
    'PRD.md',
    'README.md',
    'CHANGELOG.md',
    'roadmap-notes.md',
    'design-notes.md'
  ]
  for (const n of notes) {
    writeFileSync(join(vault, n), `# ${n}\n\nE2E fixture.\n`, 'utf-8')
  }
  // Point the app at the fixture vault. Without this it falls back to
  // ~/Documents/WriteMd Vault, which is exactly the leak these specs had.
  // openTabs seeds the editor, because `writemd-top-bar` only exists once a
  // document is open; the welcome screen renders its own top bar.
  writeFileSync(
    join(userData, 'config.json'),
    JSON.stringify(
      {
        files: {
          vaultPath: vault,
          recentFiles: notes.map((n) => join(vault, n)),
          openTabs: [join(vault, 'README.md')],
          activeTabPath: join(vault, 'README.md')
        },
        appearance: { theme: 'dark', panelOrientation: 'horizontal' }
      },
      null,
      2
    ),
    'utf-8'
  )
  return {
    vault,
    userData,
    // Flag before the app path: Electron only treats leading arguments as
    // switches.
    args: [`--user-data-dir=${userData}`, '.'],
    cleanup: () => {
      /* leave the temp dir to the OS; the name is unique per run */
    }
  }
}

/** process.env minus ELECTRON_RUN_AS_NODE, plus any extra vars. */
export function launchEnv(extra: Record<string, string> = {}): Record<string, string> {
  // ELECTRON_RUN_AS_NODE=1 in the shell makes every launch fail with
  // "bad option: --remote-debugging-port=0". Clear it so the spec does not
  // depend on the caller's environment.
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v
  }
  return { ...env, ...extra }
}

export async function launch(fixture: { args: string[] }): Promise<ElectronApplication> {
  return electron.launch({ args: fixture.args, env: launchEnv() })
}

export async function firstWindow(app: ElectronApplication): Promise<Page> {
  const window = await app.firstWindow()
  if (!window) throw new Error('No app window opened')
  await window.waitForLoadState('domcontentloaded')
  return window
}
