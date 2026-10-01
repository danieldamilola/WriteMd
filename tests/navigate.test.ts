import { describe, it, expect, vi } from 'vitest'
import {
  navigateLink,
  resolveOrCreateLink,
  type NavigateDeps
} from '../src/renderer/src/utils/navigate'
import {
  isExternalUrl,
  resolveLinkPath,
  resolveMdTarget,
  normalizePathExact
} from '../src/renderer/src/utils/links'

const SOURCE = '/home/me/vault/notes/todo.md'

type Mock = ReturnType<typeof vi.fn>

/** The parts of `NavigateDeps` a test is allowed to supply directly. */
type DepOverrides = Partial<
  Pick<NavigateDeps, 'sourcePath' | 'scrollToAnchor' | 'onMissing' | 'createMissing'>
>

interface Harness {
  deps: NavigateDeps
  openFile: Mock
  openExternal: Mock
  exists: Mock
}

function harness(
  overrides: { openFile?: Mock; openExternal?: Mock; exists?: Mock; deps?: DepOverrides } = {}
): Harness {
  const openFile = overrides.openFile ?? vi.fn(async () => {})
  const openExternal = overrides.openExternal ?? vi.fn(async () => {})
  const exists = overrides.exists ?? vi.fn(async () => true)
  const call = (m: Mock, arg: string): Promise<void> =>
    (m as unknown as (a: string) => Promise<void>)(arg)

  // `??` would turn an explicit `sourcePath: null` back into the default, so
  // presence of the key decides, not its value.
  const sourcePath =
    overrides.deps && 'sourcePath' in overrides.deps ? overrides.deps.sourcePath : SOURCE

  const deps: NavigateDeps = {
    sourcePath: sourcePath ?? null,
    openFile: (path) => call(openFile, path),
    scrollToAnchor: overrides.deps?.scrollToAnchor ?? vi.fn(),
    onMissing: overrides.deps?.onMissing ?? vi.fn(),
    createMissing: overrides.deps?.createMissing,
    getApi: () =>
      ({
        shell: { openExternal },
        file: { exists }
      }) as unknown as ReturnType<NavigateDeps['getApi']>
  }
  return { deps, openFile, openExternal, exists }
}

describe('isExternalUrl', () => {
  it('does not mistake a Windows drive letter for a scheme', () => {
    expect(isExternalUrl('C:/Users/me/notes.md')).toBe(false)
    expect(isExternalUrl('c:\\Users\\me\\notes.md')).toBe(false)
  })

  it('still recognizes real schemes', () => {
    expect(isExternalUrl('https://example.com')).toBe(true)
    expect(isExternalUrl('mailto:a@b.c')).toBe(true)
    expect(isExternalUrl('file:///etc/passwd')).toBe(true)
    expect(isExternalUrl('#anchor')).toBe(true)
  })
})

describe('resolveLinkPath', () => {
  it('resolves relative to the linking document', () => {
    expect(resolveLinkPath(SOURCE, 'other.md')).toBe('/home/me/vault/notes/other.md')
    expect(resolveLinkPath(SOURCE, '../root.md')).toBe('/home/me/vault/root.md')
  })

  it('preserves case so it can be used to open a file', () => {
    expect(resolveLinkPath(SOURCE, '../Notes/Deploy.md')).toBe('/home/me/vault/Notes/Deploy.md')
  })

  it('returns null for external and anchor targets', () => {
    expect(resolveLinkPath(SOURCE, 'https://example.com')).toBeNull()
    expect(resolveLinkPath(SOURCE, '#section')).toBeNull()
  })

  it('ignores the anchor and query when resolving', () => {
    expect(resolveLinkPath(SOURCE, 'other.md#deep')).toBe('/home/me/vault/notes/other.md')
    expect(resolveLinkPath(SOURCE, 'other.md?v=2')).toBe('/home/me/vault/notes/other.md')
  })
})

describe('resolveMdTarget', () => {
  it('case-folds for backlink comparison', () => {
    expect(resolveMdTarget(SOURCE, '../Notes/Deploy.md')).toBe('/home/me/vault/notes/deploy.md')
  })
})

describe('normalizePathExact', () => {
  it('collapses . and .. but keeps case', () => {
    expect(normalizePathExact('a/b/../c/./d.md')).toBe('a/c/d.md')
  })
})

