import type { FileStateData } from './file-state'

/**
 * Pure conflict-resolution state transitions for FileState.
 * No side effects — the store applies the returned patch, then syncs
 * mirrors and notifies subscribers itself.
 */

export function applyConflictReview(state: FileStateData): Partial<FileStateData> {
  if (!state.conflict) return {}
  const { path, diskContent, diskMtime } = state.conflict
  return {
    conflict: null,
    splitActive: true,
    splitSurface: 'file',
    secondaryDoc: {
      path,
      content: state.content,
      originalContent: diskContent,
      mtime: diskMtime,
      dirty: false,
      viewMode: 'source',
      isDiff: true
    }
  }
}

export function applyConflictReload(state: FileStateData): Partial<FileStateData> {
  if (!state.conflict) return {}
  const { diskContent, diskMtime } = state.conflict
  const tabs = state.tabs.map((t, i) =>
    i === state.activeTab
      ? {
          ...t,
          content: diskContent,
          originalContent: diskContent,
          mtime: diskMtime,
          dirty: false
        }
      : t
  )
  return {
    tabs,
    conflict: null,
    ...(state.secondaryDoc?.isDiff ? { splitActive: false, secondaryDoc: null } : {})
  }
}

export function applyConflictDismiss(): Pick<FileStateData, 'conflict'> {
  return { conflict: null }
}
