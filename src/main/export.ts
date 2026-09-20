import { BrowserWindow, dialog, type BrowserWindow as BrowserWindowType } from 'electron'
import { writeFile, rename, stat } from 'fs/promises'
import { dirname } from 'path'
import { mkdirSync } from 'fs'
import MarkdownIt from 'markdown-it'
import { getSettings } from './settings'

export type ExportTheme = 'light' | 'dark'

export interface ExportHtmlOptions {
  title: string
  theme: ExportTheme
}

export interface ExportResult {
  ok: boolean
  path?: string
  reason?: string
}

const md = new MarkdownIt({ html: false, linkify: true, typographer: true })

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function exportCss(theme: ExportTheme): string {
  const dark = theme === 'dark'
  const bg = dark ? '#1a1b1e' : '#ffffff'
  const text = dark ? '#e8e8e8' : '#1a1a1a'
  const muted = dark ? '#7a7a7a' : '#999999'
  const border = dark ? '#2e2f33' : '#e0e0e0'
  const codeBg = dark ? '#141517' : '#f5f5f5'
  const link = dark ? '#5aaaff' : '#2a7de1'
  return [
    `body{background:${bg};color:${text};font-family:Georgia,'Source Serif Pro',serif;`,
    `font-size:16px;line-height:1.8;max-width:800px;margin:0 auto;padding:48px 32px;}`,
    `h1,h2,h3,h4,h5,h6{line-height:1.3;margin:1.2em 0 0.5em;}`,
    `h1{font-size:28px;}h2{font-size:22px;}h3{font-size:18px;}`,
    `a{color:${link};}`,
    `blockquote{border-left:3px solid ${border};color:${muted};margin:1em 0;padding-left:14px;}`,
    `code{font-family:'JetBrains Mono',monospace;font-size:13px;background:${codeBg};`,
    `padding:1px 5px;border-radius:4px;}`,
    `pre{background:${codeBg};border:1px solid ${border};border-radius:6px;`,
    `padding:14px;overflow-x:auto;}pre code{background:none;padding:0;}`,
    `table{border-collapse:collapse;width:100%;margin:1em 0;}`,
    `th{text-align:left;padding:6px 16px 6px 0;border-bottom:1.5px solid ${border};}`,
    `td{padding:5px 16px 5px 0;border-bottom:1px solid ${border};vertical-align:top;}`,
    `hr{border:none;border-top:1px solid ${border};margin:2em 0;}`,
    `img{max-width:100%;}`
  ].join('')
}

/** Pure builder: markdown to standalone styled HTML. No Electron calls, unit tested. */
export function renderExportHtml(markdown: string, opts: ExportHtmlOptions): string {
  const body = md.render(markdown)
  const title = escapeHtml(opts.title)
  return [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${title}</title>`,
    `<style>${exportCss(opts.theme)}</style>`,
    `</head><body>${body}</body></html>`
  ].join('')
}

function resolveTheme(): ExportTheme {
  return getSettings().export.pdfTheme === 'dark' ? 'dark' : 'light'
}

const VALID_PAGE_SIZES = [
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
  'Legal',
  'Letter',
  'Tabloid',
  'Ledger'
] as const

type PdfPageSize = (typeof VALID_PAGE_SIZES)[number]

function resolvePageSize(raw: string): PdfPageSize {
  return (VALID_PAGE_SIZES as readonly string[]).includes(raw)
    ? (raw as PdfPageSize)
    : 'A4'
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

async function atomicWrite(targetPath: string, data: string | Buffer): Promise<number> {
  mkdirSync(dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.tmp`
  await writeFile(tempPath, data)
  await rename(tempPath, targetPath)
  const stats = await stat(targetPath)
  return stats.mtimeMs
}

async function renderInHiddenWindow(html: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false }
  })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const settings = getSettings()
    // pdfMargin is stored in millimeters; Electron wants pixels at 96 DPI.
    // Clamped so a bad stored value can never exceed the page.
    const marginPx = Math.min(200, Math.round(Math.max(0, settings.export.pdfMargin) * 3.7795275591))
    return await win.webContents.printToPDF({
      pageSize: resolvePageSize(settings.export.pdfPageSize),
      margins: {
        marginType: 'custom',
        top: marginPx,
        bottom: marginPx,
        left: marginPx,
        right: marginPx
      },
      printBackground: true
    })
  } finally {
    win.close()
  }
}

export async function exportPdf(
  getWindow: () => BrowserWindowType | null,
  markdown: string,
  docPath: string | null
): Promise<ExportResult> {
  const filePath = await showExportSaveDialog(
    getWindow,
    defaultExportPath(docPath, 'pdf'),
    'PDF',
    'pdf'
  )
  if (!filePath) return { ok: false, reason: 'canceled' }
  const html = renderExportHtml(markdown, {
    title: titleFromPath(docPath),
    theme: resolveTheme()
  })
  const pdfData = await renderInHiddenWindow(html)
  await atomicWrite(filePath, pdfData)
  return { ok: true, path: filePath }
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
  await atomicWrite(filePath, html)
  return { ok: true, path: filePath }
}
