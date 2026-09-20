import { describe, it, expect } from 'vitest'
import {
  wrapInline,
  clearFormatting,
  toggleLinePrefix,
  stripBlockMarkers,
  tableSkeleton,
  nextFootnoteNumber,
  codeFence,
  mathBlock
} from '../src/renderer/src/components/text-format'

describe('text-format helpers', () => {
  it('wraps selections with markers', () => {
    expect(wrapInline('hi', '**')).toBe('**hi**')
    expect(wrapInline('hi', '[', '](url)')).toBe('[hi](url)')
  })

  it('clears nested formatting and links', () => {
    expect(clearFormatting('**_hi_**')).toBe('hi')
    expect(clearFormatting('[hi](https://x.com)')).toBe('hi')
    expect(clearFormatting('==`code`==')).toBe('code')
    expect(clearFormatting('plain')).toBe('plain')
  })

  it('toggles line prefixes', () => {
    expect(toggleLinePrefix('Hello', '# ')).toBe('# Hello')
    expect(toggleLinePrefix('# Hello', '# ')).toBe('Hello')
    expect(toggleLinePrefix('  - item', '> ')).toBe('  > - item')
  })

  it('strips block markers back to plain text', () => {
    expect(stripBlockMarkers('## Title')).toBe('Title')
    expect(stripBlockMarkers('> quote')).toBe('quote')
    expect(stripBlockMarkers('- [x] done')).toBe('done')
    expect(stripBlockMarkers('1. first')).toBe('first')
  })

  it('builds a table skeleton', () => {
    const table = tableSkeleton(2, 2)
    expect(table).toContain('| Header | Header |')
    expect(table).toContain('| --- | --- |')
  })

  it('numbers footnotes after existing ones', () => {
    expect(nextFootnoteNumber('no notes')).toBe(1)
    expect(nextFootnoteNumber('a[^1] b[^3]')).toBe(4)
  })

  it('builds fence and math blocks', () => {
    expect(codeFence('ts')).toContain('```ts')
    expect(mathBlock()).toContain('$$')
  })
})
