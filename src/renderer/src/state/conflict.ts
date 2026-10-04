import type { FileStateData } from './file-state'
import type { Transaction } from '@codemirror/state'
import { updateOriginalDoc } from '@codemirror/merge'
import { sameFilePath } from '../utils/paths'

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
  // Merge whichever document the conflict was raised against. Normally that is
  // the active tab, but the split pane is watched too, and a conflict about the
  // pane's file has to merge the pane's text. Merging the tab's text against the
  // pane's file would show a diff between two unrelated documents.
  const split = state.secondaryDoc
  const fromSplit = Boolean(split) && !split?.isDiff && sameFilePath(split?.path, path)
  return {
    conflict: null,
    splitActive: true,
    splitSurface: 'file',
    secondaryDoc: {
      path,
      content: fromSplit ? (split?.content ?? state.content) : state.content,
      originalContent: diskContent,
      mtime: diskMtime,
      dirty: false,
      viewMode: 'source',
      isDiff: true,
      mergeTarget: fromSplit ? 'secondary' : 'tab'
    }
  }
}

export function applyConflictReload(state: FileStateData): Partial<FileStateData> {
  if (!state.conflict) return {}
  const { path, diskContent, diskMtime } = state.conflict
  const split = state.secondaryDoc
  // Which document the conflict is about. Once Review has run, the marker is the
  // merge target; before it, it is whichever document holds the path. A conflict
  // about the pane reloads the pane, and leaves the tab alone.
  const fromSplit =
    split?.mergeTarget === 'secondary' ||
    (Boolean(split) && !split?.isDiff && sameFilePath(split?.path, path))
  if (split && fromSplit) {
    // Reload means "take what is on disk". The merge view goes away with it: the
    // pane is an ordinary document again, holding the disk version.
    return {
      conflict: null,
      secondaryDoc: {
        path: split.path,
        content: diskContent,
        originalContent: diskContent,
        mtime: diskMtime,
        dirty: false,
        viewMode: 'live'
      }
    }
  }
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