describe('navigateLink', () => {
  it('opens an internal .md link as a document, not through the OS shell', async () => {
    const d = harness()
    const outcome = await navigateLink('other.md', d.deps)
    expect(outcome).toBe('opened-document')
    expect(d.openFile).toHaveBeenCalledWith('/home/me/vault/notes/other.md')
    expect(d.openExternal).not.toHaveBeenCalled()
  })

  it('resolves a parent-relative link', async () => {
    const d = harness()
    await navigateLink('../index.md', d.deps)
    expect(d.openFile).toHaveBeenCalledWith('/home/me/vault/index.md')
  })

  it('opens https and mailto through the shell', async () => {
    const d = harness()
    expect(await navigateLink('https://example.com', d.deps)).toBe('opened-external')
    expect(d.openExternal).toHaveBeenCalledWith('https://example.com')
    expect(d.openFile).not.toHaveBeenCalled()

    expect(await navigateLink('mailto:a@b.c', d.deps)).toBe('opened-external')
  })

  it('refuses a file: link instead of handing it to the OS', async () => {
    const d = harness()
    expect(await navigateLink('file:///etc/passwd', d.deps)).toBe('blocked')
    expect(d.openExternal).not.toHaveBeenCalled()
    expect(d.openFile).not.toHaveBeenCalled()
  })

  it('treats a bare anchor as staying in the current document', async () => {
    const d = harness()
    const outcome = await navigateLink('#my-heading', d.deps)
    expect(outcome).toBe('same-document')
    expect(d.openFile).not.toHaveBeenCalled()
  })

  it('opens the path and reports the anchor for `file.md#heading`', async () => {
    const scroll = vi.fn()
    const d = harness({ deps: { scrollToAnchor: scroll } })
    const outcome = await navigateLink('other.md#My Heading', d.deps)
    expect(outcome).toBe('opened-document')
    expect(d.openFile).toHaveBeenCalledWith('/home/me/vault/notes/other.md')
    expect(scroll).toHaveBeenCalledWith('My Heading')
  })

  it('resolves against the path of the pane the click came from', async () => {
    const d = harness({ deps: { sourcePath: '/home/me/vault/deep/nested/a.md' } })
    await navigateLink('b.md', d.deps)
    expect(d.openFile).toHaveBeenCalledWith('/home/me/vault/deep/nested/b.md')
  })

  it('reports failure instead of throwing when the read is denied', async () => {
    const d = harness({
      openFile: vi.fn(async () => {
        throw new Error('Access denied')
      })
    })
    expect(await navigateLink('secret.md', d.deps)).toBe('failed')
  })

  it('swallows a rejected openExternal rather than leaking an unhandled rejection', async () => {
    const openExternal = vi.fn(async () => {
      throw new Error('Protocol not allowed')
    })
    const d = harness({ openExternal })
    expect(await navigateLink('https://example.com', d.deps)).toBe('failed')
  })

  it('does not treat a bare filename with no source as an external url', async () => {
    const d = harness({ deps: { sourcePath: null } })
    const outcome = await navigateLink('note.md', d.deps)
    expect(outcome).toBe('opened-document')
    expect(d.openFile).toHaveBeenCalledWith('note.md')
  })
})

describe('resolveOrCreateLink', () => {
  it('returns the path when the document already exists', async () => {
    const d = harness()
    const path = await resolveOrCreateLink('new.md', d.deps)
    expect(path).toBe('/home/me/vault/notes/new.md')
  })

  it('appends .md before creating', async () => {
    const exists = vi.fn(async () => false)
    const createMissing = vi.fn(async () => {})
    const d = harness({
      exists,
      deps: { createMissing }
    })
    const path = await resolveOrCreateLink('fresh-note', d.deps)
    expect(path).toBe('/home/me/vault/notes/fresh-note.md')
    expect(createMissing).toHaveBeenCalledWith('/home/me/vault/notes/fresh-note.md')
  })

  it('reports a missing document when creation is not enabled', async () => {
    const onMissing = vi.fn()
    const d = harness({
      exists: vi.fn(async () => false),
      deps: { onMissing }
    })
    const path = await resolveOrCreateLink('gone.md', d.deps)
    expect(path).toBeNull()
    expect(onMissing).toHaveBeenCalledWith('/home/me/vault/notes/gone.md')
  })

  it('never creates anything for an external target', async () => {
    const createMissing = vi.fn(async () => {})
    const d = harness({ deps: { createMissing } })
    expect(await resolveOrCreateLink('https://example.com', d.deps)).toBeNull()
    expect(createMissing).not.toHaveBeenCalled()
  })
})
