import { afterEach, expect, it } from 'vitest'
import { readFileSync, renameSync, writeFileSync, type FSWatcher } from 'fs'
import { join } from 'path'
import { watchDocument } from '../src/main/file-watch'
import { makeTempRoot, cleanupTempRoot } from './helpers/temp-root'

let root = ''
let watcher: FSWatcher | undefined
afterEach(() => {
  watcher?.close()
  cleanupTempRoot(root)
})

it('keeps reporting the file after successive atomic replacements', async () => {
  root = makeTempRoot('watch-replace')
  const path = join(root, 'note.md')
  writeFileSync(path, 'Original')
  let observed: (() => void) | undefined
  watcher = watchDocument(path, () => observed?.())
  for (const content of ['First', 'Second', 'Third']) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Missed ${content}`)), 3000)
      observed = () => {
        if (readFileSync(path, 'utf8') !== content) return
        clearTimeout(timeout)
        resolve()
      }
      const temp = join(root, 'note.tmp')
      writeFileSync(temp, content)
      renameSync(temp, path)
    })
  }
  expect(readFileSync(path, 'utf8')).toBe('Third')
})
