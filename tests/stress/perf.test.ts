import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { EditorState } from '@codemirror/state'
import { markdownLanguage } from '@codemirror/lang-markdown'
import { parser as markdownParser } from '@lezer/markdown'
import { createDocumentMarkdownIt } from '../../src/renderer/src/utils/markdown'
import { isOwnEcho } from '../../src/renderer/src/state/file-state'

/**
 * Micro-benchmarks for the paths a keystroke or a file open goes through.
 *
 * They run against the real stress fixtures in the vault, so the numbers are
 * about documents people can actually have, not synthetic strings. When the
 * fixtures are missing (fresh clone, CI) every case skips instead of failing.
 *
 *   node tests/stress/generate-vault.mjs
 */
const STRESS = join(homedir(), 'Documents', 'WriteMd Vault', '_stress')
const present = existsSync(STRESS)

function fixture(name: string): string | null {
  const path = join(STRESS, name)
  return existsSync(path) ? readFileSync(path, 'utf-8') : null
}

function time<T>(label: string, fn: () => T, budgetMs: number): T {
  const started = performance.now()
  const result = fn()
  const ms = performance.now() - started
  console.log(`${label.padEnd(44)} ${ms.toFixed(1).padStart(9)} ms`)
  expect(ms, `${label} took ${ms.toFixed(1)}ms (budget ${budgetMs}ms)`).toBeLessThan(budgetMs)
  return result
}

/** Same, for work that returns a promise. */
async function timeAsync(
  label: string,
  fn: () => Promise<unknown>,
  budgetMs: number
): Promise<void> {
  const started = performance.now()
  await fn()
  const ms = performance.now() - started
  console.log(`${label.padEnd(44)} ${ms.toFixed(1).padStart(9)} ms`)
  expect(ms, `${label} took ${ms.toFixed(1)}ms (budget ${budgetMs}ms)`).toBeLessThan(budgetMs)
}

describe('stress: hot paths', () => {
  it('serializes a 6 MB document without collapsing', () => {
    const doc = fixture('huge-single.md')
    if (!present || !doc) return
    expect(doc.length).toBeGreaterThan(1_000_000)
    const state = EditorState.create({ doc })
    time('doc.toString() on 6 MB', () => state.doc.toString(), 120)
  })

  it('copies the document once per decoration field', () => {
    const doc = fixture('huge-single.md')
    if (!present || !doc) return
    const state = EditorState.create({ doc })
    // frontmatter, math, and wiki-link fields each stringify the whole doc on
    // every transaction, so this is the floor for one keystroke in a big file.
    time('3 x doc.toString(), 6 MB', () => {
      state.doc.toString()
      state.doc.toString()
      state.doc.toString()
    }, 250)
  })

  it('parses 6 MB of markdown', () => {
    const doc = fixture('huge-single.md')
    if (!present || !doc) return
    const tree = time('lezer markdown parse, 6 MB', () => markdownParser.parse(doc), 6_000)
    expect(tree.length).toBeGreaterThan(0)
  })

  it('builds a language state for 6 MB', () => {
    const doc = fixture('huge-single.md')
    if (!present || !doc) return
    time(
      'editor state with markdown language, 6 MB',
      () => EditorState.create({ doc, extensions: [markdownLanguage] }),
      6_000
    )
  })

  it('parses 4 MB of very long lines', () => {
    const doc = fixture('long-lines.md')
    if (!present || !doc) return
    const tree = time('lezer markdown parse, long lines', () => markdownParser.parse(doc), 6_000)
    expect(tree.length).toBeGreaterThan(0)
  })

  it('parses markdown-it for export', () => {
    const doc = fixture('huge-single.md')
    if (!present || !doc) return
    const md = createDocumentMarkdownIt()
    time('markdown-it render, 6 MB', () => md.render(doc), 25_000)
  })

  it('converts rendered HTML to docx', async () => {
    const doc = fixture('huge-single.md')
    if (!present || !doc) return
    const md = createDocumentMarkdownIt()
    // One megabyte is already an unusual note. The point is the slope: docx
    // conversion is what decides whether export needs a size guard.
    const html = md.render(doc.slice(0, 1_000_000))
    console.log(`html size ${(html.length / 1024).toFixed(0)} KB`)
    await timeAsync(
      'html-to-docx, 1 MB of HTML',
      async () => {
        const mod = await import('@turbodocx/html-to-docx')
        await (mod as { default: (h: string, o?: unknown) => Promise<unknown> }).default(html, {
          orientation: 'portrait'
        })
      },
      60_000
    )
  }, 120_000)

  it('scans math delimiters without going quadratic', () => {
    // Worst case for a lazy `$$...$$` scan: many opening delimiters, no close.
    const adversarial = '$$ '.repeat(200_000)
    time('math block scan, 1 MB adversarial', () => {
      const re = /\$\$([\s\S]*?)\$\$/g
      let m: RegExpExecArray | null
      while ((m = re.exec(adversarial)) !== null) {
        if (m.index > 0) break
      }
    }, 2_000)
    const doc = fixture('long-lines.md')
    if (present && doc) {
      time('math block scan, 4 MB long lines', () => {
        const re = /\$\$([\s\S]*?)\$\$/g
        let m: RegExpExecArray | null
        while ((m = re.exec(doc)) !== null) {
          if (m.index > 0) break
        }
      }, 2_000)
    }
  })

  it('detects our own save echo on a 6 MB document', () => {
    const doc = fixture('huge-single.md')
    if (!present || !doc) return
    const tab = {
      path: 'x.md',
      content: doc,
      originalContent: doc,
      mtime: 0,
      dirty: false,
      isVaultFile: true,
      lastWritten: doc,
      pendingWrite: null
    }
    time('isOwnEcho, 6 MB unchanged', () => isOwnEcho(tab, doc), 400)
    time('isOwnEcho, 6 MB external change', () => isOwnEcho(tab, `${doc}x`), 400)
  })

  it('counts words in a 6 MB document', () => {
    const doc = fixture('huge-single.md')
    if (!present || !doc) return
    const start = performance.now()
    const words = doc.trim().split(/\s+/).length
    const ms = performance.now() - start
    console.log(
      `${'split-based word count, 6 MB'.padEnd(44)} ${ms.toFixed(1).padStart(9)} ms (${words} words)`
    )
    expect(words).toBeGreaterThan(1000)
  })

  it('links 3000 wiki references', () => {
    const doc = fixture('wiki-links.md')
    if (!present || !doc) return
    const state = EditorState.create({ doc })
    time('wiki link doc.toString(), 190 KB', () => state.doc.toString(), 100)
    time(
      'wiki link regex, 190 KB',
      () => (state.doc.toString().match(/\[\[([^\]]+)\]\]/g) ?? []).length,
      200
    )
  })
})