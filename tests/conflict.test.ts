import { describe, it, expect } from 'vitest'
import {
  applyConflictReview,
  applyConflictReload,
  applyConflictDismiss
} from '../src/renderer/src/state/conflict'
import type { FileStateData } from '../src/renderer/src/state/file-state'

const TAB = {
  path: 'C:/docs/note.md',
  content: 'editor content',
  originalContent: 'editor content',
  mtime: 1,
  dirty: true,
  isVaultFile: true,
  lastWritten: null,
  pendingWrite: null
}

const BASE: FileStateData = {
  path: 'C:/docs/note.md',
  content: 'editor content',
  originalContent: 'editor content',
  mtime: 1,
  dirty: true,
  viewMode: 'live',
  isVaultFile: true,
  quickTogglePair: ['live', 'reading'],
  splitActive: false,
  splitSurface: 'launcher',
  secondaryDoc: null,
  conflict: {
    path: 'C:/docs/note.md',
    diskContent: 'disk content',
    diskMtime: 2
  },
  tabs: [TAB],
  activeTab: 0
}

describe('conflict reducers', () => {
  it('review opens a diff of disk vs editor', () => {
    const patch = applyConflictReview(BASE)
    expect(patch.conflict).toBeNull()
    expect(patch.splitActive).toBe(true)
    expect(patch.splitSurface).toBe('file')
    expect(patch.secondaryDoc?.content).toBe('editor content')
    expect(patch.secondaryDoc?.originalContent).toBe('disk content')
    expect(patch.secondaryDoc?.isDiff).toBe(true)
  })

  it('review is a no-op without a conflict', () => {
    expect(applyConflictReview({ ...BASE, conflict: null })).toEqual({})
  })

  it('reload replaces the active tab with disk content', () => {
    const patch = applyConflictReload(BASE)
    expect(patch.conflict).toBeNull()
    expect(patch.tabs?.[0].content).toBe('disk content')
    expect(patch.tabs?.[0].dirty).toBe(false)
  })

  it('reload closes a stale diff view', () => {
    const withDiff = {
      ...BASE,
      secondaryDoc: {
        ...TAB,
        originalContent: 'x',
        mtime: 9,
        viewMode: 'source' as const,
        isDiff: true
      }
    }
    const patch = applyConflictReload(withDiff)
    expect(patch.splitActive).toBe(false)
    expect(patch.secondaryDoc).toBeNull()
  })

  it('dismiss only clears the conflict', () => {
    expect(applyConflictDismiss()).toEqual({ conflict: null })
  })
})
