import { describe, expect, it, vi } from 'vitest'
import { WriteMdTopBar } from '../src/renderer/src/components/TopBar'
import '../src/renderer/src/components/TopBar'

describe('horizontal assistant toolbar action', () => {
  it('uses the shared AI icon, exposes toggle state, and opens the assistant', async () => {
    const bar = document.createElement('writemd-top-bar') as WriteMdTopBar
    bar.showAiButton = true
    bar.aiOpen = true
    document.body.appendChild(bar)
    await bar.updateComplete
    const button = bar.shadowRoot!.querySelector<HTMLElement>('.right-group .assistant')!
    expect(button).not.toBeNull()
    expect(button.getAttribute('title')).toBe('AI assistant')
    expect(button.querySelector('svg')?.getAttribute('data-icon')).toBe('ai')
    const toggled = vi.fn()
    bar.addEventListener('toggle-ai', toggled)
    button.click()
    expect(toggled).toHaveBeenCalledOnce()
    expect(button.getAttribute('aria-pressed')).toBe('true')
    bar.settingsOpen = true
    await bar.updateComplete
    expect(bar.shadowRoot!.querySelector('.assistant')).toBeNull()
    bar.settingsOpen = false
    bar.showAiButton = false
    await bar.updateComplete
    expect(bar.shadowRoot!.querySelector('.assistant')).toBeNull()
  })
})
