import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
// Side-effect import: registers <writemd-preview-panel>.
import '../src/renderer/src/components/PreviewPanel'
import { PreviewPanel } from '../src/renderer/src/components/PreviewPanel'
import { SettingsStore } from '../src/renderer/src/state/settings'
import { EXPORT_CSP, PAGE_SIZE_MM, PX_PER_MM, VALID_PAGE_SIZES } from '../src/shared/export-html'

/**
 * The export preview is the only place the user sees what an export will look
 * like before the file is written, so what matters is that the frame holds the
 * same document the exporter writes, and that the three export settings drive it
 * rather than the panel keeping its own copy.
 *
 * The bridge is faked at `window.electronAPI`, the single seam
 * `src/renderer/src/api.ts` exposes, and the settings go through the real
 * SettingsStore so the write-through is genuinely exercised rather than mocked.
 *
 * Two bugs from the first draft of PreviewPanel.ts are guarded by the last two
 * tests; both are marked there.
 */

type Api = NonNullable<Window['electronAPI']>

const pdf = vi.fn<Api['export']['pdf']>(async () => ({ ok: true, path: 'C:/out/Note.pdf' }))
const html = vi.fn<Api['export']['html']>(async () => ({ ok: true, path: 'C:/out/Note.html' }))
/** The last snapshot the store pushed to the main process. */
let lastSaved: { export?: { pdfPageSize?: string } } | undefined

const settingsSet = vi.fn(
  async (snapshot: { export?: { pdfPageSize?: string } }): Promise<void> => {
    lastSaved = snapshot
  }
)

function installBridge(): void {
  ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
    export: { pdf, html },
    settings: { get: async (): Promise<Record<string, never>> => ({}), set: settingsSet }
  } as unknown as Api
}

function clearBridge(): void {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
}

/** Defaults written without persisting, so each test starts from a known bar. */
function setExport(values: Record<string, unknown>): void {
  SettingsStore.getInstance().setMany(values, false)
}

async function mount(markdown = '', docPath: string | null = null): Promise<PreviewPanel> {
  const el = document.createElement('writemd-preview-panel') as PreviewPanel
  el.markdown = markdown
  el.docPath = docPath
  document.body.appendChild(el)
  // `tests/setup.ts` stubs ResizeObserver globally, so connectedCallback can
  // construct one here. The stub is inert, so the pane width stays 0 and the
  // sheet renders at the 0.5 fallback scale - nothing below asserts geometry
  // that needs a real layout pass.
  await el.updateComplete
  return el
}

function frame(el: PreviewPanel): HTMLIFrameElement {
  const found = el.shadowRoot?.querySelector('iframe[title="Export preview"]')
  expect(found).not.toBeNull()
  return found as HTMLIFrameElement
}

function srcdoc(el: PreviewPanel): string {
  return frame(el).srcdoc
}

function control(el: PreviewPanel, label: string): HTMLSelectElement | HTMLInputElement {
  const found = el.shadowRoot?.querySelector(`[aria-label="${label}"]`)
  expect(found).not.toBeNull()
  return found as HTMLSelectElement | HTMLInputElement
}

function pageSizeControl(el: PreviewPanel): HTMLSelectElement {
  return control(el, 'Page size') as HTMLSelectElement
}

function button(el: PreviewPanel, text: string): HTMLButtonElement {
  const found = Array.from(el.shadowRoot?.querySelectorAll('button') ?? []).find((b) =>
    (b.textContent ?? '').includes(text)
  )
  expect(found).not.toBeUndefined()
  return found as HTMLButtonElement
}

/** The panel listens for change, not input, so that is what the tests fire. */
function change(el: HTMLElement): void {
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
}

/**
 * The settings write and the export round-trip are both promise chains, so
 * `updateComplete` alone is not enough: it resolves immediately when no update
 * is pending yet. One macrotask lets both land before the DOM is inspected.
 */
async function settle(el: PreviewPanel): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await el.updateComplete
}

