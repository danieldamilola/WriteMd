import { describe, it, expect, beforeEach } from 'vitest'
import { FileState } from '../src/renderer/src/state/file-state'

describe('tab reordering, pinning, and grouping in FileState', () => {
  const fileState = FileState.getInstance()

  beforeEach(async () => {
    // Reset groups and tabs
    const groups = fileState.getState().tabGroups ?? []
    for (const g of [...groups]) {
      fileState.deleteTabGroup(g.id, false)
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

  it('creates, collapses, updates and deletes tab groups', () => {
    const groupId = fileState.createTabGroup('Project Notes', '#3b82f6', [0, 1])
    let s = fileState.getState()
    const groups = s.tabGroups ?? []
    expect(groups.length).toBe(1)
    expect(groups[0].id).toBe(groupId)
    expect(groups[0].label).toBe('Project Notes')
    expect(groups[0].color).toBe('#3b82f6')
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
    fileState.updateTabGroup(groupId, { label: 'Renamed Group', color: '#10b981' })
    s = fileState.getState()
    expect((s.tabGroups ?? [])[0].label).toBe('Renamed Group')
    expect((s.tabGroups ?? [])[0].color).toBe('#10b981')

    // Move tab 2 into group
    fileState.setTabGroup(2, groupId)
    s = fileState.getState()
    expect(s.tabs[2].groupId).toBe(groupId)

    // Remove tab 0 from group
    fileState.setTabGroup(0, null)
    s = fileState.getState()
    expect(s.tabs[0].groupId ?? null).toBeNull()

    // Delete group without closing tabs
    fileState.deleteTabGroup(groupId, false)
    s = fileState.getState()
    expect((s.tabGroups ?? []).length).toBe(0)
    expect(s.tabs.every((t) => t.groupId === null)).toBe(true)
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

  it('moves tabs relatively for keyboard shortcuts', () => {
    fileState.switchTab(1)
    const middlePath = fileState.getState().tabs[1].path

    fileState.moveTabRelative(1, -1) // Move up
    expect(fileState.getState().tabs[0].path).toBe(middlePath)

    fileState.moveTabRelative(0, 1) // Move down
    expect(fileState.getState().tabs[1].path).toBe(middlePath)
  })
})
