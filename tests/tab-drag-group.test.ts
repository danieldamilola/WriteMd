import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FileState, normalizeTabGroups } from '../src/renderer/src/state/file-state'
import { SettingsStore } from '../src/renderer/src/state/settings'

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn(async () => true) }))
vi.mock('../src/renderer/src/services/confirm', () => ({ showConfirm: confirm }))

describe('tab reordering, pinning, and grouping in FileState', () => {
  const fileState = FileState.getInstance()

  beforeEach(async () => {
    confirm.mockReset().mockResolvedValue(true)
    SettingsStore.getInstance().set('editor.autoSave', false)
    // Reset groups and tabs
    const groups = fileState.getState().tabGroups ?? []
    for (const g of [...groups]) {
      await fileState.deleteTabGroup(g.id, false)
    }
    const current = fileState.getState().tabs
    for (let i = current.length - 1; i >= 0; i--) {
      await fileState.closeTab(i)
    }
    await fileState.newFile() // Tab 0
    await fileState.newFile() // Tab 1
    await fileState.newFile() // Tab 2
  })

  it('reorders tabs and tracks the active tab index accurately', () => {
    const s0 = fileState.getState()
    expect(s0.tabs.length).toBeGreaterThanOrEqual(3)
    const tab0 = s0.tabs[0].path
    const tab1 = s0.tabs[1].path
    const tab2 = s0.tabs[2].path

    fileState.switchTab(0)
    expect(fileState.getState().activeTab).toBe(0)

    // Move tab 0 to position 2
    fileState.moveTab(0, 2)
    const s1 = fileState.getState()
    expect(s1.tabs[2].path).toBe(tab0)
    expect(s1.tabs[0].path).toBe(tab1)
    expect(s1.tabs[1].path).toBe(tab2)
    // Active tab followed tab 0 to position 2
    expect(s1.activeTab).toBe(2)

    // Move tab 2 back to 0
    fileState.moveTab(2, 0)
    const s2 = fileState.getState()
    expect(s2.tabs[0].path).toBe(tab0)
    expect(s2.activeTab).toBe(0)
  })

  it('pins and unpins tabs into a dedicated pinned zone', () => {
    const s0 = fileState.getState()
    const targetPath = s0.tabs[2].path

    fileState.pinTab(2)
    const s1 = fileState.getState()
    expect(s1.tabs[0].isPinned).toBe(true)
    expect(s1.tabs[0].path).toBe(targetPath)

    // Pinning another tab places it right after previous pinned tabs
    const anotherPath = s1.tabs[2].path
    fileState.pinTab(2)
    const s2 = fileState.getState()
    expect(s2.tabs[0].isPinned).toBe(true)
    expect(s2.tabs[1].isPinned).toBe(true)
    expect(s2.tabs[1].path).toBe(anotherPath)

    // Unpinning moves it back to unpinned section
    fileState.unpinTab(0)
    const s3 = fileState.getState()
    expect(s3.tabs[0].path).toBe(anotherPath)
    expect(s3.tabs[0].isPinned).toBe(true)
    expect(s3.tabs.some((t) => t.path === targetPath && !t.isPinned)).toBe(true)
  })

  it('creates, collapses, updates and deletes tab groups', async () => {
    const groupId = fileState.createTabGroup('Project Notes', 'star', [0, 1])
    let s = fileState.getState()
    const groups = s.tabGroups ?? []
    expect(groups.length).toBe(1)
    expect(groups[0].id).toBe(groupId)
    expect(groups[0].label).toBe('Project Notes')
    expect(groups[0].icon).toBe('star')
    expect(groups[0].collapsed).toBe(false)

    // Tabs 0 and 1 are in the group
    expect(s.tabs[0].groupId).toBe(groupId)
    expect(s.tabs[1].groupId).toBe(groupId)
    expect(s.tabs[2].groupId ?? null).toBeNull()

    // Collapse toggle
    fileState.toggleTabGroupCollapse(groupId)
    s = fileState.getState()
    expect((s.tabGroups ?? [])[0].collapsed).toBe(true)

    // Update group properties
    fileState.updateTabGroup(groupId, { label: 'Renamed Group', icon: 'book' })
    s = fileState.getState()
    expect((s.tabGroups ?? [])[0].label).toBe('Renamed Group')
    expect((s.tabGroups ?? [])[0].icon).toBe('book')

    // Move tab 2 into group
    fileState.setTabGroup(2, groupId)
    s = fileState.getState()
    expect(s.tabs[2].groupId).toBe(groupId)

    // Remove tab 0 from group
    fileState.setTabGroup(0, null)
    s = fileState.getState()
    expect(s.tabs[0].groupId ?? null).toBeNull()

    // Delete group without closing tabs
    await fileState.deleteTabGroup(groupId, false)
    s = fileState.getState()
    expect((s.tabGroups ?? []).length).toBe(0)
    expect(s.tabs.every((t) => t.groupId === null)).toBe(true)
  })

  it('leaves a new group on the folder icon instead of cycling presets', () => {
    const a = fileState.createTabGroup('Group A')
    const b = fileState.createTabGroup('Group B')
    const groups = fileState.getState().tabGroups ?? []
    expect(groups.map((g) => g.id)).toEqual([a, b])
    // Neither group gets an icon, so both rows draw the folder pair.
    expect(groups[0].icon).toBeUndefined()
    expect(groups[1].icon).toBeUndefined()
  })

  it('reorders groups relative to each other', () => {
    const g1 = fileState.createTabGroup('Group 1')
    const g2 = fileState.createTabGroup('Group 2')
    let s = fileState.getState()
    expect((s.tabGroups ?? []).map((g) => g.id)).toEqual([g1, g2])

    fileState.reorderTabGroups(0, 1)
    s = fileState.getState()
    expect((s.tabGroups ?? []).map((g) => g.id)).toEqual([g2, g1])
  })

  it('nests a group with its tabs and descendants, opens the parent, and persists the hierarchy', () => {
    const parent = fileState.createTabGroup('Parent', undefined, [0])
    const child = fileState.createTabGroup('Child', undefined, [1])
    const grandchild = fileState.createTabGroup('Grandchild', undefined, [2])
    fileState.moveTabGroup(grandchild, child)
    fileState.toggleTabGroupCollapse(parent)
    fileState.setContent('Keep this unsaved content')
    const before = fileState.getState()
    fileState.moveTabGroup(child, parent)
    const after = fileState.getState()
    expect(after.tabs).toEqual(before.tabs)
    expect(after.activeTab).toBe(before.activeTab)
    expect(after.tabGroups?.find((group) => group.id === parent)?.collapsed).toBe(false)
    expect(after.tabGroups?.find((group) => group.id === child)?.parentId).toBe(parent)
    expect(after.tabGroups?.find((group) => group.id === grandchild)?.parentId).toBe(child)
    const persisted = JSON.parse(SettingsStore.getInstance().get('files.tabGroups', ''))
    expect(normalizeTabGroups(persisted.groups)).toEqual(after.tabGroups)
    fileState.moveTabGroup(child, null)
    expect(
      fileState.getState().tabGroups?.find((group) => group.id === child)?.parentId
    ).toBeUndefined()
    expect(fileState.getState().tabGroups?.find((group) => group.id === grandchild)?.parentId).toBe(
      child
    )
  })

  it('rejects cycles, missing parents, and invalid sibling destinations without losing groups', () => {
    const parent = fileState.createTabGroup('Parent')
    const child = fileState.createTabGroup('Child')
    const grandchild = fileState.createTabGroup('Grandchild')
    fileState.moveTabGroup(child, parent)
    fileState.moveTabGroup(grandchild, child)
    const before = fileState.getState()
    fileState.moveTabGroup(parent, grandchild)
    fileState.moveTabGroup(child, child)
    fileState.moveTabGroup(child, 'missing')
    fileState.moveTabGroup(child, null, grandchild)
    expect(fileState.getState()).toEqual(before)
  })

  it('reorders siblings without changing their parent or their tabs', () => {
    const parent = fileState.createTabGroup('Parent')
    const first = fileState.createTabGroup('First', undefined, [0])
    const second = fileState.createTabGroup('Second', undefined, [1])
    fileState.moveTabGroup(first, parent)
    fileState.moveTabGroup(second, parent)
    const tabs = fileState.getState().tabs
    fileState.moveTabGroup(second, parent, first)
    expect(
      fileState
        .getState()
        .tabGroups?.filter((group) => group.parentId === parent)
        .map((group) => group.id)
    ).toEqual([second, first])
    expect(fileState.getState().tabs).toEqual(tabs)
  })

  it('promotes children when ungrouping a nested group', async () => {
    const parent = fileState.createTabGroup('Parent')
    const child = fileState.createTabGroup('Child', undefined, [0])
    const grandchild = fileState.createTabGroup('Grandchild', undefined, [1])
    fileState.moveTabGroup(child, parent)
    fileState.moveTabGroup(grandchild, child)
    await fileState.deleteTabGroup(child, false)
    expect(fileState.getState().tabs[0].groupId).toBe(parent)
    expect(fileState.getState().tabs[1].groupId).toBe(grandchild)
    expect(fileState.getState().tabGroups?.find((group) => group.id === grandchild)?.parentId).toBe(
      parent
    )
  })

  it('asks before closing dirty descendants, then closes the whole subtree once confirmed', async () => {
    const parent = fileState.createTabGroup('Parent', undefined, [0])
    const child = fileState.createTabGroup('Child', undefined, [2])
    fileState.moveTabGroup(child, parent)
    fileState.setContent('Keep my nested edit')
    const before = fileState.getState()
    confirm.mockResolvedValueOnce(false)
    await fileState.deleteTabGroup(parent, true)
    expect(fileState.getState()).toEqual(before)
    await fileState.deleteTabGroup(parent, true)
    expect(fileState.getState().tabGroups).toEqual([])
    expect(fileState.getState().tabs).toHaveLength(1)
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('moves tabs relatively for keyboard shortcuts', () => {
    fileState.switchTab(1)
    const middlePath = fileState.getState().tabs[1].path

    fileState.moveTabRelative(1, -1) // Move up
    expect(fileState.getState().tabs[0].path).toBe(middlePath)

    fileState.moveTabRelative(0, 1) // Move down
    expect(fileState.getState().tabs[1].path).toBe(middlePath)
  })

  it('keeps every group tab and its edits when closing is cancelled', async () => {
    const groupId = fileState.createTabGroup('Unsaved', undefined, [0, 2])
    fileState.setContent('Keep these unsaved edits')
    const before = fileState.getState()
    confirm.mockClear().mockResolvedValue(false)

    await fileState.deleteTabGroup(groupId, true)

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(fileState.getState()).toEqual(before)
  })

  it('asks once before closing a dirty group and preserves the other active tab', async () => {
    const groupId = fileState.createTabGroup('Unsaved', undefined, [0, 2])
    fileState.setContent('Discard only after confirmation')
    fileState.switchTab(1)
    const activeId = fileState.getState().tabs[1].id
    confirm.mockClear()

    await fileState.deleteTabGroup(groupId, true)

    expect(confirm).toHaveBeenCalledTimes(1)
    const state = fileState.getState()
    expect(state.tabs.map((tab) => tab.id)).toEqual([activeId])
    expect(state.tabs[state.activeTab].id).toBe(activeId)
    expect(state.tabGroups).toEqual([])
  })

  it('closes a clean group without prompting or changing the surviving document', async () => {
    const groupId = fileState.createTabGroup('Clean', undefined, [0])
    fileState.switchTab(1)
    const activeId = fileState.getState().tabs[1].id
    confirm.mockClear()

    await fileState.deleteTabGroup(groupId, true)

    expect(confirm).not.toHaveBeenCalled()
    const state = fileState.getState()
    expect(state.tabs[state.activeTab].id).toBe(activeId)
  })
})

describe('restoring groups persisted before icon presets', () => {
  it('repairs orphaned, cyclic, duplicate, and self-parented groups on restore', () => {
    const groups = normalizeTabGroups([
      { id: 'a', label: 'A', parentId: 'b' },
      { id: 'b', label: 'B', parentId: 'a' },
      { id: 'c', label: 'C', parentId: 'missing' },
      { id: 'd', label: 'D', parentId: 'd' },
      { id: 'd', label: 'Duplicate' }
    ])
    expect(groups).toHaveLength(4)
    expect(groups.find((group) => group.id === 'a')?.parentId).toBeUndefined()
    expect(groups.find((group) => group.id === 'b')?.parentId).toBe('a')
    expect(groups.find((group) => group.id === 'c')?.parentId).toBeUndefined()
    expect(groups.find((group) => group.id === 'd')?.parentId).toBeUndefined()
  })
  it('drops the old colour and keeps a valid icon', () => {
    const restored = normalizeTabGroups([
      { id: 'g1', label: 'Docs', color: '#3b82f6', collapsed: false },
      { id: 'g2', label: 'Ideas', icon: 'star', collapsed: true }
    ])

    expect(restored).toEqual([
      { id: 'g1', label: 'Docs', collapsed: false },
      { id: 'g2', label: 'Ideas', collapsed: true, icon: 'star' }
    ])
    expect('color' in (restored[0] as object)).toBe(false)
  })

  it('discards an icon that is no longer a preset so the row can fall back', () => {
    const [group] = normalizeTabGroups([
      { id: 'g1', label: 'Docs', icon: 'retired-preset', collapsed: false }
    ])
    expect(group.icon).toBeUndefined()
  })

  it('keeps the folder default when the profile predates icons entirely', () => {
    const [group] = normalizeTabGroups([{ id: 'g1', label: 'Docs', collapsed: false }])
    expect(group.icon).toBeUndefined()
  })

  it('survives metadata that is not a list of groups', () => {
    expect(normalizeTabGroups(null)).toEqual([])
    expect(normalizeTabGroups({ g1: 'Docs' })).toEqual([])
    expect(normalizeTabGroups([null, 7, { label: 'No id' }])).toEqual([])
  })
})
