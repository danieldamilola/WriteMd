import { describe, expect, it } from 'vitest'
import { countStats } from '../src/renderer/src/components/InfoPill'

/**
 * The word count used to be `text.trim().split(/\s+/).length`, evaluated inside
 * render on a document that changes on every keystroke. It cost 350ms per
 * keystroke on a 6 MB note and allocated an array of a million strings. These
 * cases pin the replacement to the same answers without the cost.
 */
describe('countStats', () => {
  it('matches the old split-based count', () => {
    const cases = [
      '',
      '   ',
      'one',
      'one two three',
      '  leading and trailing  ',
      'line one\nline two\n',
      'tabs\tand\nnewlines\r\n',
      'a'.repeat(10_000),
      Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ')
    ]
    for (const text of cases) {
      const trimmed = text.trim()
      const expected = trimmed ? trimmed.split(/\s+/).length : 0
      expect(countStats(text).words, JSON.stringify(text.slice(0, 20))).toBe(expected)
      expect(countStats(text).chars).toBe(text.length)
    }
  })

  it('treats every kind of whitespace JS \\s matches as a separator', () => {
    // The exact set the old regex used: space, \t \n \v \f \r, NBSP, Ogham,
    // en/em spaces, line/paragraph separators, narrow NBSP, medium math space,
    // ideographic space, BOM.
    const seps = [
      ' ',
      '\t',
      '\n',
      '\u000b',
      '\u000c',
      '\r',
      '\u00a0',
      '\u1680',
      '\u2000',
      '\u2001',
      '\u2002',
      '\u2003',
      '\u2004',
      '\u2005',
      '\u2006',
      '\u2007',
      '\u2008',
      '\u2009',
      '\u200a',
      '\u2028',
      '\u2029',
      '\u202f',
      '\u205f',
      '\u3000',
      '\ufeff'
    ]
    // Each separator must split a two-letter word in half.
    for (const sep of seps) {
      expect(countStats(`a${sep}b`).words, `sep ${sep.charCodeAt(0)}`).toBe(2)
    }
    // Runs of separators collapse, they do not invent empty words.
    expect(countStats(`x${seps.join('')}y`).words).toBe(2)
    expect(countStats(`a${seps.join('')}b`).words).toBe(2)
  })

  it('does not split on non-breaking characters', () => {
    expect(countStats('a\u0301b').words).toBe(1)
    expect(countStats('\u00e9\u00e8\u00ea').words).toBe(1)
    expect(countStats('\ud83d\ude00\ud83d\ude01').words).toBe(1)
  })

  it('stays linear on a megabyte of text', () => {
    const text = 'lorem ipsum dolor sit amet '.repeat(40_000)
    const started = performance.now()
    const { words } = countStats(text)
    const ms = performance.now() - started
    expect(words).toBe(200_000)
    // The split-based version needed 350ms for 6 MB, so ~60ms for this. The
    // budget is loose because CI machines are slow; it still fails loudly if
    // someone reintroduces an allocation per word.
    expect(ms, `counting ${text.length} chars took ${ms.toFixed(1)}ms`).toBeLessThan(120)
  })
})