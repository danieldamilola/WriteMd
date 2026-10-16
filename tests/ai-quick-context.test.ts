import { describe, expect, it } from 'vitest'
import {
  quickAiReplacement,
  type QuickAiContext
} from '../src/renderer/src/components/ai/quick-context'

const context: QuickAiContext = {
  path: '/vault/Note.md',
  content: 'A car is red.',
  selection: { from: 2, to: 5, text: 'car' }
}

describe('quick AI edit review', () => {
  it('replaces only the captured selection', () => {
    expect(
      quickAiReplacement(context, {
        path: '/vault/Note.md',
        original: 'car',
        content: 'vehicle',
        kind: 'modified'
      })
    ).toBe('A vehicle is red.')
  })

  it('rejects a stale selection, a different path, or a proposal for other text', () => {
    expect(
      quickAiReplacement(
        { ...context, content: 'A truck is red.' },
        { path: '/vault/Note.md', original: 'car', content: 'vehicle', kind: 'modified' }
      )
    ).toBeNull()
    expect(
      quickAiReplacement(context, {
        path: '/vault/Other.md',
        original: 'car',
        content: 'vehicle',
        kind: 'modified'
      })
    ).toBeNull()
    expect(
      quickAiReplacement(context, {
        path: '/vault/Note.md',
        original: 'bicycle',
        content: 'vehicle',
        kind: 'modified'
      })
    ).toBeNull()
  })

  it('accepts a whole-note replacement only when it matches the captured snapshot', () => {
    expect(
      quickAiReplacement(
        { path: context.path, content: context.content, selection: null },
        {
          path: context.path!,
          original: context.content,
          content: 'A vehicle is red.',
          kind: 'modified'
        }
      )
    ).toBe('A vehicle is red.')
    expect(
      quickAiReplacement(
        { path: context.path, content: context.content, selection: null },
        {
          path: context.path!,
          original: 'old copy',
          content: 'A vehicle is red.',
          kind: 'modified'
        }
      )
    ).toBeNull()
  })
})
