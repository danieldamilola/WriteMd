import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:/Temp/writemd-phase5-test'
  },
  BrowserWindow: class {},
  dialog: {
    showSaveDialog: async () => ({ canceled: true })
  }
}))

import { renderExportHtml, exportHtml, exportPdf } from '../src/main/export'

describe('phase 5 export', () => {
  it('renders markdown to standalone HTML with embedded CSS', () => {
    const html = renderExportHtml('# Hello\n\nSome **bold** text.', {
      title: 'Hello',
      theme: 'light'
    })
    expect(html).toContain('<h1>Hello</h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<style>')
    expect(html).toContain('<title>Hello</title>')
  })

  it('produces portable HTML with no external references', () => {
    const html = renderExportHtml('Just text.', { title: 'T', theme: 'light' })
    expect(html).not.toMatch(/<link[^>]+href="http/)
    expect(html).not.toMatch(/<script[^>]+src=/)
  })

  it('escapes the document title', () => {
    const html = renderExportHtml('Body.', { title: '<script>alert(1)</script>', theme: 'light' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('does not pass through raw HTML from the markdown body', () => {
    const html = renderExportHtml('<div onclick="evil()">x</div>', {
      title: 'T',
      theme: 'light'
    })
    expect(html).not.toContain('<div onclick')
    expect(html).toContain('&lt;div')
  })

  it('renders tables and code fences', () => {
    const html = renderExportHtml('| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1\n```', {
      title: 'T',
      theme: 'light'
    })
    expect(html).toContain('<table>')
    expect(html).toContain('<pre>')
  })

  it('switches palette for the dark theme', () => {
    const light = renderExportHtml('x', { title: 'T', theme: 'light' })
    const dark = renderExportHtml('x', { title: 'T', theme: 'dark' })
    expect(light).toContain('#ffffff')
    expect(dark).toContain('#1a1b1e')
    expect(dark).not.toContain('#ffffff')
  })

  it('exportHtml returns canceled without writing when the dialog is canceled', async () => {
    const result = await exportHtml(() => null, '# Hi', 'C:/docs/note.md')
    expect(result).toEqual({ ok: false, reason: 'canceled' })
  })

  it('exportPdf asks for a path before rendering when the dialog is canceled', async () => {
    const result = await exportPdf(() => null, '# Hi', 'C:/docs/note.md')
    expect(result).toEqual({ ok: false, reason: 'canceled' })
  })
})
