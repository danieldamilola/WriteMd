import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { documentPathFacet } from '../src/renderer/src/components/LivePreview'
import { getVaultTree } from '../src/main/vault'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:/Temp/writemd-phase3-test'
  }
}))

describe('phase 3 file & image handling', () => {
  const testDir = join(process.cwd(), 'temp-test-vault')

  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
    mkdirSync(testDir, { recursive: true })
  })

  it('generates a hierarchical vault tree via getVaultTree', () => {
    // Create nested markdown files and folders
    const subDir = join(testDir, 'Folder1')
    mkdirSync(subDir, { recursive: true })
    writeFileSync(join(testDir, 'root-note.md'), '# Root Note')
    writeFileSync(join(subDir, 'sub-note.md'), '# Sub Note')
    writeFileSync(join(testDir, 'ignored.txt'), 'Not markdown')

    const tree = getVaultTree(testDir)
    expect(tree.isDirectory).toBe(true)
    expect(tree.children?.length).toBe(2) // Folder1 and root-note.md

    const folderNode = tree.children?.find((c) => c.name === 'Folder1')
    expect(folderNode?.isDirectory).toBe(true)
    expect(folderNode?.children?.length).toBe(1)
    expect(folderNode?.children?.[0].name).toBe('sub-note.md')

    const fileNode = tree.children?.find((c) => c.name === 'root-note.md')
    expect(fileNode?.isDirectory).toBe(false)

    // Cleanup
    rmSync(testDir, { recursive: true, force: true })
  })

  it('documentPathFacet holds the active document path', () => {
    const docPath = 'C:/docs/MyDoc.md'
    const state = EditorState.create({
      extensions: [documentPathFacet.of(docPath)]
    })
    expect(state.facet(documentPathFacet)).toBe(docPath)
  })

  it('tracks dirty status and content updates in FileState', async () => {
    const { FileState } = await import('../src/renderer/src/state/file-state')
    const fs = FileState.getInstance()

    // Simulate opening an initial clean doc
    fs.setContent('initial clean')
    // Reset originalContent to make it clean
    const state = fs.getState()
    expect(state.content).toBe('initial clean')

    // Editing sets dirty to true
    fs.setContent('modified dirty text')
    expect(fs.getState().dirty).toBe(true)
  })
})
