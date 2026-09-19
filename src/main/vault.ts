import { app } from 'electron'
import { join, extname } from 'path'
import { existsSync, mkdirSync, readdirSync, type Dirent } from 'fs'
import { getSettings, setSettings } from './settings'

const DEFAULT_VAULT_NAME = 'WriteMD'
const MARKDOWN_EXTS = ['.md', '.markdown', '.mdown', '.mkd']

let vaultPathCache: string | null = null

export function getDefaultVaultPath(): string {
  return join(app.getPath('documents'), DEFAULT_VAULT_NAME)
}

export function getVaultPath(): string {
  if (vaultPathCache) return vaultPathCache
  const settings = getSettings()
  const customPath = settings.files?.vaultPath
  if (customPath && existsSync(customPath)) {
    vaultPathCache = customPath
    return vaultPathCache
  }
  vaultPathCache = getDefaultVaultPath()
  return vaultPathCache
}

export async function setVaultPath(vaultPath: string): Promise<void> {
  await setSettings({ files: { ...getSettings().files, vaultPath } })
  vaultPathCache = vaultPath
}

export function ensureVaultExists(): string {
  const vaultDir = getVaultPath()
  if (!existsSync(vaultDir)) {
    mkdirSync(vaultDir, { recursive: true })
  }
  return vaultDir
}

export function listMarkdownFiles(dir: string): { name: string; path: string }[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e: Dirent) => e.isFile() && MARKDOWN_EXTS.includes(extname(e.name).toLowerCase()))
      .map((e: Dirent) => ({ name: e.name, path: join(dir, e.name) }))
  } catch {
    return []
  }
}

export interface VaultTreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: VaultTreeNode[]
}

export function getVaultTree(dir: string = getVaultPath()): VaultTreeNode {
  const name = dir.split(/[/\\]/).pop() || 'Vault'
  if (!existsSync(dir)) {
    return { name, path: dir, isDirectory: true, children: [] }
  }
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    const children: VaultTreeNode[] = []
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() === b.isDirectory()) return a.name.localeCompare(b.name)
      return a.isDirectory() ? -1 : 1
    })
    for (const entry of sorted) {
      if (entry.name.startsWith('.') || entry.name === '_assets' || entry.name === 'node_modules')
        continue
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        children.push(getVaultTree(fullPath))
      } else if (entry.isFile() && MARKDOWN_EXTS.includes(extname(entry.name).toLowerCase())) {
        children.push({
          name: entry.name,
          path: fullPath,
          isDirectory: false
        })
      }
    }
    return { name, path: dir, isDirectory: true, children }
  } catch {
    return { name, path: dir, isDirectory: true, children: [] }
  }
}

