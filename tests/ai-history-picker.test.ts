import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiHistoryPicker } from '../src/renderer/src/components/ai/HistoryPicker'
import '../src/renderer/src/components/ai/HistoryPicker'
import type { ContextMenu } from '../src/renderer/src/components/ContextMenu'

async function settle(element: AiHistoryPicker): Promise<void> {
  await element.updateComplete
  await element.shadowRoot?.querySelector<ContextMenu>('writemd-context-menu')?.updateComplete
  await new Promise((resolve) => setTimeout(resolve, 0))
  await element.updateComplete
}

async function mount(): Promise<AiHistoryPicker> {
  const element = document.createElement('writemd-ai-history-picker')
  element.sessions = [
    { id: 'current', title: 'New chat', createdAt: 1, updatedAt: 1 },
    { id: 'saved', title: 'Draft outline', createdAt: 2, updatedAt: 2 }
  ]
  element.currentId = 'current'
  document.body.append(element)
  await settle(element)
  return element
}

function trigger(element: AiHistoryPicker): HTMLButtonElement {
  return element.shadowRoot!.querySelector<HTMLButtonElement>('.icon')!
}

async function open(element: AiHistoryPicker): Promise<void> {
  trigger(element).click()
  await settle(element)
}

describe('chat history picker', () => {
  afterEach(() => document.body.replaceChildren())

  it('uses the shared menu and marks the current conversation', async () => {
    const element = await mount()
    await open(element)
    expect(trigger(element).getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger(element).getAttribute('aria-expanded')).toBe('true')
    expect(element.shadowRoot!.querySelector('.m-panel')?.getAttribute('role')).toBe('menu')
    const current = element.shadowRoot!.querySelector('[aria-current="true"]')!
    expect(current.textContent?.trim()).toBe('New chat')
    expect(current.querySelector('.m-check')).not.toBeNull()
    expect(element.shadowRoot!.querySelectorAll('[role="menuitem"]')).toHaveLength(2)
  })

  it('dispatches the selected session and restores focus to its trigger', async () => {
    const element = await mount()
    const listener = vi.fn()
    document.body.addEventListener('session-pick', listener)
    await open(element)
    element.shadowRoot!.querySelector<HTMLButtonElement>('[title="Draft outline"]')!.click()
    await settle(element)
    expect(listener).toHaveBeenCalledOnce()
    const event = listener.mock.calls[0][0] as CustomEvent<{ id: string }>
    expect(event.detail).toEqual({ id: 'saved' })
    expect(event.composed).toBe(true)
    expect(element.shadowRoot!.querySelector('writemd-context-menu')).toBeNull()
    expect(element.shadowRoot!.activeElement).toBe(trigger(element))
    document.body.removeEventListener('session-pick', listener)
  })

  it('delegates Escape dismissal and focus restoration to the shared menu', async () => {
    const element = await mount()
    await open(element)
    expect(element.shadowRoot!.activeElement?.getAttribute('title')).toBe('New chat')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle(element)
    expect(element.shadowRoot!.querySelector('writemd-context-menu')).toBeNull()
    expect(trigger(element).getAttribute('aria-expanded')).toBe('false')
    expect(element.shadowRoot!.activeElement).toBe(trigger(element))
  })

  it('dismisses on outside interaction without stealing outside focus', async () => {
    const element = await mount()
    const outside = document.createElement('button')
    document.body.append(outside)
    await open(element)
    outside.focus()
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }))
    await settle(element)
    expect(element.shadowRoot!.querySelector('writemd-context-menu')).toBeNull()
    expect(document.activeElement).toBe(outside)
  })

  it('uses the shared arrow and Enter navigation to choose a conversation', async () => {
    const element = await mount()
    const listener = vi.fn()
    element.addEventListener('session-pick', listener)
    await open(element)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(element.shadowRoot!.activeElement?.getAttribute('title')).toBe('Draft outline')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle(element)
    expect((listener.mock.calls[0][0] as CustomEvent<{ id: string }>).detail.id).toBe('saved')
  })
})
