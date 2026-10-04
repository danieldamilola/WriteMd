import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { installFocusReportingFix } from '../src/renderer/src/utils/focus-reporting'

/** Captured before the patch lands, so the test can compare both behaviours. */
const cmHasFocus = Object.getOwnPropertyDescriptor(EditorView.prototype, 'hasFocus')!.get!

/** The shape this app renders: writemd-app's shadow root holds writemd-editor. */
function nestedEditor(doc = 'one\ntwo\nthree'): { view: EditorView; content: HTMLElement } {
  const app = document.createElement('div')
  const editor = document.createElement('div')
  app.attachShadow({ mode: 'open' }).appendChild(editor)
  const wrapper = document.createElement('div')
  editor.attachShadow({ mode: 'open' }).appendChild(wrapper)
  document.body.appendChild(app)
  const view = new EditorView({
    state: EditorState.create({ doc }),
    parent: wrapper
  })
  return { view, content: view.contentDOM as HTMLElement }
}

describe('focus reporting for shadow-hosted editors', () => {
  beforeAll(() => {
    installFocusReportingFix()
    installFocusReportingFix()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('reports focus when the document says it is not focused', () => {
    const { view, content } = nestedEditor()
    // What the split pane hit: the window manager claims the document is not
    // focused while the view's own shadow root points straight at its content.
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    content.focus()
    expect(cmHasFocus.call(view)).toBe(false)
    expect(view.hasFocus).toBe(true)
    view.destroy()
  })

  it('reports focus for the view that holds it and not for the other one', () => {
    const first = nestedEditor()
    const second = nestedEditor()
    first.content.focus()
    expect(first.view.hasFocus).toBe(true)
    expect(second.view.hasFocus).toBe(false)
    first.view.destroy()
    second.view.destroy()
  })

  it('reports no focus while something else is focused', () => {
    const { view, content } = nestedEditor()
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    outside.focus()
    expect(view.hasFocus).toBe(false)
    expect(content.isConnected).toBe(true)
    view.destroy()
  })

  it('still reports focus for an editor in the light DOM', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const view = new EditorView({ state: EditorState.create({ doc: 'plain' }), parent: host })
    expect(view.hasFocus).toBe(false)
    ;(view.contentDOM as HTMLElement).focus()
    expect(view.hasFocus).toBe(true)
    view.destroy()
  })
})