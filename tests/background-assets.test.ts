import { describe, it, expect, vi, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const fixture = mkdtempSync(join(tmpdir(), 'writemd-background-test-'))
vi.doMock('electron', () => ({
  app: { getPath: () => fixture },
  dialog: { showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }) },
  nativeImage: {},
  safeStorage: { isEncryptionAvailable: () => false }
}))
afterAll(() => {
  rmSync(fixture, { recursive: true, force: true })
})

describe('owned background assets', () => {
  it('rejects traversal and arbitrary user-file paths', async () => {
    const { backgroundPath } = await import('../src/main/appearance')
    for (const id of ['../note.md', 'C:\\Users\\note.png', '/tmp/image.png', 'image.png']) {
      expect(() => backgroundPath(id)).toThrow('Invalid background asset')
    }
  })
  it('removes only the owned image and leaves the original untouched', async () => {
    const { removeBackground, backgroundPath } = await import('../src/main/appearance')
    mkdirSync(join(fixture, 'backgrounds'), { recursive: true })
    const id = '12345678-1234-1234-1234-123456789abc.png'
    const original = join(fixture, 'original.png')
    writeFileSync(original, 'original')
    writeFileSync(backgroundPath(id), 'owned copy')
    await removeBackground(id)
    expect(existsSync(backgroundPath(id))).toBe(false)
    expect(existsSync(original)).toBe(true)
    await expect(removeBackground(id)).resolves.toBeUndefined()
  })
  it('returns an absent asset as unavailable rather than reading another file', async () => {
    const { getBackground } = await import('../src/main/appearance')
    expect(await getBackground('')).toBeNull()
    expect(await getBackground('12345678-1234-1234-1234-123456789abc.png')).toBeNull()
  })
})
