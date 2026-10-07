import type { FileStateData } from './file-state'

/** Document keystrokes must not invalidate the shell or tab rail. */
export function chromeKey(state: Readonly<FileStateData>): string {
  return JSON.stringify([
    state.tabs.map(({ id, path, dirty, isPinned, groupId }) => [
      id,
      path,
      dirty,
      isPinned,
      groupId
    ]),
    state.tabGroups,
    state.activeTab,
    state.path,
    state.viewMode,
    state.splitActive,
    state.splitSurface,
    state.secondaryDoc?.path,
    state.secondaryDoc?.dirty,
    state.conflict ? [state.conflict.path, state.conflict.diskMtime] : null
  ])
}
