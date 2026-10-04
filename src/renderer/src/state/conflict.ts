import type { FileStateData } from './file-state'
import type { Transaction } from '@codemirror/state'
import { updateOriginalDoc } from '@codemirror/merge'

/**
 * Whether a diff-view transaction needs syncing despite changing nothing.
 *
 * Accepting a chunk dispatches no document change at all - CodeMirror's
 * acceptChunk only retargets the original-doc reference, since the merge doc
 * already holds the accepted content. A docChanged-only listener never fires,
 * so the merge resolves visually and nothing is ever scheduled for save.
 * The effect is the only trace Accept leaves behind.
 */
export function hasOriginalDocUpdate(tr: Pick<Transaction, 'effects'>): boolean {
  return tr.effects.some((eff) => eff.is(updateOriginalDoc))
}

/**
 * Pure conflict-resolution state transitions for FileState.
 * No side effects - the store applies the returned patch, then syncs
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
