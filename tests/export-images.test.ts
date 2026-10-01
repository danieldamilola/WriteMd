import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// export.ts pulls in electron via ./settings, which reads app.getPath at module
// load. Same stub the other main-process suites use.
vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'writemd-export-images-test') },
  BrowserWindow: class {},
  dialog: { showSaveDialog: async () => ({ canceled: true }) }
}))

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { renderExportHtml, embedLocalImages } from '../src/main/export'

describe('renderExportHtml', () => {
  it('escapes raw HTML in the document body', () => {
    const out = renderExportHtml('<script>alert(1)</script>', { title: 'x', theme: 'light' })
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('escapes the title into the document title', () => {
    const out = renderExportHtml('hi', {
      title: '</title><script>alert(1)</script>',
      theme: 'light'
    })
    expect(out).not.toContain('<script>alert(1)</script>')
  })

  it('renders markdown normally', () => {
    const out = renderExportHtml('# Title', { title: 'x', theme: 'dark' })
    expect(out).toContain('<h1>Title</h1>')
  })
})

describe('embedLocalImages', () => {
  let dir: string
  let docPath: string

  // 1x1 transparent PNG.
  const PNG = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100' +
      '05fe02fea7b5c4a70000000049454e44ae426082',
    'hex'
  )

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'writemd-export-'))
    mkdirSync(join(dir, '_assets'), { recursive: true })
    docPath = join(dir, 'note.md')
    writeFileSync(join(dir, '_assets', 'pic.png'), PNG)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // The old implementation rewrote the string inside the match loop, so only
  // the first of several identical tags was ever embedded.
  it('embeds every copy of a repeated image, not just the first', async () => {
    const html = '<p><img src="./_assets/pic.png"></p><p><img src="./_assets/pic.png"></p>'
    const out = await embedLocalImages(html, docPath)
    expect(out).not.toContain('src="./_assets/pic.png"')
    const dataUri = 'data:image/png;base64,'
    expect(out.split(dataUri).length - 1).toBe(2)
  })

  it('embeds a single image', async () => {
    const out = await embedLocalImages('<img src="./_assets/pic.png">', docPath)
    expect(out).toContain('data:image/png;base64,')
  })

  it('leaves remote and data sources untouched', async () => {
    const html = '<img src="https://example.com/a.png"><img src="data:image/png;base64,AAA">'
    expect(await embedLocalImages(html, docPath)).toBe(html)
  })

  it('refuses to embed a path that escapes the document directory', async () => {
    writeFileSync(join(dir, 'secret.png'), PNG)
    const html = '<img src="../secret.png"><img src="./_assets/../../secret.png">'
    const out = await embedLocalImages(html, docPath)
    expect(out).not.toContain('base64,')
  })

  it('leaves the tag alone when the file is missing', async () => {
    const html = '<img src="./_assets/gone.png">'
    expect(await embedLocalImages(html, docPath)).toBe(html)
  })

  it('leaves the tag alone for an unknown image extension', async () => {
    writeFileSync(join(dir, 'notes.xyz'), PNG)
    const html = '<img src="./notes.xyz">'
    expect(await embedLocalImages(html, docPath)).toBe(html)
  })

  it('strips a query string before resolving the path', async () => {
    const out = await embedLocalImages('<img src="./_assets/pic.png?v=2">', docPath)
    expect(out).toContain('data:image/png;base64,')
  })

  it('returns the html unchanged when there is no document path', async () => {
    const html = '<img src="./_assets/pic.png">'
    expect(await embedLocalImages(html, null)).toBe(html)
  })

  it('preserves surrounding attributes on the img tag', async () => {
    const out = await embedLocalImages('<img alt="a" src="./_assets/pic.png" width="20">', docPath)
    expect(out).toContain('alt="a"')
    expect(out).toContain('width="20"')
    expect(out).toContain('data:image/png;base64,')
  })
})
