/**
 * The export document builder.
 *
 * Pure and renderer-safe: no Electron, no DOM. The main process imports it to
 * write HTML and PDF files, and the renderer imports it to draw the export
 * preview. That shared import is the whole point - a preview assembled from a
 * second copy of this stylesheet would drift from the file that gets written,
 * which would make the preview worse than useless.
 */
import { createDocumentMarkdownIt } from '../renderer/src/utils/markdown'

export type ExportTheme = 'light' | 'dark'

export interface ExportHtmlOptions {
  title: string
  theme: ExportTheme
}

/**
 * Locked down for an exported document: it is the user's own markdown, but a
 * link or image in it must not be able to fetch or execute anything when the
 * file is later opened. Moved here from `main/harden` so the shared builder can
 * apply it without dragging Electron into the renderer.
 */
export const EXPORT_CSP =
  "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data:"

// One shared configuration, so an export matches what the editor renders.
// `createDocumentMarkdownIt` lives in `src/renderer` because it is renderer-safe
// pure code with no DOM dependency; importing across the process boundary is
// deliberate to avoid a fourth copy drifting.
const md = createDocumentMarkdownIt({ typographer: true })

/**
 * The shared markdown-it instance, exposed so the DOCX path converts through
 * the same configuration as the HTML and PDF exports rather than assembling a
 * fourth one.
 */
export function renderMarkdown(markdown: string): string {
  return md.render(markdown)
}

export { escapeHtml }

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
    `<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${title}</title>`,
    `<style>${exportCss(opts.theme)}</style>`,
    `</head><body>${body}</body></html>`
  ].join('')
}

export const VALID_PAGE_SIZES = [
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

export type PdfPageSize = (typeof VALID_PAGE_SIZES)[number]

export function resolvePageSize(raw: string): PdfPageSize {
  return (VALID_PAGE_SIZES as readonly string[]).includes(raw) ? (raw as PdfPageSize) : 'A4'
}

export const PAGE_SIZE_MM: Record<PdfPageSize, { width: number; height: number }> = {
  A0: { width: 841, height: 1189 },
  A1: { width: 594, height: 841 },
  A2: { width: 420, height: 594 },
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  A6: { width: 105, height: 148 },
  Legal: { width: 215.9, height: 355.6 },
  Letter: { width: 215.9, height: 279.4 },
  Tabloid: { width: 279.4, height: 431.8 },
  Ledger: { width: 431.8, height: 279.4 }
}

/** CSS pixels per millimetre at the 96 DPI that printToPDF lays out against. */
export const PX_PER_MM = 96 / 25.4
