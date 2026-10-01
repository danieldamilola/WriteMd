import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * The secondary pane's CodeMirror view has to be created and destroyed on
 * exactly the condition that its container element exists. The editor template
 * renders `#secondary-cm-wrapper` only while the split surface is 'file', but
 * the teardown guard used to test only `splitActive` and `secondaryDoc`.
 *
 * Two failures came out of that mismatch, both reachable by normal use:
 *  - switching the surface to AI/Files/Backlinks left a live view attached to a
 *    detached wrapper, so it kept its window listeners and its decoration
 *    loop running against a dead DOM node;
 *  - switching back to 'file' found `secondaryEditorView` still set, so
 *    `initSecondaryEditor()` was skipped and the pane stayed blank until the
 *    secondary document was closed.
 *
 * The invariant lives in the predicate, so that is what these pin. The
 * predicate is exercised against real FileState transitions rather than a
 * hand-built object, so a change to either side shows up here.
 */

vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'writemd-split-test') },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => s }
}))

import {
  FileState,
  shouldMountSecondaryView,
  type SplitSurface
} from '../src/renderer/src/state/file-state'

const files = FileState.getInstance()

/** The fields the predicate reads, taken from live state. */
function predicate(): boolean {
  const s = files.getState()
  return shouldMountSecondaryView({
    splitActive: s.splitActive,
    secondaryDoc: s.secondaryDoc,
    splitSurface: s.splitSurface
  })
}

describe('shouldMountSecondaryView', () => {
  it('is false when nothing is open', () => {
    expect(
      shouldMountSecondaryView({ splitActive: false, secondaryDoc: null, splitSurface: 'launcher' })
    ).toBe(false)
  })

  it('is true with a doc open and the file surface showing', () => {
    expect(
      shouldMountSecondaryView({ splitActive: true, secondaryDoc: {}, splitSurface: 'file' })
    ).toBe(true)
  })

  it('is false when a doc is open but the surface is not the file surface', () => {
    for (const surface of ['ai', 'files', 'backlinks', 'launcher'] as SplitSurface[]) {
      expect(
        shouldMountSecondaryView({ splitActive: true, secondaryDoc: {}, splitSurface: surface })
      ).toBe(false)
    }
  })

  it('is false when the surface is file but the split is closed', () => {
    expect(
      shouldMountSecondaryView({ splitActive: false, secondaryDoc: {}, splitSurface: 'file' })
    ).toBe(false)
  })

  it('is false when the surface is file but there is no doc', () => {
    expect(
      shouldMountSecondaryView({ splitActive: true, secondaryDoc: null, splitSurface: 'file' })
    ).toBe(false)
  })
})

describe('a surface round trip returns to a mounted view', () => {
  it('drops the view on the way out and wants it again on the way back', () => {
    files.openSecondaryFile('C:/vault/secondary.md', 'body text')
    expect(predicate()).toBe(true)

    // The regression path: every one of these kept the predicate true before,
    // so the live view was never torn down.
    for (const surface of ['ai', 'files', 'backlinks'] as SplitSurface[]) {
      files.setSplitSurface(surface)
      expect(predicate()).toBe(false)
    }

    files.setSplitSurface('file')
    expect(predicate()).toBe(true)
    files.closeSecondaryFile()
  })

  it('drops the view when the split is closed and reopened', () => {
    files.openSecondaryFile('C:/vault/second.md', 'body')
    expect(predicate()).toBe(true)
    files.closeSecondaryFile()
    expect(predicate()).toBe(false)
    files.openSecondaryFile('C:/vault/third.md', 'body')
    expect(predicate()).toBe(true)
    files.closeSecondaryFile()
  })

  it('stays false for every non-file surface after the split closes', () => {
    files.openSecondaryFile('C:/vault/fourth.md', 'body')
    files.closeSecondaryFile()
    for (const surface of ['file', 'ai', 'files', 'backlinks', 'launcher'] as SplitSurface[]) {
      files.setSplitSurface(surface)
      expect(predicate()).toBe(false)
    }
  })
})

describe('secondary view mode goes through the store', () => {
  it('setSecondaryViewMode updates state and notifies subscribers', () => {
    files.openSecondaryFile('C:/vault/mode.md', 'body')
    const seen: Array<string | undefined> = []
    const unsub = files.subscribe((s) => seen.push(s.secondaryDoc?.viewMode))
    files.setSecondaryViewMode('source')
    unsub()
    expect(files.getState().secondaryDoc?.viewMode).toBe('source')
    expect(seen).toContain('source')
    files.closeSecondaryFile()
  })

  it('is a no-op when no secondary doc is open', () => {
    files.closeSecondaryFile()
    expect(() => files.setSecondaryViewMode('reading')).not.toThrow()
    expect(files.getState().secondaryDoc).toBeNull()
  })

  it('ignores a mode that is already set', () => {
    files.openSecondaryFile('C:/vault/mode2.md', 'body')
    let notifications = 0
    const unsub = files.subscribe(() => notifications++)
    files.setSecondaryViewMode('live')
    unsub()
    expect(notifications).toBe(0)
    expect(files.getState().secondaryDoc?.viewMode).toBe('live')
    files.closeSecondaryFile()
  })
})
