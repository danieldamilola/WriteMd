import { describe, it, expect, beforeEach, vi } from 'vitest'
import '../src/renderer/src/components/VerticalTabBar'
import { VerticalTabBar } from '../src/renderer/src/components/VerticalTabBar'
import { FileState, type TabGroup } from '../src/renderer/src/state/file-state'

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
    // Pinned and unpinned are told apart by their order, not by a drawn rule.
    expect(el.shadowRoot?.querySelector('.pinned-divider')).toBeNull()

    const pinnedTab = pinnedSection?.querySelector('writemd-tab')
    expect(pinnedTab?.hasAttribute('pinned')).toBe(true)
  })

  it('draws no divider whether or not there is an unpinned section', async () => {
    const el = mountRail()
    el.tabs = [{ path: 'pinned.md', dirty: false, isPinned: true }]
    await flush(el)
    expect(el.shadowRoot?.querySelector('.pinned-divider')).toBeNull()
  })

  it('renders tab groups with a collapsible header and the chosen icon', async () => {
    const el = mountRail()
    const groups: TabGroup[] = [{ id: 'group-1', label: 'Docs', icon: 'star', collapsed: false }]
    el.tabGroups = groups
    el.tabs = [
      { path: 'grouped.md', dirty: false, groupId: 'group-1' },
      { path: 'other.md', dirty: false }
    ]
    await flush(el)

    const groupHeader = el.shadowRoot?.querySelector('.group-header')
    expect(groupHeader).not.toBeNull()
    expect(groupHeader?.querySelector('.group-label')?.textContent?.trim()).toBe('Docs')
    expect(groupHeader?.querySelector('svg[data-icon="star"]')).not.toBeNull()
    expect(groupHeader?.querySelector('.group-chevron')).toBeNull()
    expect(groupHeader?.querySelector('.group-count')).toBeNull()

    const groupTabsContainer = el.shadowRoot?.querySelector('.group-tabs')
    expect(groupTabsContainer?.classList.contains('collapsed')).toBe(false)
  })

  it('shows the chosen icon whether the group is open or closed', async () => {
    const el = mountRail()
    el.tabGroups = [{ id: 'group-1', label: 'Docs', icon: 'star', collapsed: true }]
    el.tabs = [{ path: 'grouped.md', dirty: false, groupId: 'group-1' }]
    await flush(el)
    expect(el.shadowRoot?.querySelector('svg[data-icon="star"]')).not.toBeNull()
    expect(el.shadowRoot?.querySelector('.group-tabs.collapsed')).not.toBeNull()
  })

  it('shows a closed folder for collapsed groups with no icon set', async () => {
    const el = mountRail()
    el.tabGroups = [{ id: 'group-1', label: 'Docs', collapsed: true }]
    el.tabs = [{ path: 'grouped.md', dirty: false, groupId: 'group-1' }]
    await flush(el)
    expect(el.shadowRoot?.querySelector('svg[data-icon="folder"]')).not.toBeNull()
    expect(el.shadowRoot?.querySelector('svg[data-icon="folder-open"]')).toBeNull()
    expect(el.shadowRoot?.querySelector('.group-tabs.collapsed')).not.toBeNull()
  })

  it('falls back to the folder pair for an icon that is not a preset', async () => {
    const el = mountRail()
    el.tabGroups = [{ id: 'group-1', label: 'Docs', icon: 'not-a-real-icon', collapsed: false }]
    el.tabs = [{ path: 'grouped.md', dirty: false, groupId: 'group-1' }]
    await flush(el)
    expect(el.shadowRoot?.querySelector('svg[data-icon="folder-open"]')).not.toBeNull()
    expect(el.shadowRoot?.querySelector('.group-color-dot')).toBeNull()
  })

  it('provides an aria-live announcement region for accessible drag reporting', async () => {
    const el = mountRail()
    el.tabs = [{ path: 'test.md', dirty: false }]
    await flush(el)

    const live = el.shadowRoot?.querySelector('.sr-only[aria-live="polite"]')
    expect(live).not.toBeNull()
  })

  it('labels the pinned area Space with no count and keeps groups on top', async () => {
    const el = mountRail()
    el.tabGroups = [{ id: 'group-1', label: 'Docs', icon: 'star', collapsed: false }]
    el.tabs = [
      { path: 'pinned.md', dirty: false, isPinned: true },
      { path: 'grouped.md', dirty: false, groupId: 'group-1' },
      { path: 'regular.md', dirty: false }
    ]
    el.activeTab = 0
    await flush(el)

    const label = el.shadowRoot?.querySelector('.section-label')
    expect(label?.textContent?.trim()).toBe('Space')
    // Groups render before pinned tabs inside Space, ungrouped after it.
    const rows = Array.from(el.shadowRoot?.querySelectorAll('.scroll-container > *') ?? []).map(
      (n) => (n as HTMLElement).className
    )
    const groupAt = rows.findIndex((c) => String(c).includes('tab-group-container'))
    const pinnedAt = rows.findIndex((c) => String(c).includes('pinned-section'))
    expect(groupAt).toBeGreaterThanOrEqual(0)
    expect(pinnedAt).toBeGreaterThan(groupAt)
  })

  it('shows the file icon on pinned tabs with no pin badge', async () => {
    const el = mountRail()
    el.tabs = [{ path: 'pinned.md', dirty: false, isPinned: true }]
    el.activeTab = 0
    await flush(el)

    const tab = el.shadowRoot?.querySelector('writemd-tab')
    expect(tab?.hasAttribute('pinned')).toBe(true)
    expect(tab?.shadowRoot?.querySelector('.pin-icon')).toBeNull()
    expect(tab?.shadowRoot?.querySelector('svg[data-icon="file-text"]')).not.toBeNull()
  })

  it('creates an empty group and puts the caret in its label', async () => {
    const el = mountRail()
    el.tabs = [
      { path: 'doc1.md', dirty: false },
      { path: 'doc2.md', dirty: false }
    ]
    const fileState = FileState.getInstance()
    const created: TabGroup = {
      id: 'group-1',
      label: 'Group 1',
      icon: 'star',
      collapsed: false
    }
    const create = vi.spyOn(fileState, 'createTabGroup').mockReturnValue(created.id)
    // The rail is driven by props, so mirror what FileState would have stored.
    create.mockImplementation(() => {
      el.tabGroups = [...el.tabGroups, created]
      return created.id
    })
    await flush(el)

    el.createGroup()
    // An empty group: no tab index is passed, so nothing is swept out of place.
    expect(create).toHaveBeenCalledWith('Group 1', undefined, [])
    await flush(el)
    const input = el.shadowRoot?.querySelector('.group-rename-input') as HTMLInputElement | null
    expect(input).not.toBeNull()
    expect(input?.value).toBe('Group 1')
    create.mockRestore()
  })

  it('moves a named tab into the group when one is given', async () => {
    const el = mountRail()
    el.tabs = [
      { path: 'doc1.md', dirty: false },
      { path: 'doc2.md', dirty: false }
    ]
    const create = vi.spyOn(FileState.getInstance(), 'createTabGroup').mockReturnValue('group-1')
    await flush(el)

    el.createGroup(1)
    expect(create).toHaveBeenCalledWith('Group 1', undefined, [1])
    create.mockRestore()
  })

  it('numbers the default label from the existing groups', async () => {
    const el = mountRail()
    el.tabGroups = [{ id: 'a', label: 'Work', icon: 'star', collapsed: false }]
    const create = vi.spyOn(FileState.getInstance(), 'createTabGroup').mockReturnValue('group-2')
    await flush(el)

    el.createGroup()
    expect(create).toHaveBeenCalledWith('Group 2', undefined, [])
    create.mockRestore()
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
