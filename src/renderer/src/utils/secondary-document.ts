import { api } from '../api'
import type { FileState } from '../state/file-state'

const MARKDOWN_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }]

/**
 * Show a document in the split pane, prompting for one when the pane is empty.
 *
 * Shared by the Document tab and the `split-document` command so both behave
 * identically. Hiding the picker behind a conditional in two places is how the
 * two drift: one of them ends up opening a dialog when a document is already
 * open, or silently doing nothing when it is not.
 */
export async function showSecondaryDocument(fileState: FileState): Promise<void> {
  if (fileState.getState().secondaryDoc) {
    fileState.setSplitSurface('file')
    return
  }
  const result = await api()?.file?.openDialog?.({
    properties: ['openFile'],
    filters: MARKDOWN_FILTERS
  })
  if (!result || result.canceled || !result.filePaths[0]) return
  const file = await api()?.file?.read?.(result.filePaths[0])
  if (file) await fileState.openSecondaryFile(result.filePaths[0], file.content)
}
