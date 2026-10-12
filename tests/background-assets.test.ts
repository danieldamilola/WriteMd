import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { BrowserWindow } from 'electron'

const fixture = mkdtempSync(join(tmpdir(), 'writemd-background-test-'))
const source = join(fixture, 'original.png')

const PNG_BYTES = 64
const JPEG_BYTES = 8

/** What the fake decoder reports back, so each test can pick the case. */
const decoded = { alpha: 255, width: 600, height: 300, resizes: [] as { w: number; h: number }[] }

function bitmap(width: number, height: number, alpha: number): Buffer {
  const pixels = Buffer.alloc(width * height * 4, 40)
  for (let index = 3; index < pixels.length; index += 4) pixels[index] = alpha
  return pixels
}

function decodedImage(width: number, height: number, alpha: number): unknown {
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: (size: { width: number; height: number }) => {
      decoded.resizes.push({ w: size.width, h: size.height })
      return decodedImage(size.width, size.height, alpha)
    },
    toPNG: () => Buffer.alloc(PNG_BYTES, 1),
    toJPEG: () => Buffer.alloc(JPEG_BYTES, 1),
    toBitmap: () => bitmap(width, height, alpha)
  }
}

vi.doMock('electron', () => ({
  app: { getPath: () => fixture },
  dialog: { showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: [source] }) },
  nativeImage: {
    createFromBuffer: () => decodedImage(decoded.width, decoded.height, decoded.alpha)
  },
  safeStorage: { isEncryptionAvailable: () => false }
}))

beforeEach(() => {
  decoded.alpha = 255
  decoded.width = 600
  decoded.height = 300
  decoded.resizes = []
  writeFileSync(source, 'original bytes')
  mkdirSync(join(fixture, 'backgrounds'), { recursive: true })
})

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true })
})

describe('owned background assets', () => {
  it('rejects traversal and arbitrary user-file paths', async () => {
    const { backgroundPath } = await import('../src/main/appearance')
    for (const id of [
      '../note.md',
      'C:\\Users\\note.png',
      '/tmp/image.png',
      'image.png',
      '12345678-1234-1234-1234-123456789abc.gif',
      '12345678-1234-1234-1234-123456789abc.png.tmp'
    ]) {
      expect(() => backgroundPath(id)).toThrow('Invalid background asset')
    }
  })
  it('removes only the owned image and leaves the original untouched', async () => {
    const { removeBackground, backgroundPath } = await import('../src/main/appearance')
    const id = '12345678-1234-1234-1234-123456789abc.png'
    const original = join(fixture, 'original-copy.png')
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
    expect(await getBackground('12345678-1234-1234-1234-123456789abc.jpg')).toBeNull()
  })
})

describe('background encoding', () => {
  it('stores an opaque image as JPEG rather than inflating it to PNG', async () => {
    const { importBackground, backgroundPath, getBackground } =
      await import('../src/main/appearance')
    const asset = await importBackground({} as BrowserWindow)
    expect(asset?.id).toMatch(/^[0-9a-f-]{36}\.jpg$/)
    expect(readFileSync(backgroundPath(asset!.id)).length).toBe(JPEG_BYTES)
    expect(asset?.url).toMatch(/^data:image\/jpeg;base64,/)
    expect((await getBackground(asset!.id))?.url).toMatch(/^data:image\/jpeg;base64,/)
  })
  it('keeps PNG when the image has transparency', async () => {
    decoded.alpha = 128
    const { importBackground, backgroundPath, getBackground } =
      await import('../src/main/appearance')
    const asset = await importBackground({} as BrowserWindow)
    expect(asset?.id).toMatch(/^[0-9a-f-]{36}\.png$/)
    expect(readFileSync(backgroundPath(asset!.id)).length).toBe(PNG_BYTES)
    // Assets written before the JPEG switch keep their own media type.
    expect((await getBackground(asset!.id))?.url).toMatch(/^data:image\/png;base64,/)
  })
  it('reads a pre-1.4.1 PNG id back as PNG', async () => {
    const { getBackground, backgroundPath } = await import('../src/main/appearance')
    const id = '12345678-1234-1234-1234-123456789abc.png'
    writeFileSync(backgroundPath(id), 'owned copy')
    expect((await getBackground(id))?.url).toMatch(/^data:image\/png;base64,/)
  })
  it('caps the long edge before encoding', async () => {
    decoded.width = 5120
    decoded.height = 2560
    const { importBackground } = await import('../src/main/appearance')
    await importBackground({} as BrowserWindow)
    expect(decoded.resizes).toEqual([{ w: 2560, h: 1280 }])
  })
  it('does not resize an image that already fits', async () => {
    const { importBackground } = await import('../src/main/appearance')
    await importBackground({} as BrowserWindow)
    expect(decoded.resizes).toEqual([])
  })
})
