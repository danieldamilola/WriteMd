import { BrowserWindow, dialog, type BrowserWindow as BrowserWindowType } from 'electron'
import { rename, stat, readFile, unlink, open, chmod } from 'fs/promises'
import { dirname, resolve, relative, extname } from 'path'
import { mkdirSync } from 'fs'
import { randomUUID } from 'crypto'
import { getSettings } from './settings'
import { hardenIsolatedWindow } from './harden'
import {
  PAGE_SIZE_MM,
  escapeHtml,
  renderExportHtml,
  renderMarkdown,
  resolvePageSize,
  type ExportHtmlOptions,
  type ExportTheme
} from '../shared/export-html'

// Re-exported so the main process's public surface is unchanged. The builder
// itself lives in `shared` so the renderer's export preview renders through the
// exact same function rather than a second copy that could drift from it.
export { renderExportHtml }
export type { ExportHtmlOptions, ExportTheme }

export interface ExportResult {
  ok: boolean
  path?: string
  reason?: string
}

function resolveTheme(): ExportTheme {
  return getSettings().export.pdfTheme === 'dark' ? 'dark' : 'light'
}

async function showExportSaveDialog(
  getWindow: () => BrowserWindowType | null,
  defaultPath: string | undefined,
  filterName: string,
  extension: string
): Promise<string | null> {
  const options: Electron.SaveDialogOptions = {
    defaultPath,
    filters: [{ name: filterName, extensions: [extension] }]
  }
  const parent = getWindow()
  const chosen = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  if (chosen.canceled || !chosen.filePath) return null
  return chosen.filePath
}

function titleFromPath(docPath: string | null): string {
  if (!docPath) return 'Untitled'
  const base = docPath.replace(/\\/g, '/').split('/').pop() ?? 'Untitled'
  return base.replace(/\.[^/.]+$/, '')
}

function defaultExportPath(docPath: string | null, ext: string): string | undefined {
  if (!docPath) return undefined
  return docPath.replace(/\.[^/.]+$/, `.${ext}`)
}

/**
 * Same contract as the `file:write` handler: unique temp name so concurrent
 * exports to the same target cannot clobber each other, and the temp is
 * removed if anything fails, so a failed export leaves no litter next to the
 * user's file.
 */
