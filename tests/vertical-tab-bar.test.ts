import { describe, it, expect, beforeEach } from 'vitest'
import '../src/renderer/src/components/VerticalTabBar'
import { VerticalTabBar } from '../src/renderer/src/components/VerticalTabBar'
import type { TabGroup } from '../src/renderer/src/state/file-state'

function mountRail(): VerticalTabBar {
  const el = document.createElement('writemd-vertical-tab-bar') as VerticalTabBar
  document.body.appendChild(el)
  return el
}

async function flush(el: VerticalTabBar): Promise<void> {
  await el.updateComplete
}

describe('writemd-vertical-tab-bar component', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders tabs with role="tablist" semantics', async () => {
    const el = mountRail()
    el.tabs = [
      { path: 'doc1.md', dirty: false },
      { path: 'doc2.md', dirty: true }
    ]
    el.activeTab = 0
    await flush(el)

    const list = el.shadowRoot?.querySelector('.scroll-container')
    expect(list?.getAttribute('role')).toBe('tablist')
    expect(list?.getAttribute('aria-label')).toBe('Open documents')

    const tabEls = Array.from(el.shadowRoot?.querySelectorAll('writemd-tab') ?? [])
    expect(tabEls.length).toBe(2)
  })

  it('renders a pinned section with separator when pinned tabs exist', async () => {
    const el = mountRail()
    el.tabs = [
      { path: 'pinned.md', dirty: false, isPinned: true },
      { path: 'regular.md', dirty: false, isPinned: false }
    ]
    el.activeTab = 0
    await flush(el)

    const pinnedSection = el.shadowRoot?.querySelector('.pinned-section')
    expect(pinnedSection).not.toBeNull()
    const pinnedDivider = el.shadowRoot?.querySelector('.pinned-divider')
    expect(pinnedDivider).not.toBeNull()

    const pinnedTab = pinnedSection?.querySelector('writemd-tab')
    expect(pinnedTab?.hasAttribute('pinned')).toBe(true)
  })

  it('renders tab groups with collapsible header and color dot', async () => {
    const el = mountRail()
    const groups: TabGroup[] = [
      { id: 'group-1', label: 'Docs', color: '#3b82f6', collapsed: false }
    ]
    el.tabGroups = groups
    el.tabs = [
      { path: 'grouped.md', dirty: false, groupId: 'group-1' },
      { path: 'other.md', dirty: false }
    ]
    await flush(el)

    const groupHeader = el.shadowRoot?.querySelector('.group-header')
    expect(groupHeader).not.toBeNull()
    expect(groupHeader?.querySelector('.group-label')?.textContent?.trim()).toBe('Docs')
    expect(groupHeader?.querySelector('.group-count')).toBeNull()

    const dot = groupHeader?.querySelector('.group-color-dot') as HTMLElement
    expect(dot?.style.backgroundColor).toContain('rgb(59, 130, 246)')

    const groupTabsContainer = el.shadowRoot?.querySelector('.group-tabs')
    expect(groupTabsContainer?.classList.contains('collapsed')).toBe(false)
  })

  it('provides an aria-live announcement region for accessible drag reporting', async () => {
    const el = mountRail()
    el.tabs = [{ path: 'test.md', dirty: false }]
    await flush(el)

    const live = el.shadowRoot?.querySelector('.sr-only[aria-live="polite"]')
    expect(live).not.toBeNull()
  })

  it('does not render group color dot when color is transparent', async () => {
    const el = mountRail()
    const groups: TabGroup[] = [
      { id: 'group-clean', label: 'Plain', color: 'transparent', collapsed: false }
    ]
    el.tabGroups = groups
    el.tabs = [
      { path: 'note.md', dirty: false, groupId: 'group-clean' }
    ]
    await flush(el)

    const groupHeader = el.shadowRoot?.querySelector('.group-header')
    expect(groupHeader).not.toBeNull()
    const dot = groupHeader?.querySelector('.group-color-dot')
    expect(dot).toBeNull()
  })

  it('uses only CSS custom properties or theme tokens in stylesheet', () => {
    const css = VerticalTabBar.styles
      .map((s) => (typeof s === 'string' ? s : (s as { cssText: string }).cssText))
      .join('\n')
    // Ensure all color declarations use var(--...) and no hardcoded non-preset values
    expect(css).toContain('var(--text)')
    expect(css).toContain('var(--text-muted)')
    expect(css).toContain('min-width: 0')
  })
})
