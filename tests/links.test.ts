import { describe, expect, it } from 'vitest'
import {
  backlinkSnippet,
  basenameNoExt,
  cleanWikiTarget,
  extractLinks,
  isWebUrl,
  linksToFile,
  normalizeExternalUrl,
  normalizePath,
  resolveMdTarget
} from '../src/renderer/src/utils/links'

describe('link utils', () => {
  it('extracts wiki and markdown links', () => {
    const { wiki, md } = extractLinks(
      'See [[note]] and [[a|Alias]] plus [t](./x.md) ![i](img.png).'
    )
    expect(wiki).toEqual(['note', 'a|Alias'])
    expect(md).toEqual(['./x.md', 'img.png'])
  })

  it('cleans wiki aliases and headings', () => {
    expect(cleanWikiTarget('note|alias')).toBe('note')
    expect(cleanWikiTarget('note#heading')).toBe('note')
    expect(cleanWikiTarget('a#b|c')).toBe('a')
  })

  it('matches wiki-links by stem across folders', () => {
    expect(
      linksToFile('/vault/a.md', 'See [[Target Note]] here.', '/other/deep/Target Note.md')
    ).toBe(true)
    expect(linksToFile('/vault/a.md', 'See [[target note|alias]] here.', '/TARGET NOTE.md')).toBe(
      true
    )
    expect(linksToFile('/vault/a.md', 'See [[other]] here.', '/vault/target.md')).toBe(false)
  })

  it('resolves relative markdown links across folders', () => {
    expect(linksToFile('/docs/a.md', 'See [t](../shared/target.md).', '/shared/target.md')).toBe(
      true
    )
    expect(linksToFile('/docs/a.md', 'See [t](./target.md).', '/docs/target.md')).toBe(true)
    expect(linksToFile('/docs/a.md', 'See [t](./other.md).', '/docs/target.md')).toBe(false)
  })

  it('ignores external urls and anchors', () => {
    expect(resolveMdTarget('/a.md', 'https://example.com')).toBeNull()
    expect(resolveMdTarget('/a.md', '#section')).toBeNull()
    expect(linksToFile('/a.md', '[t](https://example.com) [[x]](y)', '/a.md')).toBe(false)
  })

  it('normalizes windows separators and dot segments', () => {
    expect(normalizePath('C:\\Docs\\..\\Docs\\A.MD')).toBe('c:/docs/a.md')
    expect(basenameNoExt('C:\\Docs\\note.md')).toBe('note')
  })

  it('returns the linking line as snippet', () => {
    const content = 'First line.\nSee [[target]] for details.\nLast.'
    expect(backlinkSnippet(content, '/a.md', '/v/target.md')).toBe('See [[target]] for details.')
    expect(backlinkSnippet('Nothing here.', '/a.md', '/v/target.md')).toBe('')
  })

  it('recognizes website urls with or without scheme', () => {
    expect(isWebUrl('https://example.com/page')).toBe(true)
    expect(isWebUrl('example.com')).toBe(true)
    expect(isWebUrl('not a url')).toBe(false)
    expect(isWebUrl('./local.md')).toBe(false)
    expect(isWebUrl('[[note]]')).toBe(false)
    expect(normalizeExternalUrl('example.com')).toBe('https://example.com')
    expect(normalizeExternalUrl('https://example.com')).toBe('https://example.com')
  })
})
