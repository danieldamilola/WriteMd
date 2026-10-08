import { describe, it, expect, beforeEach } from 'vitest'
import '../src/renderer/src/components/VerticalTabBar'
import { VerticalTabBar } from '../src/renderer/src/components/VerticalTabBar'
import { FileState } from '../src/renderer/src/state/file-state'

function mountRail(): VerticalTabBar {
  HTMLElement.prototype.setPointerCapture ??= () => {}
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.hasPointerCapture ??= () => false
  const el = document.createElement('writemd-vertical-tab-bar') as VerticalTabBar
  document.body.appendChild(el)
  return el
}

async function flush(el: VerticalTabBar): Promise<void> {
  await el.updateComplete
  for (const tab of el.shadowRoot?.querySelectorAll('writemd-tab') ?? []) {
    await (tab as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete
  }
}

describe('tab click selection and group collapse', () => {
  const fileState = FileState.getInstance()

  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('selects tab when user clicks on a tab row', async () => {
    const el = mountRail()
    el.tabs = [
      { path: 'first.md', dirty: false },
      { path: 'second.md', dirty: false }
    ]
    el.activeTab = 0
    await flush(el)

    let selectedIndex = -1
    el.addEventListener('select-tab', (e) => {
      selectedIndex = (e as CustomEvent<{ index: number }>).detail.index
    })

    const secondRow = el.shadowRoot?.querySelector('.tab-row[data-tab-index="1"]') as HTMLElement
    expect(secondRow).not.toBeNull()

    // Simulate mouse click (pointerdown then pointerup then click)
    secondRow.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 50,
        clientY: 50,
        button: 0
      })
    )
    secondRow.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        clientX: 50,
        clientY: 50,
        button: 0
      })
    )
    secondRow.click()

    expect(selectedIndex, 'Clicking tab row must emit select-tab').toBe(1)
  })

  it('collapses and expands group when clicking chevron or group header', async () => {
    const el = mountRail()
    const gid = fileState.createTabGroup('My Group')
    el.tabGroups = fileState.getState().tabGroups ?? []
    el.tabs = [{ path: 'grouped.md', dirty: false, groupId: gid }]
    await flush(el)

    const initialCollapsed = (fileState.getState().tabGroups ?? [])[0].collapsed
    expect(initialCollapsed).toBe(false)

    const chevron = el.shadowRoot?.querySelector('.group-chevron') as HTMLElement
    expect(chevron).not.toBeNull()

    // Simulate click on chevron
    chevron.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 20,
        button: 0
      })
    )
    chevron.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 20,
        button: 0
      })
    )
    chevron.click()

    const afterFirstClick = (fileState.getState().tabGroups ?? [])[0].collapsed
    expect(afterFirstClick, 'Clicking chevron must toggle group collapsed').toBe(!initialCollapsed)

    // Clicking group header row should toggle collapse back
    const header = el.shadowRoot?.querySelector('.group-header') as HTMLElement
    expect(header).not.toBeNull()
    header.click()
    const afterHeaderClick = (fileState.getState().tabGroups ?? [])[0].collapsed
    expect(afterHeaderClick, 'Clicking group-header must toggle group collapsed').toBe(
      initialCollapsed
    )
  })

  it('suppresses the click following a completed drag', async () => {
    const el = mountRail()
    el.tabs = [
      { path: 'first.md', dirty: false },
      { path: 'second.md', dirty: false }
    ]
    el.activeTab = 0
    await flush(el)

    let selectedIndex = -1
    el.addEventListener('select-tab', (e) => {
      selectedIndex = (e as CustomEvent<{ index: number }>).detail.index
    })

    const secondRow = el.shadowRoot?.querySelector('.tab-row[data-tab-index="1"]') as HTMLElement
    expect(secondRow).not.toBeNull()

    // Layout and sensor activation are exercised in Electron. This guards
    // the row's click contract after the controller has ended a gesture.
    const drag = (el as unknown as { tabDrag: { suppressedUntil: number } }).tabDrag
    drag.suppressedUntil = performance.now() + 150
    secondRow.click()

    expect(selectedIndex, 'Dragging must not emit select-tab on release').toBe(-1)
    drag.suppressedUntil = 0
    secondRow.click()
    expect(selectedIndex).toBe(1)
  })

  it('opens tab context menu and clicking menu item triggers action without backdrop intercepting', async () => {
    const el = mountRail()
    await fileState.newFile()
    const tabIdx = fileState.getState().tabs.length - 1
    el.tabs = fileState.getState().tabs
    el.activeTab = tabIdx
    await flush(el)

    const row = el.shadowRoot?.querySelector(`.tab-row[data-tab-index="${tabIdx}"]`) as HTMLElement
    expect(row).not.toBeNull()

    // Right-click to open context menu
    row.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 })
    )
    await flush(el)

    const menu = el.shadowRoot?.querySelector('.m-panel') as HTMLElement
    expect(menu, 'Context menu panel must appear on right-click').not.toBeNull()

    // Find "Pin tab" item
    const pinItem = Array.from(menu.querySelectorAll('.m-item')).find((item) =>
      item.textContent?.includes('Pin tab')
    ) as HTMLElement | undefined
    expect(pinItem, 'Pin tab menu item must exist').toBeDefined()

    pinItem?.click()
    await flush(el)

    expect(
      fileState.getState().tabs[0].isPinned,
      'Clicking Pin tab in context menu must pin the tab'
    ).toBe(true)
  })
})
