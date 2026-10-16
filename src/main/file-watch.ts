import { watch, type FSWatcher } from 'fs'
import { dirname, join } from 'path'
import { normalizePath } from './path-guard'

/** Watch the directory so replacing the file never detaches its watcher. */
export function watchDocument(path: string, changed: () => void): FSWatcher {
  const directory = dirname(path)
  const key = normalizePath(path)
  return watch(directory, { persistent: false }, (_event, filename) => {
    if (filename === null || normalizePath(join(directory, filename.toString())) === key) {
      changed()
    }
  })
}
