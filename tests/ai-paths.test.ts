import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, symlinkSync } from 'fs'
import { join } from 'path'
import { makeTempRoot, cleanupTempRoot } from './helpers/temp-root'
import {
  resolveRealPath,
  canonicalize,
  isReservedDeviceName,
  statOrNull,
  pathKey,
  pathKeyEqual,
  UnsafePathError
} from '../src/main/ai/paths'

/**
 * There is no boundary to escape here, so these are not containment tests.
 * They cover the two things that have to be right for the undo journal to be
 * trustworthy: a path recorded must be the path the edit actually landed on,
 * and a recorded path must round-trip back to the same file.
 */

let root: string
let vault: string

beforeEach(() => {
  root = makeTempRoot('ai-paths')
  vault = join(root, 'vault')
  mkdirSync(join(vault, 'notes'), { recursive: true })
  writeFileSync(join(vault, 'notes', 'idea.md'), '# idea\n')
  writeFileSync(join(vault, 'README.md'), '# readme\n')
})

afterEach(() => {
  cleanupTempRoot(root)
})

/**
 * Symlink support is per-machine: Windows allows unprivileged directory
 * junctions always, but file symlinks only with Developer Mode. Probe each
 * separately so a skipped run says what went unverified instead of reporting
 * green.
 */
function probeSymlink(kind: 'junction' | 'file'): boolean {
  const scratch = makeTempRoot('ai-paths-probe')
  try {
    mkdirSync(join(scratch, 'target'), { recursive: true })
    writeFileSync(join(scratch, 'target', 'f.txt'), 'x')
    symlinkSync(
      kind === 'junction' ? join(scratch, 'target') : join(scratch, 'target', 'f.txt'),
      join(scratch, 'link'),
      kind
    )
    return true
  } catch {
    return false
  } finally {
    cleanupTempRoot(scratch)
  }
}

const canJunction = probeSymlink('junction')
const canFileLink = probeSymlink('file')

describe('canonicalize', () => {
  it('resolves a path that exists', () => {
    expect(canonicalize(join(vault, 'README.md'))).toBeTruthy()
  })

  it('resolves a path that does not exist, through its parent', () => {
    // This is what lets the journal record a file before it exists.
    expect(canonicalize(join(vault, 'notes', 'new.md'))).toBe(join(vault, 'notes', 'new.md'))
  })

  it('collapses a traversal that lands back where it started', () => {
    expect(canonicalize(join(vault, 'notes', '..', 'README.md'))).toBe(join(vault, 'README.md'))
  })

  it('returns null rather than guessing at a symlink loop', () => {
    // A wrong answer here points the journal at the wrong file, which is worse
    // than refusing.
    const loop = join(root, 'loop')
    try {
      symlinkSync(loop, loop, 'junction')
    } catch {
      return
    }
    expect(canonicalize(loop)).toBeNull()
  })
})

describe('symlinked paths resolve to the real file', () => {
  it.skipIf(!canFileLink)('follows a file symlink, so the journal names the target', () => {
    symlinkSync(join(vault, 'README.md'), join(vault, 'alias.md'), 'file')
    const resolved = resolveRealPath(join(vault, 'alias.md'), vault)
    // The alias would revert the wrong file if this returned the link itself.
    expect(resolved).toBe(join(vault, 'README.md'))
  })

  it.skipIf(!canJunction)('follows a directory junction', () => {
    symlinkSync(join(vault, 'notes'), join(root, 'notes-link'), 'junction')
    const resolved = resolveRealPath(join(root, 'notes-link', 'idea.md'), root)
    expect(resolved).toBe(join(vault, 'notes', 'idea.md'))
  })

  it('leaves an ordinary path alone', () => {
    expect(resolveRealPath(join(vault, 'README.md'), root)).toBe(join(vault, 'README.md'))
  })
})

