import { describe, expect, it, vi } from 'vitest'
import { Editor } from '../src/renderer/src/components/Editor'
import '../src/renderer/src/components/Editor'
import { WorkspaceState } from '../src/renderer/src/state/workspace'

interface ResizeEditor {
  aiAvailable: number
  aiDockWidth: number
  beginAiResize: (event: PointerEvent) => void
  moveAiResize: (event: PointerEvent) => void
  finishAiResize: (event: PointerEvent) => void
}

function pointer(type: string, x: number): PointerEvent {
  const event = new MouseEvent(type, { button: 0, clientX: x })
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    currentTarget: { value: { setPointerCapture: vi.fn() } }
  })
  return event as PointerEvent
}

function editor(): ResizeEditor {
  const instance = document.createElement('writemd-editor') as Editor
  const resize = instance as unknown as ResizeEditor
  resize.aiAvailable = 1000
  resize.aiDockWidth = 376
  return resize
}

describe('assistant pointer resize completion', () => {
  it('uses the release coordinate when the final movement event is coalesced', () => {
    const resize = editor()
    const save = vi.spyOn(WorkspaceState.getInstance(), 'resizeAiDock').mockImplementation(() => {})
    resize.beginAiResize(pointer('pointerdown', 700))
    resize.moveAiResize(pointer('pointermove', 650))
    expect(resize.aiDockWidth).toBe(426)
    resize.finishAiResize(pointer('pointerup', 620))
    expect(resize.aiDockWidth).toBe(456)
    expect(save).toHaveBeenCalledExactlyOnceWith(456)
  })

  it('restores the saved preference on cancellation and ignores later lost capture', () => {
    const resize = editor()
    const save = vi.spyOn(WorkspaceState.getInstance(), 'resizeAiDock').mockImplementation(() => {})
    resize.beginAiResize(pointer('pointerdown', 700))
    resize.moveAiResize(pointer('pointermove', 650))
    resize.finishAiResize(pointer('pointercancel', 620))
    expect(resize.aiDockWidth).toBe(376)
    resize.finishAiResize(pointer('lostpointercapture', 620))
    expect(save).not.toHaveBeenCalled()
  })
})
