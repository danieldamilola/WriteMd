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

interface Harness extends NavigateDeps {
  openFile: Mock
  openExternal: Mock
  exists: Mock
}

function harness(overrides: Partial<Harness> = {}): Harness {
  const openFile = (overrides.openFile ?? vi.fn(async () => {})) as Mock
  const openExternal = (overrides.openExternal ?? vi.fn(async () => {})) as Mock
  const exists = (overrides.exists ?? vi.fn(async () => true)) as Mock
  return {
    sourcePath: SOURCE,
    openFile,
    openExternal,
    exists,
    scrollToAnchor: vi.fn(),
    onMissing: vi.fn(),
    ...overrides,
    getApi: () =>
      ({
        shell: { openExternal },
        file: { exists }
      }) as unknown as ReturnType<NavigateDeps['getApi']>
  }
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
    const d = deps()
    const outcome = await navigateLink('other.md', d)
    expect(outcome).toBe('opened-document')
    expect(d.openFile).toHaveBeenCalledWith('/home/me/vault/notes/other.md')
    expect(d.openExternal).not.toHaveBeenCalled()
  })

  it('resolves a parent-relative link', async () => {
    const d = deps()
    await navigateLink('../index.md', d)
    expect(d.openFile).toHaveBeenCalledWith('/home/me/vault/index.md')
  })

  it('opens https and mailto through the shell', async () => {
    const d = deps()
    expect(await navigateLink('https://example.com', d)).toBe('opened-external')
    expect(d.openExternal).toHaveBeenCalledWith('https://example.com')
    expect(d.openFile).not.toHaveBeenCalled()

    expect(await navigateLink('mailto:a@b.c', d)).toBe('opened-external')
  })

  it('refuses a file: link instead of handing it to the OS', async () => {
    const d = deps()
    expect(await navigateLink('file:///etc/passwd', d)).toBe('blocked')
    expect(d.openExternal).not.toHaveBeenCalled()
    expect(d.openFile).not.toHaveBeenCalled()
  })

  it('treats a bare anchor as staying in the current document', async () => {
    const d = deps()
    const outcome = await navigateLink('#my-heading', d)
    expect(outcome).toBe('same-document')
    expect(d.openFile).not.toHaveBeenCalled()
  })

  it('opens the path and reports the anchor for `file.md#heading`', async () => {
    const scroll = vi.fn()
    const d = deps({ scrollToAnchor: scroll })
    const outcome = await navigateLink('other.md#My Heading', d)
    expect(outcome).toBe('opened-document')
    expect(d.openFile).toHaveBeenCalledWith('/home/me/vault/notes/other.md')
    expect(scroll).toHaveBeenCalledWith('My Heading')
  })

  it('resolves against the path of the pane the click came from', async () => {
    const d = deps({ sourcePath: '/home/me/vault/deep/nested/a.md' })
    await navigateLink('b.md', d)
    expect(d.openFile).toHaveBeenCalledWith('/home/me/vault/deep/nested/b.md')
  })

  it('reports failure instead of throwing when the read is denied', async () => {
    const d = deps({
      openFile: vi.fn(async () => {
        throw new Error('Access denied')
      })
    })
    expect(await navigateLink('secret.md', d)).toBe('failed')
  })

  it('swallows a rejected openExternal rather than leaking an unhandled rejection', async () => {
    const openExternal = vi.fn(async () => {
      throw new Error('Protocol not allowed')
    })
    const d = deps()
    d.getApi = () =>
      ({ shell: { openExternal }, file: { exists: vi.fn() } }) as unknown as ReturnType<
        NavigateDeps['getApi']
      >
    expect(await navigateLink('https://example.com', d)).toBe('failed')
  })

  it('does not treat a bare filename with no source as an external url', async () => {
    const d = deps({ sourcePath: null })
    const outcome = await navigateLink('note.md', d)
    expect(outcome).toBe('opened-document')
    expect(d.openFile).toHaveBeenCalledWith('note.md')
  })
})

describe('resolveOrCreateLink', () => {
  it('returns the path when the document already exists', async () => {
    const d = deps()
    const path = await resolveOrCreateLink('new.md', d)
    expect(path).toBe('/home/me/vault/notes/new.md')
  })

  it('appends .md before creating', async () => {
    const exists = vi.fn(async () => false)
    const createMissing = vi.fn(async () => {})
    const d = deps({ exists, createMissing })
    const path = await resolveOrCreateLink('fresh-note', d)
    expect(path).toBe('/home/me/vault/notes/fresh-note.md')
    expect(createMissing).toHaveBeenCalledWith('/home/me/vault/notes/fresh-note.md')
  })

  it('reports a missing document when creation is not enabled', async () => {
    const onMissing = vi.fn()
    const d = deps({ exists: vi.fn(async () => false), onMissing })
    const path = await resolveOrCreateLink('gone.md', d)
    expect(path).toBeNull()
    expect(onMissing).toHaveBeenCalledWith('/home/me/vault/notes/gone.md')
  })

  it('never creates anything for an external target', async () => {
    const createMissing = vi.fn(async () => {})
    const d = deps({ createMissing })
    expect(await resolveOrCreateLink('https://example.com', d)).toBeNull()
    expect(createMissing).not.toHaveBeenCalled()
  })
})
