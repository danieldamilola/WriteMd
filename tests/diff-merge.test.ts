import { describe, it, expect, beforeEach } from 'vitest'
import { FileState } from '../src/renderer/src/state/file-state'

/**
 * The conflict merge view edits the document itself, so the merged text has to
 * reach the active tab. These cases pin that, because the earlier version wrote
 * only the top-level mirror: closing the split restored the pre-merge content
 * and the next save wrote the losing version.
 */
describe('conflict merge writes through to the active tab', () => {
  const files = FileState.getInstance()

  async function freshTab(content: string): Promise<void> {
    // `newFile` prompts when the active tab is dirty, and the confirm dialog
    // never resolves in a test. Return the active tab to its saved text first.
    if (files.getState().tabs.length > 0) {
      files.setContent(files.getState().originalContent)
    }
    await files.newFile()
    files.setContent(content)
  }

  beforeEach(async () => {
    await freshTab('editor content')
  })

  const raiseAndReview = (): void => {
    const path = files.getState().path
    // A conflict only makes sense for a saved document.
    if (!path) throw new Error('expected an open tab with a path')
    files.raiseConflict({ path, diskContent: 'disk content', diskMtime: 2 })
    files.resolveConflictReview()
  }

  it('does not touch the active tab for a normal secondary document', () => {
    files.openSecondaryFile('C:/docs/other.md', 'other content')
    files.setSecondaryContent('other content edited')

    const s = files.getState()
    expect(s.secondaryDoc?.content).toBe('other content edited')
    expect(s.tabs[s.activeTab].content).toBe('editor content')
    expect(s.content).toBe('editor content')
  })

  it('puts the merged text on the active tab when the secondary is a diff', () => {
    raiseAndReview()

    expect(files.getState().secondaryDoc?.isDiff).toBe(true)

    files.setSecondaryContent('merged content')

    const s = files.getState()
    expect(s.secondaryDoc?.content).toBe('merged content')
    expect(s.tabs[s.activeTab].content).toBe('merged content')
    expect(s.content).toBe('merged content')
  })

  it('keeps the merged text after the split is closed', () => {
    raiseAndReview()
    files.setSecondaryContent('merged content')
    files.closeSecondaryFile()

    const s = files.getState()
    expect(s.secondaryDoc).toBeNull()
    expect(s.splitActive).toBe(false)
    expect(s.tabs[s.activeTab].content).toBe('merged content')
    expect(s.content).toBe('merged content')
  })

  it('marks the tab dirty so a save is scheduled', () => {
    raiseAndReview()
    files.setSecondaryContent('merged content')
    expect(files.getState().dirty).toBe(true)
  })

  it('reload discards the merge and takes the disk version', () => {
    // Reload is the alternative to review, not a follow-up to it: reviewing
    // clears the conflict, and `applyConflictReload` is a no-op without one.
    raiseAndReview()
    files.setSecondaryContent('merged content')

    // A second disk change while the merge is still open re-raises the
    // conflict, and reload then has something to act on.
    const path = files.getState().path
    if (!path) throw new Error('expected an open tab with a path')
    files.raiseConflict({ path, diskContent: 'newer disk', diskMtime: 3 })
    files.resolveConflictReload()

    const s = files.getState()
    expect(s.tabs[s.activeTab].content).toBe('newer disk')
    expect(s.dirty).toBe(false)
    expect(s.splitActive).toBe(false)
  })
})
