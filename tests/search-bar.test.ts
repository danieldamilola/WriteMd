import { describe, it, expect, beforeEach } from 'vitest'
import '../src/renderer/src/components/SearchBar'
import { SearchBar } from '../src/renderer/src/components/SearchBar'

function mount(filter = false): SearchBar {
  const el = document.createElement('writemd-search-bar') as SearchBar
  el.filter = filter
  document.body.appendChild(el)
  return el
}

describe('writemd-search-bar', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('opens the palette from the launcher button', async () => {
    const el = mount()
    await el.updateComplete
    const button = el.shadowRoot?.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Search')
    const activated = new Promise<Event>((resolve) =>
      el.addEventListener('search-activate', resolve)
    )
    button?.click()
    await activated
  })

  it('shows the shortcut hint when one is given', async () => {
    const el = mount()
    el.setAttribute('kbd', 'Ctrl+K')
    await el.updateComplete
    expect(el.shadowRoot?.querySelector('kbd')?.textContent).toBe('Ctrl+K')
  })

  it('emits the query text while filtering', async () => {
    const el = mount(true)
    await el.updateComplete
    const input = el.shadowRoot?.querySelector('input')
    expect(input).not.toBeNull()
    const seen = new Promise<CustomEvent<{ query: string }>>((resolve) =>
      el.addEventListener('search-query', resolve as EventListener)
    )
    input!.value = 'theme'
    input!.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }))
    const event = await seen
    expect(event.detail.query).toBe('theme')
  })

  it('forwards match-stepping keys without typing them', async () => {
    const el = mount(true)
    await el.updateComplete
    const input = el.shadowRoot?.querySelector('input')
    const seen = new Promise<CustomEvent<{ key: string }>>((resolve) =>
      el.addEventListener('search-navigate', resolve as EventListener)
    )
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    const event = await seen
    expect(event.detail.key).toBe('ArrowDown')
  })

  it('ignores other keys for navigation', async () => {
    const el = mount(true)
    await el.updateComplete
    let fired = false
    el.addEventListener('search-navigate', () => (fired = true))
    const input = el.shadowRoot?.querySelector('input')
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    await el.updateComplete
    expect(fired).toBe(false)
  })
})
