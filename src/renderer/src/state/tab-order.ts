export interface OrderedTab {
  id?: string
  isPinned?: boolean
  groupId?: string | null
}

export interface TabDestination {
  section: 'pinned' | 'group' | 'ungrouped'
  groupId?: string | null
  beforeId?: string
  afterId?: string
}

/** Placement is resolved after removal, so pin/group changes cannot invalidate it. */
export function placeTab<T extends OrderedTab>(
  tabs: readonly T[],
  id: string,
  destination: TabDestination
): T[] {
  const source = tabs.find((tab) => tab.id === id)
  if (!source) return [...tabs]
  const pinned = destination.section === 'pinned'
  const groupId = destination.section === 'group' ? (destination.groupId ?? null) : null
  if (destination.beforeId === id || destination.afterId === id) return [...tabs]
  const remaining = tabs.filter((tab) => tab.id !== id)
  const belongs = (tab: T): boolean =>
    pinned ? !!tab.isPinned : !tab.isPinned && (tab.groupId ?? null) === groupId
  let index = destination.beforeId
    ? remaining.findIndex((tab) => tab.id === destination.beforeId && belongs(tab))
    : -1
  if (index < 0 && destination.afterId) {
    const after = remaining.findIndex((tab) => tab.id === destination.afterId && belongs(tab))
    if (after >= 0) index = after + 1
  }
  if (index < 0) {
    index = remaining.reduce((last, tab, i) => (belongs(tab) ? i + 1 : last), -1)
    if (index < 0) index = pinned ? 0 : remaining.length
  }
  remaining.splice(index, 0, { ...source, isPinned: pinned, groupId })
  return remaining
}
