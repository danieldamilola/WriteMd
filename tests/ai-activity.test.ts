import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiDock } from '../src/renderer/src/components/ai/AiDock'
import '../src/renderer/src/components/ai/AiDock'
import type { AiEvent } from '../src/renderer/src/components/ai/types'

let emit: (event: AiEvent) => void
async function settle(dock: AiDock): Promise<void> {
  await dock.updateComplete
  await new Promise((resolve) => setTimeout(resolve, 0))
  await dock.updateComplete
}

describe('AI activity icon', () => {
  beforeEach(() => {
    window.electronAPI = {
      ai: {
        send: vi.fn(async () => undefined),
        cancel: vi.fn(async () => undefined),
        listSessions: vi.fn(async () => []),
        listChanges: vi.fn(async () => []),
        saveSession: vi.fn(async () => undefined),
        onEvent: (callback: (event: AiEvent) => void) => {
          emit = callback
          return () => undefined
        }
      },
      vault: { getPath: async () => 'C:/vault' },
      file: { onChanged: () => () => undefined }
    } as unknown as NonNullable<Window['electronAPI']>
  })
  afterEach(() => {
    delete window.electronAPI
  })

  it.each(['done', 'error', 'cancel'] as const)(
    'stops thinking when the request ends with %s',
    async (ending) => {
      const dock = document.createElement('writemd-ai-dock')
      document.body.append(dock)
      await settle(dock)
      const composer = dock.shadowRoot!.querySelector('writemd-ai-composer')!
      composer.dispatchEvent(
        new CustomEvent('composer-send', {
          detail: { text: 'Explain this idea', attachments: [] },
          bubbles: true,
          composed: true
        })
      )
      await settle(dock)
      const requestId = dock.turns.requestId!
      expect(dock.shadowRoot!.querySelector('[data-icon="ai-thinking"]')).not.toBeNull()
      expect(
        dock.shadowRoot!.querySelector('[data-artwork="label"] .writemd-ai-thinking-text')
          ?.textContent
      ).toBe('Thinking...')
      expect(dock.shadowRoot!.querySelector('.assistant .role')).toBeNull()
      expect(dock.shadowRoot!.querySelector('.bubble.idle')).toBeNull()
      emit({ type: 'status', requestId, message: 'Searching the web…' })
      await settle(dock)
      expect(dock.shadowRoot!.querySelector('[data-icon="ai-thinking"]')).not.toBeNull()
      emit({ type: 'text', requestId, delta: 'An explanation.' })
      await settle(dock)
      expect(dock.shadowRoot!.querySelector('[data-icon="ai-thinking"]')).toBeNull()
      expect(dock.shadowRoot!.querySelector('.assistant .role')).toBeNull()
      if (ending === 'done') emit({ type: 'done', requestId, text: 'An explanation.' })
      else if (ending === 'error')
        emit({ type: 'error', requestId, message: 'Provider disconnected' })
      else dock.turns.cancel()
      await settle(dock)
      expect(dock.shadowRoot!.querySelector('[data-icon="ai-thinking"]')).toBeNull()
      expect(dock.shadowRoot!.querySelector('.assistant svg[data-icon]')).toBeNull()
    }
  )
})
