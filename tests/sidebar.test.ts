import { describe, it, expect, beforeEach } from 'vitest'
import '../src/renderer/src/components/Sidebar'
import { Sidebar } from '../src/renderer/src/components/Sidebar'

function mount(collapsed = false): Sidebar {
  const el = document.createElement('writemd-sidebar') as Sidebar
  el.collapsed = collapsed
  document.body.appendChild(el)
  return el
}

describe('writemd-sidebar panel', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('has no brand heading and no Documents/Files toggle', async () => {
    const el = mount()
    await el.updateComplete
    const text = el.shadowRoot?.textContent ?? ''
    expect(text).not.toContain('WriteMd')
    expect(text).not.toContain('Documents')
    expect(el.shadowRoot?.querySelector('[role="tablist"]')).toBeNull()
    expect(el.shadowRoot?.querySelector('.tabs')).toBeNull()
    expect(el.shadowRoot?.querySelector('.heading')).toBeNull()
  })

  it('opens the command palette from the shared search bar', async () => {
    const el = mount()
    await el.updateComplete
    const search = el.shadowRoot?.querySelector('writemd-search-bar')
    expect(search).not.toBeNull()
    expect(search?.getAttribute('kbd')).toBe('Ctrl+K')
    const opened = new Promise<Event>((resolve) => el.addEventListener('open-menu', resolve))
    const inner = search?.shadowRoot?.querySelector('button')
    expect(inner).not.toBeNull()
    ;(inner as HTMLButtonElement).click()
    await opened
  })

  it('collapses the panel from its own icon', async () => {
    const el = mount()
    await el.updateComplete
    const toggle = el.shadowRoot?.querySelector('writemd-icon-button[title="Collapse panel"]')
    expect(toggle).not.toBeNull()
    const toggled = new Promise<Event>((resolve) => el.addEventListener('toggle-panel', resolve))
    ;(toggle as HTMLElement).click()
    await toggled
  })

  it('offers New note and Open file as icon-only buttons', async () => {
    const el = mount()
    await el.updateComplete
    for (const [name, event] of [
      ['New note', 'new-file'],
      ['Open file', 'open-file']
    ] as const) {
      const button = el.shadowRoot?.querySelector(`.actions writemd-icon-button[title="${name}"]`)
      expect(button).not.toBeNull()
      const seen = new Promise<Event>((resolve) => el.addEventListener(event, resolve))
      ;(button as HTMLElement).click()
      await seen
    }
  })

  it('keeps the footer shortcuts as text rows', async () => {
    const el = mount()
    await el.updateComplete
    expect(el.shadowRoot?.querySelector('.footer')?.firstElementChild?.tagName).toBe(
      'WRITEMD-UPDATE-BUTTON'
    )
    for (const [label, event] of [
      ['AI', 'open-ai'],
      ['Settings', 'open-settings']
    ] as const) {
      const buttons = Array.from(
        el.shadowRoot?.querySelectorAll('.footer button') ?? []
      ) as HTMLButtonElement[]
      const target = buttons.find((b) => b.textContent?.includes(label))
      const seen = new Promise<Event>((resolve) => el.addEventListener(event, resolve))
      target?.click()
      await seen
    }
  })

  it('collapses to a slim strip holding only the expand button', async () => {
    const el = mount(true)
    await el.updateComplete
    const buttons = Array.from(el.shadowRoot?.querySelectorAll('writemd-icon-button') ?? [])
    expect(buttons.map((b) => b.getAttribute('title'))).toEqual(['Expand panel'])
    const toggled = new Promise<Event>((resolve) => el.addEventListener('toggle-panel', resolve))
    ;(buttons[0] as HTMLElement).click()
    await toggled
  })

  it('shows home and vault navigation without enabling document AI actions on home', async () => {
    const element = mount()
    element.welcome = true
    await element.updateComplete
    expect(element.shadowRoot!.querySelector('[aria-current="page"]')!.textContent).toContain(
      'Home'
    )
    const vault = element.shadowRoot!.querySelector<HTMLButtonElement>('.home-nav button')!
    const opened = new Promise<Event>((resolve) => element.addEventListener('open-vault', resolve))
    vault.click()
    await opened
    const ai = element.shadowRoot!.querySelector<HTMLButtonElement>('.footer button')!
    expect(ai.disabled).toBe(true)
    expect(ai.title).toBe('Open a note to use AI Assistant')
    element.welcome = false
    await element.updateComplete
    expect(element.shadowRoot!.querySelector<HTMLButtonElement>('.footer button')!.disabled).toBe(
      false
    )
  })
})