describe('writemd-preview-panel', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    installBridge()
    vi.clearAllMocks()
    lastSaved = undefined
    setExport({
      'export.pdfPageSize': 'A4',
      'export.pdfMargin': 24,
      'export.pdfTheme': 'light'
    })
  })

  afterEach(() => {
    clearBridge()
  })

  it('renders the open document inside the preview frame', async () => {
    const el = await mount('# Release notes\n\nThe build is green.\n', '/notes/Release.md')

    const doc = srcdoc(el)
    // Rendered through the same builder the exporter writes with, so the
    // heading arrives as markup rather than as raw markdown.
    expect(doc).toContain('<h1>Release notes</h1>')
    expect(doc).toContain('<p>The build is green.</p>')
    expect(doc).not.toContain('# Release notes')
    // Locked down the same way the file on disk is, since this is the user's
    // own markdown being rendered back to them.
    expect(doc).toContain(EXPORT_CSP)
    expect(frame(el).hasAttribute('sandbox')).toBe(true)
  })

  it('follows the markdown as the document changes', async () => {
    const el = await mount('# First')
    expect(srcdoc(el)).toContain('<h1>First</h1>')

    el.markdown = '# Second'
    await el.updateComplete
    expect(srcdoc(el)).toContain('<h1>Second</h1>')
    expect(srcdoc(el)).not.toContain('<h1>First</h1>')
  })

  it('writes a new page size choice back to settings', async () => {
    const el = await mount()

    pageSizeControl(el).value = 'Letter'
    change(pageSizeControl(el))
    await el.updateComplete

    expect(SettingsStore.getInstance().get('export.pdfPageSize', 'A4')).toBe('Letter')
  })

  it('offers exactly the page sizes the exporter accepts, in order', async () => {
    const el = await mount()
    const options = Array.from(pageSizeControl(el).querySelectorAll('option')).map((o) => o.value)
    expect(options).toEqual([...VALID_PAGE_SIZES])
  })

  it('sizes the sheet from the page size the settings hold', async () => {
    setExport({ 'export.pdfPageSize': 'A5' })
    const el = await mount()
    const sheet = el.shadowRoot?.querySelector<HTMLElement>('.sheet')
    // Millimetres back out of CSS pixels, so this asserts the page geometry
    // rather than the rounding of PX_PER_MM.
    const sheetWidthMm = (): number =>
      Math.round(Number.parseFloat(sheet?.style.width ?? '0') / PX_PER_MM)
    expect(sheetWidthMm()).toBe(PAGE_SIZE_MM.A5.width)

    setExport({ 'export.pdfPageSize': 'A4' })
    await el.updateComplete
    expect(sheetWidthMm()).toBe(PAGE_SIZE_MM.A4.width)
  })

  it('shows the saved margin and writes a new one back to settings', async () => {
    setExport({ 'export.pdfMargin': 18 })
    const el = await mount()
    const margin = control(el, 'Margin in millimetres') as HTMLInputElement
    expect(margin.value).toBe('18')

    margin.value = '10'
    change(margin)
    await el.updateComplete
    expect(SettingsStore.getInstance().get('export.pdfMargin', 0)).toBe(10)
  })

  it('clamps a negative margin to zero rather than storing it', async () => {
    const el = await mount()
    const margin = control(el, 'Margin in millimetres') as HTMLInputElement

    margin.value = '-5'
    change(margin)
    await el.updateComplete
    expect(SettingsStore.getInstance().get('export.pdfMargin', 0)).toBe(0)
  })

  it('falls back to zero for a margin that is not a number', async () => {
    const el = await mount()
    const margin = control(el, 'Margin in millimetres') as HTMLInputElement

    margin.value = 'abc'
    change(margin)
    await el.updateComplete
    expect(SettingsStore.getInstance().get('export.pdfMargin', 0)).toBe(0)
  })

  it('shows the saved export theme and writes a new one back to settings', async () => {
    setExport({ 'export.pdfTheme': 'dark' })
    const el = await mount()
    const theme = control(el, 'Export theme') as HTMLSelectElement

    expect(theme.value).toBe('dark')
    // The theme is not just a control state: it changes the document that gets
    // written, so it has to reach the frame.
    expect(srcdoc(el)).toContain('body{background:#1a1b1e')

    theme.value = 'light'
    change(theme)
    await el.updateComplete
    expect(SettingsStore.getInstance().get('export.pdfTheme', 'dark')).toBe('light')
    expect(srcdoc(el)).toContain('body{background:#ffffff')
  })

  it('falls back to the light theme for anything unrecognised', async () => {
    setExport({ 'export.pdfTheme': 'solarized' })
    const el = await mount()
    expect((control(el, 'Export theme') as HTMLSelectElement).value).toBe('light')
  })

  it('picks up an export setting changed elsewhere without a remount', async () => {
    const el = await mount()
    const sheet = el.shadowRoot?.querySelector<HTMLElement>('.sheet')
    const widthFor = (): number =>
      Math.round(Number.parseFloat(sheet?.style.width ?? '0') / PX_PER_MM)
    expect(widthFor()).toBe(PAGE_SIZE_MM.A4.width)

    // The Settings dialog writes the same keys, and the panel has to follow.
    SettingsStore.getInstance().set('export.pdfPageSize', 'A3')
    await el.updateComplete

    expect(widthFor()).toBe(PAGE_SIZE_MM.A3.width)
  })

  it('persists a control change through to the bridge', async () => {
    const el = await mount()
    const page = pageSizeControl(el)

    page.value = 'A6'
    change(page)
    // Persisting is off the back of a promise chain, not synchronous.
    await settle(el)

    expect(settingsSet).toHaveBeenCalled()
    expect(lastSaved?.export?.pdfPageSize).toBe('A6')
  })

  it('stops following settings once it leaves the document', async () => {
    const el = await mount()
    el.remove()
    // Would throw if a subscriber outlived the element it was registered for.
    expect(() => SettingsStore.getInstance().set('export.pdfMargin', 30)).not.toThrow()
  })

  it('saves a PDF through the bridge with the markdown and the document path', async () => {
    const el = await mount('# Release notes', '/notes/Release.md')

    button(el, 'Save PDF').click()
    await settle(el)

    expect(pdf).toHaveBeenCalledWith('# Release notes', '/notes/Release.md')
    expect(html).not.toHaveBeenCalled()
    expect(el.shadowRoot?.querySelector('.notice')).toBeNull()
  })

  it('saves HTML through the bridge with the markdown and the document path', async () => {
    const el = await mount('# Release notes', '/notes/Release.md')

    button(el, 'Save HTML').click()
    await settle(el)

    expect(html).toHaveBeenCalledWith('# Release notes', '/notes/Release.md')
    expect(pdf).not.toHaveBeenCalled()
  })

  it('passes a null path for an unsaved document', async () => {
    const el = await mount('# Scratch', null)

    button(el, 'Save PDF').click()
    await settle(el)

    expect(pdf).toHaveBeenCalledWith('# Scratch', null)
  })

  it('titles the export after the file, without its extension', async () => {
    const el = await mount('# Heading', '/notes/My Note.md')
    expect(srcdoc(el)).toContain('<title>My Note</title>')
  })

  it('titles the export from a Windows path too', async () => {
    const el = await mount('# Heading', 'C:\\notes\\Q3 Report.md')
    expect(srcdoc(el)).toContain('<title>Q3 Report</title>')
  })

  it('titles an unsaved document Untitled', async () => {
    const el = await mount('# Heading', null)
    expect(srcdoc(el)).toContain('<title>Untitled</title>')
  })

  it('escapes the document title rather than injecting it', async () => {
    const el = await mount('# Heading', '/notes/a<b>&c.md')
    expect(srcdoc(el)).toContain('<title>a&lt;b&gt;&amp;c</title>')
    expect(srcdoc(el)).not.toContain('<title>a<b>')
  })

  it('reports a failed export, and stays quiet when the user cancels', async () => {
    pdf.mockResolvedValueOnce({ ok: false, reason: 'disk full' })
    const el = await mount('# Heading', '/notes/Release.md')

    button(el, 'Save PDF').click()
    await settle(el)
    const notice = el.shadowRoot?.querySelector('.notice')
    expect(notice?.textContent).toContain('disk full')
    expect(notice?.getAttribute('role')).toBe('alert')

    pdf.mockResolvedValueOnce({ ok: false, reason: 'canceled' })
    button(el, 'Save PDF').click()
    await settle(el)
    expect(el.shadowRoot?.querySelector('.notice')).toBeNull()
  })

  it('reports a thrown export rather than failing silently', async () => {
    html.mockRejectedValueOnce(new Error('bridge gone'))
    const el = await mount('# Heading', '/notes/Release.md')

    button(el, 'Save HTML').click()
    await settle(el)

    expect(el.shadowRoot?.querySelector('.notice')?.textContent).toContain('bridge gone')
  })

  /**
   * Regression guard for a bug that shipped in the first draft of this
   * component: `@query('.stage')` was declared with an `= null` initializer.
   * The decorator installs a getter-only accessor, and with
   * `useDefineForClassFields: false` that initializer compiled to a plain
   * `this.stage = null` in the constructor. Strict mode threw
   * "Cannot set property stage ... which has only a getter", so the element
   * could not be constructed at all and no preview ever rendered.
   *
   * A query must never be assigned. Editor.ts:1063 has the correct form.
   */
  it('constructs without throwing on its @query field', () => {
    expect(() => new PreviewPanel()).not.toThrow()
    // The query stays the decorator's getter rather than a shadowing data field.
    expect(typeof Object.getOwnPropertyDescriptor(PreviewPanel.prototype, 'stage')?.get).toBe(
      'function'
    )
  })

  /**
   * Regression guard for the second bug in the first draft: the options carried
   * no `?selected=`, so the `.value` binding was committed before any option
   * existed, the select fell back to its first entry, and every saved page size
   * read as "A0" on screen.
   */
  it('shows the saved page size rather than the first option', async () => {
    setExport({ 'export.pdfPageSize': 'A5' })
    const el = await mount()
    expect(pageSizeControl(el).value).toBe('A5')
  })
})