async function atomicWrite(targetPath: string, data: string | Buffer): Promise<number> {
  mkdirSync(dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.${randomUUID()}.tmp`
  // Overwriting an existing file must not change its permissions. The temp file
  // gets the process umask, so without this an export over a `0600` PDF quietly
  // widened it for everyone who can reach the folder.
  let mode: number | undefined
  try {
    mode = (await stat(targetPath)).mode
  } catch {
    // New file: the umask default is right.
  }
  try {
    const handle = await open(tempPath, 'w')
    try {
      await handle.writeFile(data)
      // Flush before the rename. A rename is atomic with respect to the directory
      // entry, not the data, so without this a crash can leave the name pointing
      // at a file whose contents never reached the disk.
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (mode !== undefined) await chmod(tempPath, mode)
    await rename(tempPath, targetPath)
  } catch (e) {
    await unlink(tempPath).catch(() => {})
    throw e
  }
  const stats = await stat(targetPath)
  return stats.mtimeMs
}

async function renderInHiddenWindow(html: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  try {
    // The document is built from the user's markdown, so a link or image in it
    // must not be able to navigate this window anywhere. No preload is attached,
    // so there is no bridge to expose, but an unconstrained window is still a way
    // to reach the network with the user's session.
    hardenIsolatedWindow(win.webContents)
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const settings = getSettings()
    const pageSize = resolvePageSize(settings.export.pdfPageSize)
    const rawMargin = Number(settings.export.pdfMargin)
    const marginMm = Number.isFinite(rawMargin) ? Math.max(0, rawMargin) : 24
    // printToPDF custom margins are in inches: convert mm and clamp to
    // < half page minus breathing room (20px at 96 DPI)
    const pageMM = PAGE_SIZE_MM[pageSize]
    const toInches = (mm: number): number => mm / 25.4
    const maxMarginIn = Math.max(
      0,
      Math.min(toInches(pageMM.width), toInches(pageMM.height)) / 2 - 20 / 96
    )
    const marginIn = Math.min(maxMarginIn, toInches(marginMm))
    return await win.webContents.printToPDF({
      pageSize,
      // Electron 44 removed PrintToPDFMargins.marginType; supplying any margin
      // is now custom by definition. Passing it is a type error, and it used
      // to be the only way to get custom margins at all.
      margins: {
        top: marginIn,
        bottom: marginIn,
        left: marginIn,
        right: marginIn
      },
      printBackground: true
    })
  } finally {
    win.close()
  }
}

/**
 * Size ceiling for the two binary exports.
 *
 * Both build the whole document in one blocking pass on the main process:
 * measured at roughly 6 seconds per megabyte for the docx conversion, and a
 * hidden window print for the PDF. A 6 MB note is 35 seconds of a window that
 * will not repaint, with no way to tell it apart from a hang. HTML export is
 * not capped; rendering 6 MB to HTML takes well under a second.
 */
const BINARY_EXPORT_LIMIT = 4 * 1024 * 1024

function tooLargeForBinaryExport(markdown: string, kind: 'PDF' | 'Word'): string | null {
  if (markdown.length <= BINARY_EXPORT_LIMIT) return null
  const mb = (markdown.length / (1024 * 1024)).toFixed(1)
  return (
    `This note is ${mb} MB, which ${kind} export cannot handle in one pass ` +
    `(the limit is 4 MB and the conversion runs at about 6 seconds per MB). ` +
    `Export as HTML instead, or split the note.`
  )
}

export async function exportPdf(
  getWindow: () => BrowserWindowType | null,
  markdown: string,
  docPath: string | null
): Promise<ExportResult> {
  const tooLarge = tooLargeForBinaryExport(markdown, 'PDF')
  if (tooLarge) return { ok: false, reason: tooLarge }
  const filePath = await showExportSaveDialog(
    getWindow,
    defaultExportPath(docPath, 'pdf'),
    'PDF',
    'pdf'
  )
  if (!filePath) return { ok: false, reason: 'canceled' }
  try {
    const html = renderExportHtml(markdown, {
      title: titleFromPath(docPath),
      theme: resolveTheme()
    })
    const pdfData = await renderInHiddenWindow(html)
    await atomicWrite(filePath, pdfData)
    return { ok: true, path: filePath }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

export async function exportHtml(
  getWindow: () => BrowserWindowType | null,
  markdown: string,
  docPath: string | null
): Promise<ExportResult> {
  const html = renderExportHtml(markdown, {
    title: titleFromPath(docPath),
    theme: resolveTheme()
  })
  const filePath = await showExportSaveDialog(
    getWindow,
    defaultExportPath(docPath, 'html'),
    'HTML',
    'html'
  )
  if (!filePath) return { ok: false, reason: 'canceled' }
  // Wrapped like the other two exports so a permission or disk error comes
  // back as a result object instead of a raw IPC rejection.
  try {
    await atomicWrite(filePath, html)
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
  return { ok: true, path: filePath }
}

// ---------------------------------------------------------------------------
// DOCX export - mirrors Paperling's approach (pure JS, no headless PDF)
// Uses @turbodocx/html-to-docx to convert the same markdown-rendered HTML
// into a real Office Open XML document. Light, print-style, white background.
// ---------------------------------------------------------------------------
type HtmlToDocx = (
  html: string,
  header?: string | null,
  options?: Record<string, unknown>,
  footer?: string | null
) => Promise<ArrayBuffer | Blob | Uint8Array>

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp'
}

/**
 * Embed document-relative <img> assets as data URIs so converters without a
 * file base (html-to-docx) can resolve them. Only paths that stay inside the
 * document directory are embedded; absolute URLs, data URIs, unknown types,
 * and paths escaping the directory pass through unchanged.
 */
export async function embedLocalImages(html: string, docPath: string | null): Promise<string> {
  if (!docPath) return html
  const baseDir = dirname(docPath)
  // Matches are collected before any rewriting, then applied by slicing the
  // string. Rewriting inside the loop with String.replace would only ever hit
  // the first identical tag, so a document repeating the same image would
  // leave every copy after the first unembedded.
  const edits: Array<{ start: number; end: number; text: string }> = []
  for (const m of html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/g)) {
    const src = m[1]
    if (/^(https?:|data:|file:)/i.test(src)) continue
    const clean = src.split('?')[0].split('#')[0]
    const abs = resolve(baseDir, clean)
    if (relative(baseDir, abs).startsWith('..')) continue
    const mime = IMAGE_MIME[extname(clean).toLowerCase()]
    if (!mime) continue
    try {
      const bytes = await readFile(abs)
      const dataUri = `data:${mime};base64,${bytes.toString('base64')}`
      const start = m.index
      const end = start + m[0].length
      const rewritten =
        m[0].slice(0, m[0].indexOf('src=')) +
        `src="${dataUri}"` +
        m[0].slice(m[0].indexOf('src=') + src.length + 'src="'.length)
      edits.push({ start, end, text: rewritten })
    } catch {
      // Unreadable asset: leave the tag as-is
    }
  }
  let out = html
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  }
  return out
}

async function ensureDocxRuntime(): Promise<void> {
  const g = globalThis as Record<string, unknown>
  if (typeof g.global === 'undefined') g.global = g
  if (typeof g.process === 'undefined') g.process = { env: {} }
  if (typeof g.Buffer === 'undefined') {
    const { Buffer } = await import('buffer')
    g.Buffer = Buffer
  }
}

export async function exportDocx(
  getWindow: () => BrowserWindowType | null,
  markdown: string,
  docPath: string | null
): Promise<ExportResult> {
  if (!markdown || markdown.trim() === '') {
    return { ok: false, reason: 'Document is empty' }
  }
  const tooLarge = tooLargeForBinaryExport(markdown, 'Word')
  if (tooLarge) return { ok: false, reason: tooLarge }
  const title = titleFromPath(docPath)
  const body = renderMarkdown(markdown)
  const rawHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><article>${body}</article></body></html>`
  const docHtml = await embedLocalImages(rawHtml, docPath)

  const filePath = await showExportSaveDialog(
    getWindow,
    defaultExportPath(docPath, 'docx'),
    'Word Document',
    'docx'
  )
  if (!filePath) return { ok: false, reason: 'canceled' }

  try {
    await ensureDocxRuntime()
    const mod = await import('@turbodocx/html-to-docx')
    const convert = ((mod as { default?: HtmlToDocx }).default ??
      (mod as unknown as HtmlToDocx)) as HtmlToDocx
    const out = await convert(docHtml, null, {
      title,
      creator: 'WriteMd',
      footer: false,
      pageNumber: false,
      font: 'Calibri',
      fontSize: 22,
      table: { row: { cantSplit: true } }
    })
    const bytes =
      out instanceof Blob
        ? new Uint8Array(await out.arrayBuffer())
        : out instanceof Uint8Array
          ? out
          : new Uint8Array(out as ArrayBuffer)
    await atomicWrite(filePath, Buffer.from(bytes))
    return { ok: true, path: filePath }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
