type PixelEffect = 'dither' | 'ascii' | 'halftone' | 'scanlines'

type Pixels = Uint8ClampedArray<ArrayBuffer>

type Source = {
  width: number
  height: number
  pixels: Pixels
  luma: Uint8Array
}

type EffectRequest = {
  bitmap: ImageBitmap
  effect: PixelEffect
  light: boolean
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<EffectRequest>) => void) | null
  postMessage: (result: { blob?: Blob; error?: string }) => void
}

scope.onmessage = (event): void => {
  void render(event.data.bitmap, event.data.effect, event.data.light).then(
    (blob) => scope.postMessage({ blob }),
    (error: unknown) =>
      scope.postMessage({
        error: error instanceof Error ? error.message : 'Image processing failed'
      })
  )
}

function coverIndex(source: Source, x: number, y: number): number {
  const sourceX = Math.max(0, Math.min(source.width - 1, Math.floor(x)))
  const sourceY = Math.max(0, Math.min(source.height - 1, Math.floor(y)))
  return sourceY * source.width + sourceX
}

function ditherColor(
  r: number,
  g: number,
  b: number,
  a: number,
  threshold: number
): readonly [number, number, number, number] {
  const peak = Math.max(r, g, b)
  const bright = peak / 255 > (threshold + 0.5) / 16
  const gain = bright ? 255 / Math.max(peak, 1) : 0.08
  return [Math.round(r * gain), Math.round(g * gain), Math.round(b * gain), a] as const
}

function ditherPixels(source: Source): Uint8ClampedArray<ArrayBuffer> {
  const bayer = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
  ]
  const output = new Uint8ClampedArray(source.pixels.length)
  for (let y = 0; y < source.height; y += 2) {
    for (let x = 0; x < source.width; x += 2) {
      const sx = Math.min(x + 1, source.width - 1)
      const sy = Math.min(y + 1, source.height - 1)
      const base = coverIndex(source, sx, sy) * 4
      const color = ditherColor(
        source.pixels[base],
        source.pixels[base + 1],
        source.pixels[base + 2],
        source.pixels[base + 3],
        bayer[Math.floor(y / 2) % 4][Math.floor(x / 2) % 4]
      )
      for (let dy = 0; dy < Math.min(2, source.height - y); dy += 1) {
        for (let dx = 0; dx < Math.min(2, source.width - x); dx += 1) {
          output.set(color, ((y + dy) * source.width + x + dx) * 4)
        }
      }
    }
  }
  return output
}

function asciiPixels(source: Source, light: boolean): Uint8ClampedArray<ArrayBuffer> {
  const glyphs = [
    [0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 4, 0],
    [0, 4, 0, 0, 4, 0, 0],
    [0, 0, 0, 14, 0, 0, 0],
    [0, 0, 14, 0, 14, 0, 0],
    [0, 4, 4, 31, 4, 4, 0],
    [0, 21, 14, 31, 14, 21, 0],
    [10, 10, 31, 10, 31, 10, 10],
    [17, 2, 4, 4, 8, 16, 17],
    [14, 17, 23, 21, 23, 16, 14]
  ]
  const output = new Uint8ClampedArray(source.pixels.length)
  const paper = light ? 255 : 0
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const sx = Math.min(Math.floor(x / 6) * 6 + 3, source.width - 1)
      const sy = Math.min(Math.floor(y / 8) * 8 + 4, source.height - 1)
      const sample = coverIndex(source, sx, sy)
      const inkDensity = light ? 255 - source.luma[sample] : source.luma[sample]
      const glyph = glyphs[Math.floor(Math.sqrt(inkDensity / 255) * 9)]
      const ink = x % 6 < 5 && y % 8 < 7 && (glyph[y % 8] & (1 << (4 - (x % 6)))) !== 0
      const pixel = (y * source.width + x) * 4
      const sampled = sample * 4
      for (let color = 0; color < 3; color += 1) {
        const texture = ink ? source.pixels[sampled + color] : paper
        output[pixel + color] = source.pixels[pixel + color] * 0.6 + texture * 0.4
      }
      output[pixel + 3] = source.pixels[pixel + 3]
    }
  }
  return output
}

function halftonePixels(source: Source, light: boolean): Uint8ClampedArray<ArrayBuffer> {
  const output = new Uint8ClampedArray(source.pixels.length)
  const paper = light ? 255 : 0
  output.fill(paper)
  for (let alpha = 3; alpha < output.length; alpha += 4) output[alpha] = 255
  for (let y = 0; y < source.height; y += 4) {
    for (let x = 0; x < source.width; x += 4) {
      const sampledLuma = source.luma[coverIndex(source, x, y)]
      const luma = light ? 255 - sampledLuma : sampledLuma
      const radius = 2 * (0.3 + 0.7 * Math.sqrt(luma / 255))
      const sx = Math.min(x + 2, source.width - 1)
      const sy = Math.min(y + 2, source.height - 1)
      const dot = coverIndex(source, sx, sy) * 4
      for (let dy = 0; dy < Math.min(4, source.height - y); dy += 1) {
        for (let dx = 0; dx < Math.min(4, source.width - x); dx += 1) {
          const distance = Math.hypot(dx - 1.5, dy - 1.5)
          const sourcePixel = ((y + dy) * source.width + x + dx) * 4
          const coverage =
            Math.max(0, Math.min(1, radius + 0.5 - distance)) * (source.pixels[dot + 3] / 255)
          for (let color = 0; color < 3; color += 1) {
            const texture = source.pixels[dot + color] * coverage + paper * (1 - coverage)
            output[sourcePixel + color] = source.pixels[sourcePixel + color] * 0.6 + texture * 0.4
          }
          output[sourcePixel + 3] = source.pixels[sourcePixel + 3]
        }
      }
    }
  }
  return output
}

function scanlinePixels(source: Source, light: boolean): Uint8ClampedArray<ArrayBuffer> {
  const output = new Uint8ClampedArray(source.pixels.length)
  for (let y = 0; y < source.height; y += 1) {
    const gain = y % 3 === 0 ? 0.52 : 1
    for (let x = 0; x < source.width; x += 1) {
      const pixel = (y * source.width + x) * 4
      for (let color = 0; color < 3; color += 1) {
        const value = source.pixels[pixel + color]
        output[pixel + color] = light ? value + (255 - value) * (1 - gain) : value * gain
      }
      output[pixel + 3] = source.pixels[pixel + 3]
    }
  }
  return output
}

function prepare(bitmap: ImageBitmap): Source {
  const scale = Math.min(1, 2048 / bitmap.width, 2048 / bitmap.height)
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Image effects are unavailable')
  context.drawImage(bitmap, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height).data
  const luma = new Uint8Array(width * height)
  for (let pixel = 0; pixel < luma.length; pixel += 1) {
    const offset = pixel * 4
    luma[pixel] = Math.round(
      pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722
    )
  }
  return { width, height, pixels, luma }
}

async function render(bitmap: ImageBitmap, effect: PixelEffect, light: boolean): Promise<Blob> {
  try {
    const source = prepare(bitmap)
    const pixels =
      effect === 'dither'
        ? ditherPixels(source)
        : effect === 'ascii'
          ? asciiPixels(source, light)
          : effect === 'halftone'
            ? halftonePixels(source, light)
            : scanlinePixels(source, light)
    const canvas = new OffscreenCanvas(source.width, source.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image effects are unavailable')
    context.putImageData(new ImageData(pixels, source.width, source.height), 0, 0)
    return await canvas.convertToBlob({ type: 'image/png' })
  } finally {
    bitmap.close()
  }
}
