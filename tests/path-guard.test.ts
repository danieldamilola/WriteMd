import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'path'
import { makeTempRoot } from './helpers/temp-root'
import {
  setVaultRootProvider,
  registerExternalPath,
  registerExternalPaths,
  canAccessPath,
  canProbePath,
  canRenamePath,
  isSaneVaultRoot,
  canWriteDocument,
  isSubpath,
  normalizePath,
  assertCanAccess
} from '../src/main/path-guard'

// mkdtemp per run, not a fixed C:/Temp name: the old constant was
// Windows-only and two workers would have shared one directory.
const ROOT = makeTempRoot('guard')
const VAULT = join(ROOT, 'vault')
const EXTERNAL = join(ROOT, 'external', 'notes.md')

describe('path-guard', () => {
  beforeEach(() => {
    setVaultRootProvider(() => VAULT)
  })

  it('allows anything inside the vault root, including new files', () => {
    expect(canAccessPath(join(VAULT, 'note.md'))).toBe(true)
    expect(canAccessPath(join(VAULT, 'sub', 'dir', 'note.md'))).toBe(true)
    expect(canAccessPath(VAULT)).toBe(true)
  })

  it('denies paths outside the vault before registration', () => {
    expect(canAccessPath(EXTERNAL)).toBe(false)
    expect(canAccessPath(join(ROOT, 'elsewhere', 'config'))).toBe(false)
  })

  it('allows external paths after dialog/open registration', () => {
    registerExternalPath(EXTERNAL)
    expect(canAccessPath(EXTERNAL)).toBe(true)
  })

  it('registers lists and skips nulls and relative paths', () => {
    registerExternalPaths([null, undefined, 'relative/path.md', EXTERNAL])
    expect(canAccessPath(EXTERNAL)).toBe(true)
    expect(canAccessPath('relative/path.md')).toBe(false)
  })

  it('rejects traversal attempts via normalization', () => {
    // resolve() collapses the traversal, so the result simply lands outside
    // the vault and outside the registry.
    const sneaky = join(VAULT, '..', '..', 'elsewhere.md')
    expect(canAccessPath(sneaky)).toBe(false)
  })

  it('is case-insensitive on Windows only, where the filesystem is', () => {
    // normalizePath() lowercases on win32 and nowhere else, because on a
    // case-sensitive filesystem Notes.md and notes.md are different files and
    // folding them would let a registered path authorise a different one. The
    // old assertion ran on both, so the ubuntu CI leg failed here.
    registerExternalPath(EXTERNAL.toUpperCase())
    const lower = EXTERNAL.toLowerCase()
    if (process.platform === 'win32') {
      expect(canAccessPath(lower)).toBe(true)
    } else {
      expect(canAccessPath(lower)).toBe(canAccessPath(EXTERNAL))
    }
  })

  it('probing allows siblings of registered files', () => {
    registerExternalPath(EXTERNAL)
    expect(canProbePath(join(EXTERNAL, '..', 'other.md'))).toBe(true)
    expect(canProbePath(join(ROOT, 'elsewhere'))).toBe(false)
  })

  it('rename allowed within same directory only', () => {
    registerExternalPath(EXTERNAL)
    expect(canRenamePath(EXTERNAL, join(EXTERNAL, '..', 'renamed.md'))).toBe(true)
    expect(canRenamePath(EXTERNAL, join(VAULT, 'elsewhere.md'))).toBe(false)
    expect(canRenamePath(join(ROOT, 'a.md'), join(ROOT, 'b.md'))).toBe(false)
  })

  it('refuses to rename a note into an executable extension', () => {
    // Same directory passes the containment check, so without the extension
    // gate a .md could be renamed in place to .bat.
    const note = join(VAULT, 'note.md')
    expect(canRenamePath(note, join(VAULT, 'note.bat'))).toBe(false)
    expect(canRenamePath(note, join(VAULT, 'note.ps1'))).toBe(false)
    expect(canRenamePath(note, join(VAULT, 'renamed.md'))).toBe(true)
  })

  it('write targets are limited to document and image extensions', () => {
    expect(canWriteDocument(join(VAULT, 'note.md'))).toBe(true)
    expect(canWriteDocument(join(VAULT, 'note.markdown'))).toBe(true)
    expect(canWriteDocument(join(VAULT, 'pic.png'))).toBe(true)
    expect(canWriteDocument(join(VAULT, 'evil.bat'))).toBe(false)
    expect(canWriteDocument(join(VAULT, 'evil.ps1'))).toBe(false)
    expect(canWriteDocument(join(VAULT, 'evil.html'))).toBe(false)
    expect(canWriteDocument(join(VAULT, 'evil.vbs'))).toBe(false)
  })

  it('rejects vault roots that would grant blanket filesystem access', () => {
    // A vault at a drive or filesystem root makes isPathInVault true for
    // essentially everything, which voids every other guard.
    expect(isSaneVaultRoot('/')).toBe(false)
    expect(isSaneVaultRoot('C:\\')).toBe(false)
    expect(isSaneVaultRoot('relative/path')).toBe(false)
    expect(isSaneVaultRoot('')).toBe(false)
    expect(isSaneVaultRoot(VAULT)).toBe(true)
    expect(isSaneVaultRoot(EXTERNAL)).toBe(true)
  })

  it('isSubpath handles exact match and prevents prefix traps', () => {
    expect(isSubpath(join(VAULT, 'a.md'), VAULT)).toBe(true)
    expect(isSubpath(VAULT, VAULT)).toBe(true)
    // A sibling whose name merely shares the prefix must not pass.
    expect(isSubpath(VAULT + '-evil\\x.md', VAULT)).toBe(false)
  })

  it('assertCanAccess throws for denied paths', () => {
    expect(() => assertCanAccess(join(ROOT, 'elsewhere', 'random.md'))).toThrow(/Access denied/)
  })

  it('normalizes and rejects empty/relative paths', () => {
    expect(normalizePath(join(ROOT, 'a', 'b', '..', 'c.md'))).toBe(
      normalizePath(join(ROOT, 'a', 'c.md'))
    )
    expect(canAccessPath('')).toBe(false)
    expect(canAccessPath('relative.md')).toBe(false)
  })

  it('restricts shell opens to documents and images', async () => {
    const { canOpenWithShell } = await import('../src/main/path-guard')
    const docs = join(ROOT, 'docs')
    expect(canOpenWithShell(join(docs, 'note.md'))).toBe(true)
    expect(canOpenWithShell(join(docs, 'pic.PNG'))).toBe(true)
    expect(canOpenWithShell(join(docs, 'report.pdf'))).toBe(true)
    expect(canOpenWithShell(join(docs, 'setup.exe'))).toBe(false)
    expect(canOpenWithShell(join(docs, 'script.bat'))).toBe(false)
    expect(canOpenWithShell(join(docs, 'script.ps1'))).toBe(false)
    expect(canOpenWithShell(join(docs, 'archive.zip'))).toBe(false)
  })
})
