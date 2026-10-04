import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { mathPlugin } from '../src/renderer/src/components/extensions/math-plugin'
import {
  wikiLinkPlugin,
  wikiLinkScanRange
} from '../src/renderer/src/components/extensions/wiki-link-plugin'
import { frontmatterPlugin } from '../src/renderer/src/components/extensions/frontmatter-plugin'

/**
 * These three plugins used to stringify the entire document on every
 * transaction, which cost tens of milliseconds per keystroke on a large note
 * and produced the garbage that came with it. They now look at a bounded
 * window. These cases pin the windowing: nothing off-screen may change what is
 * rendered near the viewport, and nothing near it may be dropped.
 */
function view(doc: string, extensions: never[]): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  return new EditorView({
    state: EditorState.create({ doc, extensions: extensions as never }),
    parent
  })
}

describe('math decorations', () => {
  it('renders block and inline math', () => {
    const v = view('Intro\n\n$$\nx^2\n$$\n\nand $y$ inline\n', [mathPlugin] as never)
    const marks = v.state.field(mathPlugin as never) as unknown as { size: number }
    expect(marks.size).toBe(2)
    v.destroy()
  })

  it('ignores inline math that belongs to a block', () => {
    // Cursor sits on line 1, outside the block, so the block is rendered rather
    // than shown as source.
    const v = view('lead in\n\n$$\n$x$\n$$\n', [mathPlugin] as never)
    const marks = v.state.field(mathPlugin as never) as unknown as { size: number }
    expect(marks.size).toBe(1)
    v.destroy()
  })

  it('finds math at the far end of a large document', () => {
    // 400 KB of filler, then math. The scan window is 20 KB around the
    // viewport, so this only renders if the whole-document pass still happens
    // for a document this size.
    const filler = 'plain text line\n'.repeat(28_000)
    const v = view(`${filler}$$\nz^2\n$$\n`, [mathPlugin] as never)
    const marks = v.state.field(mathPlugin as never) as unknown as { size: number }
    expect(marks.size).toBe(1)
    v.destroy()
  })
})

describe('wiki link decorations', () => {
  it('renders a link near the viewport', () => {
    const v = view('see [[Some Note]] here\n', [wikiLinkPlugin] as never)
    const marks = (v.plugin(wikiLinkPlugin as never) as unknown as { decorations: { size: number } })
      .decorations
    expect(marks.size).toBe(1)
    v.destroy()
  })

  it('scans a bounded window around the viewport', () => {
    // jsdom never lays out, so the view's own viewport is the empty range at 0.
    // The window function is what decides coverage, and it is what the e2e
    // sweep exercises in a real browser.
    expect(wikiLinkScanRange(0, 0, 1_000_000)).toEqual({ start: 0, end: 2_000 })
    expect(wikiLinkScanRange(500_000, 500_100, 1_000_000)).toEqual({
      start: 498_000,
      end: 502_100
    })
    // Never runs off either end of the document.
    expect(wikiLinkScanRange(0, 0, 500)).toEqual({ start: 0, end: 500 })
    expect(wikiLinkScanRange(999_000, 1_000_000, 1_000_000)).toEqual({
      start: 997_000,
      end: 1_000_000
    })
  })
})

describe('frontmatter decorations', () => {
  it('collapses a frontmatter block into the properties widget', () => {
    const v = view('---\ntitle: x\n---\n\n# Heading\n', [frontmatterPlugin] as never)
    const marks = v.state.field(frontmatterPlugin as never) as unknown as { size: number }
    expect(marks.size).toBe(1)
    v.destroy()
  })

  it('leaves a document without frontmatter alone', () => {
    const v = view('# Heading\n\nno properties here\n', [frontmatterPlugin] as never)
    const marks = v.state.field(frontmatterPlugin as never) as unknown as { size: number }
    expect(marks.size).toBe(0)
    v.destroy()
  })

  it('still finds frontmatter in a document larger than the scan window', () => {
    // The window is 64 KB and the head is scanned whole, so a frontmatter block
    // behind 100 KB of body text is still found.
    const body = 'body line\n'.repeat(15_000)
    const v = view(`---\ntitle: deep\n---\n\n${body}`, [frontmatterPlugin] as never)
    const marks = v.state.field(frontmatterPlugin as never) as unknown as { size: number }
    expect(marks.size).toBe(1)
    v.destroy()
  })
})