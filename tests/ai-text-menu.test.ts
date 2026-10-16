import { describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { TextMenu, type AiSelectionAction } from '../src/renderer/src/components/TextMenu'
import { Editor } from '../src/renderer/src/components/Editor'
import '../src/renderer/src/components/TextMenu'
import '../src/renderer/src/components/Editor'

function view(content: string, from: number, to: number): EditorView {
  return {
    state: EditorState.create({ doc: content, selection: { anchor: from, head: to } })
  } as EditorView
}

async function mount(enabled = true, text = 'car'): Promise<TextMenu> {
  const menu = document.createElement('writemd-text-menu')
  menu.aiEnabled = enabled
  menu.view = view('A car travels past the unrelated factory.', 2, 5)
  menu.selection = { text, from: 2, to: 5, path: 'C:/vault/transport.md' }
  document.body.append(menu)
  await menu.updateComplete
  return menu
}

describe('selection AI text menu', () => {
  it('offers explanation and summary for selected text when AI is enabled', async () => {
    const menu = await mount()
    expect(menu.shadowRoot?.querySelector('[data-id="ai-explain"]')?.textContent).toContain(
      'Explain with AI'
    )
    expect(menu.shadowRoot?.querySelector('[data-id="ai-summarize"]')?.textContent).toContain(
      'Summarize with AI'
    )
  })

  it.each([
    ['disabled', false, 'car'],
    ['empty', true, ''],
    ['whitespace', true, '  ']
  ])('omits AI actions when selection is %s', async (_label, enabled, text) => {
    const menu = await mount(enabled as boolean, text as string)
    expect(menu.shadowRoot?.querySelector('[data-id^="ai-"]')).toBeNull()
  })

  it.each([
    ['ai-explain', 'explain'],
    ['ai-summarize', 'summarize']
  ])('uses captured selection for %s even after the editor cursor moves', async (id, intent) => {
    const menu = await mount()
    menu.view = view('A car travels past the unrelated factory.', 34, 41)
    const listener = vi.fn()
    const close = vi.fn()
    menu.addEventListener('ai-selection-action', listener)
    menu.addEventListener('close', close)
    menu.shadowRoot?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.click()
    expect(listener).toHaveBeenCalledOnce()
    const event = listener.mock.calls[0][0] as CustomEvent<AiSelectionAction>
    expect(event.detail).toEqual({
      text: 'car',
      from: 2,
      to: 5,
      path: 'C:/vault/transport.md',
      intent
    })
    expect(event.composed).toBe(true)
    expect(close).toHaveBeenCalledOnce()
  })

  it('supports keyboard activation without changing the highlighted word', async () => {
    const menu = await mount()
    const listener = vi.fn()
    menu.addEventListener('ai-selection-action', listener)
    const row = menu.shadowRoot!.querySelector<HTMLElement>('[data-id="ai-explain"]')!
    row.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect((listener.mock.calls[0][0] as CustomEvent<AiSelectionAction>).detail.text).toBe('car')
    expect(menu.view?.state.doc.toString()).toBe('A car travels past the unrelated factory.')
  })

  it.each([false, true])(
    'captures only the highlighted text in the secondary=%s pane',
    (secondary) => {
      const editor = document.createElement('writemd-editor') as Editor
      const access = editor as unknown as {
        editorView: EditorView
        secondaryEditorView: EditorView
        filePath: string
        secondaryDoc: { path: string }
        handleTextMenu: (event: MouseEvent, secondary: boolean) => void
        textMenu: { selection: { text: string; from: number; to: number; path: string } }
      }
      access.editorView = view('A car is parked.', 2, 5)
      access.secondaryEditorView = view('A boat is moored.', 2, 6)
      access.filePath = 'C:/vault/primary.md'
      access.secondaryDoc = { path: 'C:/vault/secondary.md' }
      access.handleTextMenu(new MouseEvent('contextmenu', { clientX: 20, clientY: 30 }), secondary)
      expect(access.textMenu.selection).toEqual({
        text: secondary ? 'boat' : 'car',
        from: 2,
        to: secondary ? 6 : 5,
        path: secondary ? 'C:/vault/secondary.md' : 'C:/vault/primary.md'
      })
    }
  )
})
