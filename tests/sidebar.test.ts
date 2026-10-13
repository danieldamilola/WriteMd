import { describe, it, expect, beforeEach } from 'vitest'
import '../src/renderer/src/components/Sidebar'
import { Sidebar } from '../src/renderer/src/components/Sidebar'
import type { WriteMdIconButton } from '../src/renderer/src/components/IconButton'

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

  it('offers New note, Open file and New group as icon-only buttons', async () => {
    const el = mount()
    await el.updateComplete
    for (const [name, event] of [
      ['New note', 'new-file'],
      ['Open file', 'open-file'],
      ['New group', 'new-group']
    ] as const) {
      const button = el.shadowRoot?.querySelector(`.actions writemd-icon-button[title="${name}"]`)
      expect(button).not.toBeNull()
      const seen = new Promise<Event>((resolve) => el.addEventListener(event, resolve))
      ;(button as HTMLElement).click()
      await seen
    }
  })

  it('disables New group on home, where there are no tabs to group', async () => {
    const el = mount()
    el.welcome = true
    await el.updateComplete
    const group = el.shadowRoot?.querySelector<HTMLElement>(
      '.actions writemd-icon-button[title="New group"]'
    )
    expect((group as WriteMdIconButton).disabled).toBe(true)
    expect(group?.shadowRoot?.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true)
    el.welcome = false
    await el.updateComplete
    expect(
      (
        el.shadowRoot?.querySelector<HTMLElement>(
          '.actions writemd-icon-button[title="New group"]'
        ) as WriteMdIconButton
      ).disabled
    ).toBe(false)
  })

  it('keeps Settings as an icon-only footer shortcut', async () => {
    const el = mount()
    await el.updateComplete
    expect(el.shadowRoot?.querySelector('.footer')?.firstElementChild?.tagName).toBe(
      'WRITEMD-UPDATE-BUTTON'
    )
    const button = el.shadowRoot!.querySelector<HTMLElement>(
      '.footer-actions writemd-icon-button[title="Settings"]'
    )!
    expect(button.textContent?.trim()).toBe('')
    const seen = new Promise<Event>((resolve) => el.addEventListener('open-settings', resolve))
    button.click()
    await seen
  })

  it.each([false, true])(
    'offers AI beside Settings in expanded mode and above it in collapsed mode (%s)',
    async (collapsed) => {
      const el = mount(collapsed)
      el.aiEnabled = true
      el.aiOpen = true
      await el.updateComplete
      const container = el.shadowRoot!.querySelector(
        collapsed ? '.slim-bottom' : '.footer-actions'
      )!
      const buttons = Array.from(container.querySelectorAll('writemd-icon-button'))
      expect(buttons.map((button) => button.getAttribute('title'))).toEqual(
        collapsed ? ['AI assistant', 'Settings'] : ['Settings', 'AI assistant']
      )
      const assistant = container.querySelector<HTMLElement>('[title="AI assistant"]')!
      expect(assistant.querySelector('svg')?.getAttribute('data-icon')).toBe('ai')
      expect(assistant.getAttribute('aria-pressed')).toBe('true')
      await (assistant as WriteMdIconButton).updateComplete
      expect(assistant.shadowRoot!.querySelector('button')!.getAttribute('aria-pressed')).toBe(
        'true'
      )
      const seen = new Promise<Event>((resolve) => el.addEventListener('toggle-ai', resolve))
      assistant.click()
      await seen
      el.aiEnabled = false
      await el.updateComplete
      expect(el.shadowRoot!.querySelector('[title="AI assistant"]')).toBeNull()
    }
  )

  it('collapses to a slim strip holding expand, one icon per group, and settings', async () => {
    const el = mount(true)
    await el.updateComplete
    const buttons = Array.from(el.shadowRoot?.querySelectorAll('writemd-icon-button') ?? [])
    expect(buttons.map((b) => b.getAttribute('title'))).toEqual(['Expand panel', 'Settings'])
    const toggled = new Promise<Event>((resolve) => el.addEventListener('toggle-panel', resolve))
    ;(buttons[0] as HTMLElement).click()
    await toggled
  })

  it('keeps one icon per group in the collapsed strip', async () => {
    // Collapsing used to hide the folders entirely, so the strip showed only
    // expand and settings and every group vanished with the panel.
    const el = mount(true)
    el.tabGroups = [
      { id: 'g1', label: 'Youtube', icon: 'star', collapsed: false },
      { id: 'g2', label: 'Stride', icon: 'code', collapsed: true }
    ]
    await el.updateComplete
    const groups = Array.from(el.shadowRoot!.querySelectorAll('.slim-group'))
    expect(groups.map((g) => g.getAttribute('title'))).toEqual(['Youtube', 'Stride'])
    // The row icon, so the strip matches what the panel shows.
    expect(groups[0].querySelector('svg')?.getAttribute('data-icon')).toBe('star')
    expect(groups[1].querySelector('svg')?.getAttribute('data-icon')).toBe('code')
  })

  it('asks the app to open the group whose icon was clicked', async () => {
    const el = mount(true)
    el.tabGroups = [{ id: 'g1', label: 'Youtube', icon: 'star', collapsed: false }]
    await el.updateComplete
    const seen = new Promise<CustomEvent>((resolve) =>
      el.addEventListener('open-group', (e) => resolve(e as CustomEvent))
    )
    ;(el.shadowRoot!.querySelector('.slim-group') as HTMLElement).click()
    expect((await seen).detail).toEqual({ groupId: 'g1' })
  })

  it('keeps settings reachable from the collapsed strip', async () => {
    // Settings used to live only in the expanded footer, so hiding the panel
    // took it with it and the only route back was to expand the strip first.
    const el = mount(true)
    await el.updateComplete
    const settings = el.shadowRoot!.querySelector<HTMLElement>('.slim-bottom writemd-icon-button')
    expect(settings).not.toBeNull()
    const seen = new Promise<Event>((resolve) => el.addEventListener('open-settings', resolve))
    settings!.click()
    await expect(seen).resolves.toBeTruthy()
  })

  it('shows Nothing without redundant home or vault navigation', async () => {
    const element = mount()
    element.welcome = true
    await element.updateComplete
    expect(element.shadowRoot!.querySelector('.home-hint')!.textContent).toBe('Nothing')
    expect(element.shadowRoot!.querySelector('nav, [aria-current="page"]')).toBeNull()
    expect(element.shadowRoot!.textContent).not.toContain('Vault folder')
    element.welcome = false
    await element.updateComplete
    expect(element.shadowRoot!.querySelector('.home-hint')).toBeNull()
    expect(element.shadowRoot!.querySelector('slot')).not.toBeNull()
  })
})
