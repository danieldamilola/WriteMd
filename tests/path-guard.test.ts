import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'path'
import {
  setVaultRootProvider,
  registerExternalPath,
  registerExternalPaths,
  canAccessPath,
  canProbePath,
  canRenamePath,
  isSubpath,
  normalizePath,
  assertCanAccess
} from '../src/main/path-guard'

const VAULT = 'C:\\Temp\\writemd-guard-test\\vault'
const EXTERNAL = 'C:\\Temp\\writemd-guard-test\\external\\notes.md'

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
    expect(canAccessPath('C:\\Windows\\system32\\config')).toBe(false)
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

  it('is case-insensitive on matching', () => {
    registerExternalPath(EXTERNAL.toUpperCase())
    expect(canAccessPath(EXTERNAL.toLowerCase())).toBe(true)
  })

  it('probing allows siblings of registered files', () => {
    registerExternalPath(EXTERNAL)
    expect(canProbePath(join(EXTERNAL, '..', 'other.md'))).toBe(true)
    expect(canProbePath('C:\\Windows\\system32')).toBe(false)
  })

  it('rename allowed within same directory only', () => {
    registerExternalPath(EXTERNAL)
    expect(canRenamePath(EXTERNAL, join(EXTERNAL, '..', 'renamed.md'))).toBe(true)
    expect(canRenamePath(EXTERNAL, join(VAULT, 'elsewhere.md'))).toBe(false)
    expect(canRenamePath('C:\\Windows\\x.md', join('C:\\Windows\\y.md'))).toBe(false)
  })

  it('isSubpath handles exact match and prevents prefix traps', () => {
    expect(isSubpath(join(VAULT, 'a.md'), VAULT)).toBe(true)
    expect(isSubpath(VAULT, VAULT)).toBe(true)
    // A sibling whose name merely shares the prefix must not pass.
    expect(isSubpath(VAULT + '-evil\\x.md', VAULT)).toBe(false)
  })

  it('assertCanAccess throws for denied paths', () => {
    expect(() => assertCanAccess('D:\\random.md')).toThrow(/Access denied/)
  })

  it('normalizes and rejects empty/relative paths', () => {
    expect(normalizePath('C:\\a\\b\\..\\c.md')).toBe('c:\\a\\c.md')
    expect(canAccessPath('')).toBe(false)
    expect(canAccessPath('relative.md')).toBe(false)
  })

  it('restricts shell opens to documents and images', async () => {
    const { canOpenWithShell } = await import('../src/main/path-guard')
    expect(canOpenWithShell('C:\\docs\\note.md')).toBe(true)
    expect(canOpenWithShell('C:\\docs\\pic.PNG')).toBe(true)
    expect(canOpenWithShell('C:\\docs\\report.pdf')).toBe(true)
    expect(canOpenWithShell('C:\\docs\\setup.exe')).toBe(false)
    expect(canOpenWithShell('C:\\docs\\script.bat')).toBe(false)
    expect(canOpenWithShell('C:\\docs\\script.ps1')).toBe(false)
    expect(canOpenWithShell('C:\\docs\\archive.zip')).toBe(false)
  })
})
