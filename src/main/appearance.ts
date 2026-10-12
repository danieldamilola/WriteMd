import { app, dialog, nativeImage, type BrowserWindow, type NativeImage } from 'electron'
import { mkdir, readFile, writeFile, rename, unlink, stat } from 'fs/promises'
import { join, basename, extname } from 'path'
import { randomUUID } from 'crypto'
import { release } from 'os'
import type { BackgroundAsset, MaterialSupport } from '../shared/electron-api'
import { getSettings } from './settings'

const MAX_BYTES = 20 * 1024 * 1024
const MAX_EDGE = 2560
const JPEG_QUALITY = 85
/** Ids are generated here, so both owned extensions are safe to accept. PNG keeps
 *  assets written before v1.4.1 readable. */
const ASSET_ID = /^[0-9a-f-]{36}\.(?:jpg|png)$/

function mediaType(id: string): string {
  return id.endsWith('.png') ? 'image/png' : 'image/jpeg'
}

export function backgroundPath(id: string): string {
  if (!ASSET_ID.test(id)) throw new Error('Invalid background asset')
  return join(app.getPath('userData'), 'backgrounds', id)
}

/**
 * `nativeImage` exposes no alpha flag, so read it out of the BGRA bitmap. Only the
 * downscaled image is scanned, which caps the buffer at 2560 * 2560 * 4 bytes.
 */
function hasTransparency(image: NativeImage): boolean {
  const bitmap = image.toBitmap()
  for (let index = 3; index < bitmap.length; index += 4) if (bitmap[index] < 255) return true
  return false
}

export async function getBackground(id: string): Promise<BackgroundAsset | null> {
  if (!id) return null
  const path = backgroundPath(id)
  try {
    const info = await stat(path)
    if (info.size > MAX_BYTES) throw new Error('Background exceeds 20 MB')
    const data = await readFile(path)
    return {
      id,
      name: 'Background image',
      url: `data:${mediaType(id)};base64,${data.toString('base64')}`
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function importBackground(
  window: BrowserWindow | null
): Promise<BackgroundAsset | null> {
  if (!window) return null
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose a background image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
  })
  const path = result.filePaths[0]
  if (result.canceled || !path) return null
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extname(path).toLowerCase()))
    throw new Error('Unsupported image')
  const info = await stat(path)
  if (info.size > MAX_BYTES) throw new Error('Choose an image smaller than 20 MB')
  const bytes = await readFile(path)
  if (bytes.length > MAX_BYTES) throw new Error('Choose an image smaller than 20 MB')
  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) throw new Error('This image could not be opened')
  const size = image.getSize()
  const ratio = Math.min(1, MAX_EDGE / Math.max(size.width, size.height))
  const normalized =
    ratio < 1
      ? image.resize({
          width: Math.round(size.width * ratio),
          height: Math.round(size.height * ratio)
        })
      : image
  // PNG is the only lossless target here, but it inflates a photograph by an order
  // of magnitude: a 2560px wallpaper is roughly 1 MB as JPEG and 13 MB as PNG. The
  // stored copy is also base64ed across IPC on every launch, so the difference is
  // paid twice. Transparency is the only reason to pay it.
  const transparent = hasTransparency(normalized)
  const encoded = transparent ? normalized.toPNG() : normalized.toJPEG(JPEG_QUALITY)
  const id = `${randomUUID()}.${transparent ? 'png' : 'jpg'}`
  if (encoded.length > MAX_BYTES) throw new Error('Image is too large to store')
  const target = backgroundPath(id)
  await mkdir(join(app.getPath('userData'), 'backgrounds'), { recursive: true })
  const temp = `${target}.tmp`
  try {
    await writeFile(temp, encoded, { flag: 'wx' })
    await rename(temp, target)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
  return {
    id,
    name: basename(path),
    url: `data:${mediaType(id)};base64,${encoded.toString('base64')}`
  }
}

export async function removeBackground(id: string): Promise<void> {
  await unlink(backgroundPath(id)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}

export function materialSupport(): MaterialSupport {
  const build = Number(release().split('.')[2] ?? 0)
  return {
    supported: process.platform === 'darwin' || (process.platform === 'win32' && build >= 22621),
    platform: process.platform
  }
}

export function applyWindowMaterial(window: BrowserWindow | null): void {
  if (!window) return
  const choice = getSettings().appearance.windowMaterial
  const material = materialSupport().supported ? choice : 'none'
  if (process.platform === 'win32')
    window.setBackgroundMaterial(material === 'none' ? 'none' : material)
  else if (process.platform === 'darwin')
    window.setVibrancy(material === 'none' ? null : 'under-window')
  window.setBackgroundColor(material === 'none' ? '#000000' : '#00000000')
}
