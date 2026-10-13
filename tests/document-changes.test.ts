import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { documentChanges, previewChanges } from '../src/renderer/src/utils/document-changes'

describe('incoming document changes', () => {
  it('appends to a large document without replacing its existing text or moving its selection', () => {
    const original = '# Long note\n\n' + 'Unchanged paragraph.\n\n'.repeat(6000)
    const content = original + '[[Related note]]\n'
    const changes = documentChanges(original, content)
    expect(changes).toEqual([
      { from: original.length, to: original.length, insert: '[[Related note]]\n' }
    ])
    const state = EditorState.create({ doc: original, selection: { anchor: 100, head: 120 } })
    const updated = state.update({ changes }).state
    expect(updated.doc.toString()).toBe(content)
    expect(updated.selection).toEqual(state.selection)
    expect(previewChanges(original, content)).toEqual([
      { original: '', content: '[[Related note]]\n' }
    ])
  })

  it('changes separate paragraphs while preserving the text and cursor between them', () => {
    const original =
      'First old paragraph.\n\n' + 'Keep this passage.\n'.repeat(20) + '\nLast old paragraph.'
    const content = original.replaceAll('old', 'new')
    const changes = documentChanges(original, content)
    expect(changes).toHaveLength(2)
    const state = EditorState.create({ doc: original, selection: { anchor: 150 } })
    const updated = state.update({ changes }).state
    expect(updated.doc.toString()).toBe(content)
    expect(updated.selection.main.anchor).toBe(150)
    expect(
      previewChanges(original, content)
        .map((change) => change.original)
        .join('')
    ).not.toContain('Keep this passage')
  })

  it('applies full rewrites, empty drafts, deletions, and Unicode edits exactly', () => {
    for (const [original, content] of [
      ['', '# Draft\n\nNew text.'],
      ['Old text', ''],
      ['Old document', '# Entirely revised\n\nDifferent content.'],
      ['Hello 👋, world!', 'Hello 🌍, world!']
    ]) {
      const state = EditorState.create({ doc: original })
      expect(
        state.update({ changes: documentChanges(original, content) }).state.doc.toString()
      ).toBe(content)
    }
  })
})
