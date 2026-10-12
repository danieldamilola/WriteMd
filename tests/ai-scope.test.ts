import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from 'fs'
import { join } from 'path'
import { makeTempRoot, cleanupTempRoot } from './helpers/temp-root'
import {
  createScope,
  resolveInScope,
  relativeToScope,
  isScopeRoot,
  isReservedSystemPath,
  ScopeError
} from '../src/main/ai/scope'

/**
 * The scope guard is the only thing between a hijacked instruction and the
 * user's disk, so these cases are written as attacks rather than as API tests.
 * A guard that is only ever exercised with well-formed input is a guard that
 * has not been tested.
 */

let root: string
let project: string
let outside: string

beforeEach(() => {
  root = makeTempRoot('ai-scope')
  project = join(root, 'project')
  outside = join(root, 'elsewhere')
  mkdirSync(join(project, 'src'), { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(project, 'src', 'index.ts'), 'export const a = 1\n')
  writeFileSync(join(project, 'notes.md'), '# hi\n')
  writeFileSync(join(outside, 'secret.txt'), 'do not touch\n')
})

afterEach(() => {
  cleanupTempRoot(root)
})

/**
 * Symlink support is per-machine, not per-platform: Windows allows unprivileged
 * directory junctions always, but file symlinks only with Developer Mode. A
 * `process.platform` check would skip the escape cases on exactly the machine
 * most likely to ship the bug, and a single all-or-nothing probe would skip
 * them everywhere. Probe each capability separately, in a throwaway temp dir, so
 * a skipped run names precisely what went unverified.
 */
function probeSymlink(kind: 'junction' | 'file'): boolean {
  const scratch = makeTempRoot('ai-scope-probe')
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

for (const [label, capable] of [
  ['directory junction', canJunction],
  ['file symlink', canFileLink]
] as const) {
  if (!capable) {
    console.warn(
      `ai-scope: ${label} cases SKIPPED - this machine cannot create them unprivileged\n` +
        '(Windows: enable Developer Mode, or run on Linux CI). That escape guard is\n' +
        'UNVERIFIED in this run.'
    )
  }
}

describe('creating a scope', () => {
  it('accepts an existing directory', () => {
    expect(createScope(project).realRoot).toBeTruthy()
  })

  it('refuses a root that does not exist', () => {
    expect(() => createScope(join(root, 'nope'))).toThrow(ScopeError)
  })

  it('refuses a relative root', () => {
    expect(() => createScope('project')).toThrow(/not-absolute-root/)
  })

  it('refuses a file as a root', () => {
    // A file root means every read resolves to the file and every write fails
    // with ENOTDIR, which reads to the user as a permissions problem.
    expect(() => createScope(join(project, 'notes.md'))).toThrow(/not-a-directory/)
  })

  it('does not widen to the parent when the root does not exist', () => {
    // The reason createScope stats the root. `canonicalize` walks up to the
    // nearest existing ancestor, which is right for a new file and a silent
    // privilege escalation for a mistyped root: the scope would become the
    // parent directory and the agent could write anywhere in it.
    expect(() => createScope(join(project, 'typo', 'deeper'))).toThrow(/not-found/)
  })
})

describe('resolving inside the scope', () => {
  it('resolves a relative path against the root', () => {
    const scope = createScope(project)
    expect(resolveInScope(scope, 'src/index.ts', { mustExist: true })).toContain('index.ts')
  })

  it('accepts an absolute path that is inside', () => {
    const scope = createScope(project)
    const absolute = join(project, 'notes.md')
    expect(resolveInScope(scope, absolute, { mustExist: true })).toBe(absolute)
  })

  it('allows a path that does not exist yet, for a write', () => {
    const scope = createScope(project)
    const target = resolveInScope(scope, 'src/new-file.ts')
    expect(target).toBe(join(project, 'src', 'new-file.ts'))
  })

  it('reports a missing file when existence is required', () => {
    const scope = createScope(project)
    expect(() => resolveInScope(scope, 'ghost.ts', { mustExist: true })).toThrow(/not-found/)
  })

  it('normalises a traversal that lands back inside', () => {
    // `..` out and back in is not an attack, it is a clumsy path. Refusing it
    // would only teach the model to reformat, and the result is still checked.
    const scope = createScope(project)
    const resolved = resolveInScope(scope, 'src/../notes.md', { mustExist: true })
    expect(resolved).toBe(join(project, 'notes.md'))
  })
})

describe('refusing what is outside the scope', () => {
  it('refuses a sibling directory', () => {
    const scope = createScope(project)
    expect(() => resolveInScope(scope, join(outside, 'secret.txt'))).toThrow(/outside/)
  })

  it('refuses a parent traversal', () => {
    const scope = createScope(project)
    expect(() => resolveInScope(scope, '../elsewhere/secret.txt')).toThrow(/outside/)
  })

  it('refuses a deep traversal that cancels out to outside', () => {
    const scope = createScope(project)
    expect(() => resolveInScope(scope, 'src/../../elsewhere/secret.txt')).toThrow(/outside/)
  })

  it('refuses an absolute path outside', () => {
    const scope = createScope(project)
    expect(() => resolveInScope(scope, join(outside, 'secret.txt'))).toThrow(/outside/)
  })

  it(
    'refuses an absolute path outside on a different drive',
    { skip: process.platform !== 'win32' },
    () => {
      const scope = createScope(project)
      expect(() => resolveInScope(scope, 'D:\\somewhere\\else.txt')).toThrow(ScopeError)
    }
  )

  it('refuses a NUL byte, which truncates the path at the syscall', () => {
    const scope = createScope(project)
    expect(() => resolveInScope(scope, 'notes.md\0.txt')).toThrow(/nul/)
  })

  it('refuses an empty path', () => {
    const scope = createScope(project)
    expect(() => resolveInScope(scope, '   ')).toThrow(/empty/)
  })

  it('refuses a non-string path', () => {
    const scope = createScope(project)
    expect(() => resolveInScope(scope, undefined as unknown as string)).toThrow(/empty/)
  })

  it('does not treat a same-prefix sibling as inside', () => {
    // The classic `startsWith` bug: `project-evil` must not pass as `project`.
    const lookalike = `${project}-evil`
    mkdirSync(lookalike, { recursive: true })
    writeFileSync(join(lookalike, 'loot.txt'), 'nope\n')
    const scope = createScope(project)
    expect(() => resolveInScope(scope, join(lookalike, 'loot.txt'))).toThrow(/outside/)
  })
})

describe('symlinks out of the scope', () => {
  it.skipIf(!canJunction)('refuses to follow a directory junction out of the scope', () => {
    // The reason the guard canonicalizes instead of resolving textually.
    // `escape/secret.txt` is lexically inside the project; where it points is
    // not, and a `resolve()`-based check waves it straight through.
    symlinkSync(outside, join(project, 'escape'), 'junction')
    const scope = createScope(project)
    expect(() => resolveInScope(scope, join('escape', 'secret.txt'), { mustExist: true })).toThrow(
      /outside/
    )
  })

  it.skipIf(!canFileLink)('refuses a file symlink that points out', () => {
    symlinkSync(join(outside, 'secret.txt'), join(project, 'alias.txt'), 'file')
    const scope = createScope(project)
    expect(() => resolveInScope(scope, 'alias.txt', { mustExist: true })).toThrow(/outside/)
  })

  it.skipIf(!canFileLink)('allows a file symlink that stays inside', () => {
    symlinkSync(join(project, 'notes.md'), join(project, 'alias.md'), 'file')
    const scope = createScope(project)
    expect(resolveInScope(scope, 'alias.md', { mustExist: true })).toBeTruthy()
  })

  it('guards a new file by the real path of the directory that will hold it', () => {
    const scope = createScope(project)
    expect(resolveInScope(scope, 'src/created-later.ts')).toBe(
      join(project, 'src', 'created-later.ts')
    )
  })
})

describe('the guard on a machine that cannot make symlinks', () => {
  it('still refuses a lexical traversal, which needs no symlink support', () => {
    // The fallback assurance on a machine where the symlink cases are skipped:
    // textual traversal is the other half of the problem and is testable
    // everywhere, so a skipped run still proves the guard does something.
    const scope = createScope(project)
    expect(() => resolveInScope(scope, '../elsewhere/secret.txt')).toThrow(/outside/)
  })
})

describe('the root itself', () => {
  it('is readable when the caller allows it', () => {
    const scope = createScope(project)
    expect(resolveInScope(scope, '.', { allowRoot: true, mustBeDirectory: true })).toBeTruthy()
  })

  it('is refused for writes, because deleting or writing "." is never the intent', () => {
    const scope = createScope(project)
    expect(() => resolveInScope(scope, '.')).toThrow(/is-root/)
    expect(() => resolveInScope(scope, project)).toThrow(/is-root/)
  })

  it('is recognised by isScopeRoot', () => {
    const scope = createScope(project)
    expect(isScopeRoot(scope, '.')).toBe(true)
    expect(isScopeRoot(scope, 'src')).toBe(false)
  })
})

describe('relativeToScope', () => {
  it('gives a path relative to the root for display', () => {
    const scope = createScope(project)
    expect(relativeToScope(scope, join(project, 'src', 'index.ts'))).toBe(join('src', 'index.ts'))
  })

  it('names the root itself', () => {
    const scope = createScope(project)
    expect(relativeToScope(scope, project)).toBe('.')
  })
})

describe('reserved device names', () => {
  it('refuses Windows device names', { skip: process.platform !== 'win32' }, () => {
    expect(isReservedSystemPath(join(project, 'nul'))).toBe(true)
    expect(isReservedSystemPath(join(project, 'con.md'))).toBe(true)
    expect(isReservedSystemPath(join(project, 'COM1.txt'))).toBe(true)
  })

  it('allows ordinary names', () => {
    expect(isReservedSystemPath(join(project, 'null'))).toBe(false)
    expect(isReservedSystemPath(join(project, 'console.md'))).toBe(false)
    expect(isReservedSystemPath(join(project, 'index.ts'))).toBe(false)
  })
})

describe('cleanup', () => {
  it('leaves nothing behind in the fixture', () => {
    // Guards the test harness itself: a guard test that leaks a symlink makes
    // the next run fail for reasons that look like a guard bug.
    const scope = createScope(project)
    expect(() => resolveInScope(scope, join(outside, 'secret.txt'))).toThrow()
    rmSync(join(project, 'escape'), { force: true })
  })
})
