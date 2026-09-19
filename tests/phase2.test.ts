import { describe, it, expect, vi } from 'vitest'
import { EditorState, Compartment } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { readOnlyExtension, readOnlyFacet, livePreviewPlugin } from '../src/renderer/src/components/LivePreview'

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:/Temp/writemd-phase2-test'
  }
}))

describe('phase 2 editor core & split view', () => {
  it('toggles split view on FileState', async () => {
    const { FileState } = await import('../src/renderer/src/state/file-state')
    const fs = FileState.getInstance()
    expect(fs.getState().splitActive).toBe(false)
    fs.toggleSplitView()
    expect(fs.getState().splitActive).toBe(true)
    fs.toggleSplitView(false)
    expect(fs.getState().splitActive).toBe(false)
  })

  it('handles Obsidian-style quick toggle', async () => {
    const { FileState } = await import('../src/renderer/src/state/file-state')
    const fs = FileState.getInstance()
    fs.setExplicitMode('live')
    expect(fs.getState().viewMode).toBe('live')
    fs.quickToggle()
    expect(fs.getState().viewMode).toBe('reading')
    fs.quickToggle()
    expect(fs.getState().viewMode).toBe('live')
  })

  it('manages secondary document in split view', async () => {
    const { FileState } = await import('../src/renderer/src/state/file-state')
    const fs = FileState.getInstance()
    fs.openSecondaryFile('/docs/Secondary.md', '# Secondary Note')
    expect(fs.getState().splitActive).toBe(true)
    expect(fs.getState().splitSurface).toBe('file')
    expect(fs.getState().secondaryDoc?.content).toBe('# Secondary Note')

    fs.closeSecondaryFile()
    expect(fs.getState().splitSurface).toBe('launcher')
    expect(fs.getState().secondaryDoc).toBeNull()
  })

  it('readOnlyExtension toggles readOnlyFacet properly', () => {
    const stateEditable = EditorState.create({
      extensions: [readOnlyExtension(false)]
    })
    expect(stateEditable.facet(readOnlyFacet)).toBe(false)

    const stateReadOnly = EditorState.create({
      extensions: [readOnlyExtension(true)]
    })
    expect(stateReadOnly.facet(readOnlyFacet)).toBe(true)
  })

  it('reconfigures view mode via Compartment without document disruption', () => {
    const modeComp = new Compartment()
    const docText = '# Hello WriteMD\n\n**Live preview** in action.'

    const state = EditorState.create({
      doc: docText,
      extensions: [
        markdown(),
        modeComp.of([readOnlyExtension(false), livePreviewPlugin()])
      ]
    })

    expect(state.doc.toString()).toBe(docText)
    expect(state.facet(readOnlyFacet)).toBe(false)

    // Reconfigure to reading mode
    const trReading = state.update({
      effects: modeComp.reconfigure([readOnlyExtension(true), livePreviewPlugin()])
    })
    const readingState = trReading.state
    expect(readingState.doc.toString()).toBe(docText)
    expect(readingState.facet(readOnlyFacet)).toBe(true)

    // Reconfigure to source mode
    const trSource = readingState.update({
      effects: modeComp.reconfigure([readOnlyExtension(false)])
    })
    const sourceState = trSource.state
    expect(sourceState.doc.toString()).toBe(docText)
    expect(sourceState.facet(readOnlyFacet)).toBe(false)
  })
})
