import { describe, it, expect, beforeEach } from 'vitest'
import { join, sep } from 'path'
import { makeTempRoot } from './helpers/temp-root'
import {
  setVaultRootProvider,
  registerExternalPath,
  canProbePath,
  canWriteImageExtension,
  isAllowedExternalProtocol,
  resetRegisteredPaths
} from '../src/main/path-guard'

const VAULT = join(makeTempRoot('security-guard'), 'vault')

describe('file:save-image extension guard', () => {
  beforeEach(() => {
    setVaultRootProvider(() => VAULT)
    resetRegisteredPaths()
  })

  it('accepts every image extension the paste/drop path can produce', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp']) {
      expect(canWriteImageExtension(ext)).toBe(true)
    }
  })

  it('accepts a leading dot, with or without one', () => {
    expect(canWriteImageExtension('.PNG')).toBe(true)
    expect(canWriteImageExtension('PNG')).toBe(true)
  })

  it('rejects anything that is not a known image extension', () => {
    expect(canWriteImageExtension('exe')).toBe(false)
    expect(canWriteImageExtension('html')).toBe(false)
    expect(canWriteImageExtension('')).toBe(false)
  })

  // The traversal that motivated this guard: `ext` reaches the main process
  // straight from the renderer and was interpolated into a filename, so a value
  // carrying `../` segments placed the upload outside the asset folder.
  it('rejects traversal payloads smuggled through the extension', () => {
    expect(canWriteImageExtension('png/../../../../evil.exe')).toBe(false)
    expect(canWriteImageExtension('..\\..\\..\\evil.exe')).toBe(false)
    expect(canWriteImageExtension('../../../Windows/System32/drivers/etc/hosts')).toBe(false)
    expect(canWriteImageExtension('.png/../evil')).toBe(false)
  })

  it('rejects a NUL byte or separator smuggled after a valid extension', () => {
    expect(canWriteImageExtension('png\u0000.txt')).toBe(false)
    expect(canWriteImageExtension(`png${sep}..${sep}x`)).toBe(false)
  })

  it('cannot be tricked by case into passing an unknown extension', () => {
    expect(canWriteImageExtension('PNG\u0000EXE')).toBe(false)
  })
})

describe('external protocol allowlist', () => {
  it('permits the schemes a document link may legitimately use', () => {
    expect(isAllowedExternalProtocol('https://example.com')).toBe(true)
    expect(isAllowedExternalProtocol('http://example.com')).toBe(true)
    expect(isAllowedExternalProtocol('mailto:someone@example.com')).toBe(true)
  })

  it('blocks file:// and custom protocol handlers', () => {
    expect(isAllowedExternalProtocol('file:///C:/Windows/System32/calc.exe')).toBe(false)
    expect(isAllowedExternalProtocol('smb://share/payload')).toBe(false)
    expect(isAllowedExternalProtocol('vscode://file/c:/x')).toBe(false)
  })

  it('blocks script-bearing and data schemes', () => {
    expect(isAllowedExternalProtocol('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalProtocol('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('blocks anything unparseable rather than throwing', () => {
    expect(isAllowedExternalProtocol('not a url')).toBe(false)
    expect(isAllowedExternalProtocol('')).toBe(false)
  })
})

describe('canProbePath scope', () => {
  beforeEach(() => {
    setVaultRootProvider(() => VAULT)
    resetRegisteredPaths()
  })

  // The registered file has to live outside the vault, otherwise the sibling
  // is reachable through vault containment and proves nothing.
  const EXTERNAL_DIR = join(makeTempRoot('security-guard-ext'), 'external')

  it('allows probing a document sibling, which a rename target needs', () => {
    registerExternalPath(join(EXTERNAL_DIR, 'notes.md'))
    expect(canProbePath(join(EXTERNAL_DIR, 'renamed.md'))).toBe(true)
  })

  // Probing exists to check a rename target. Allowing every extension turned it
  // into a filename-existence oracle for the whole containing directory.
  it('refuses to probe non-document siblings', () => {
    registerExternalPath(join(EXTERNAL_DIR, 'notes.md'))
    expect(canProbePath(join(EXTERNAL_DIR, 'secrets.env'))).toBe(false)
    expect(canProbePath(join(EXTERNAL_DIR, 'id_rsa'))).toBe(false)
    expect(canProbePath(join(EXTERNAL_DIR, 'tool.exe'))).toBe(false)
  })

  it('still allows probing anything inside the vault', () => {
    expect(canProbePath(join(VAULT, 'anything', 'at.all'))).toBe(true)
  })
})