describe('resolveRealPath', () => {
  it('accepts an absolute path', () => {
    expect(resolveRealPath(join(vault, 'README.md'), root)).toBe(join(vault, 'README.md'))
  })

  it('resolves a relative path against the base, not the process directory', () => {
    // An Electron main process has a working directory wherever the app was
    // launched from. Defaulting to it would silently send 'notes/idea.md' to
    // somewhere the user never pointed at.
    expect(resolveRealPath('notes/idea.md', vault)).toBe(join(vault, 'notes', 'idea.md'))
  })

  it('lets an absolute path win over the base', () => {
    expect(resolveRealPath(join(vault, 'README.md'), root)).toBe(join(vault, 'README.md'))
  })

  it('refuses an empty path', () => {
    expect(() => resolveRealPath('', root)).toThrow(UnsafePathError)
    expect(() => resolveRealPath('   ', root)).toThrow(/empty/)
  })

  it('refuses a non-string path', () => {
    expect(() => resolveRealPath(undefined as unknown as string, root)).toThrow(UnsafePathError)
  })

  it('refuses a NUL byte', () => {
    expect(() => resolveRealPath('notes/idea.md\0.png', root)).toThrow(/NUL/)
  })

  it('refuses a Windows device name', { skip: process.platform !== 'win32' }, () => {
    expect(() => resolveRealPath(join(vault, 'nul'), root)).toThrow(/device name/)
    expect(() => resolveRealPath(join(vault, 'con.md'), root)).toThrow(/device name/)
  })

  it('allows a name that merely looks like one', () => {
    expect(() => resolveRealPath(join(vault, 'console.md'), root)).not.toThrow()
    expect(() => resolveRealPath(join(vault, 'null'), root)).not.toThrow()
  })
})

describe('isReservedDeviceName', () => {
  it('catches the documented set on any stem', () => {
    for (const name of ['con', 'prn', 'aux', 'nul', 'com1', 'com9', 'lpt1', 'LPT9']) {
      expect(isReservedDeviceName(join(vault, name)), name).toBe(true)
      expect(isReservedDeviceName(join(vault, `${name}.md`)), `${name}.md`).toBe(true)
    }
  })

  it('allows ordinary names', () => {
    for (const name of ['index.ts', 'console.md', 'null', 'com10', 'lpt0', 'nule.md']) {
      expect(isReservedDeviceName(join(vault, name)), name).toBe(false)
    }
  })
})

describe('statOrNull', () => {
  it('reports a file', () => {
    expect(statOrNull(join(vault, 'README.md'))?.isFile()).toBe(true)
  })

  it('reports a directory', () => {
    expect(statOrNull(join(vault, 'notes'))?.isDirectory()).toBe(true)
  })

  it('returns null for something that is not there', () => {
    expect(statOrNull(join(vault, 'ghost.md'))).toBeNull()
  })

  it('returns null rather than throwing on a bad path', () => {
    expect(statOrNull('')).toBeNull()
  })
})

describe('pathKey', () => {
  it(
    'folds case on Windows so two spellings are one file',
    { skip: process.platform !== 'win32' },
    () => {
      const lower = pathKey('C:\\Dev\\Notes\\Idea.md')
      const upper = pathKey('C:\\DEV\\NOTES\\IDEA.MD')
      expect(lower).toBe(upper)
      expect(pathKeyEqual('C:\\Dev\\a.md', 'C:\\dev\\A.MD')).toBe(true)
    }
  )

  it('keeps case on POSIX, where it is meaningful', { skip: process.platform === 'win32' }, () => {
    expect(pathKey('/home/me/Idea.md')).not.toBe(pathKey('/home/me/idea.md'))
  })

  it('still matches an identical path on POSIX', { skip: process.platform === 'win32' }, () => {
    expect(pathKeyEqual('/home/me/a.md', '/home/me/a.md')).toBe(true)
  })
})

describe('journal round trip', () => {
  it('resolves a write target to a path that reads back the same file', () => {
    // The property the whole undo mechanism rests on: whatever a tool resolves
    // is what a later undo has to open, and it must be the same file.
    const written = resolveRealPath('notes/idea.md', vault)
    writeFileSync(written, '# changed\n')
    const readBack = resolveRealPath(join(vault, 'notes', 'idea.md'), vault)
    expect(pathKeyEqual(readBack, written)).toBe(true)
    expect(statOrNull(readBack)).not.toBeNull()
  })

  it.skipIf(!canFileLink)('round-trips through a symlink alias', () => {
    symlinkSync(join(vault, 'README.md'), join(vault, 'alias.md'), 'file')
    const written = resolveRealPath('alias.md', vault)
    expect(pathKeyEqual(written, resolveRealPath('README.md', vault))).toBe(true)
  })
})
