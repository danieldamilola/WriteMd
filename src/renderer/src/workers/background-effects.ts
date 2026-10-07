type PixelEffect = 'dither' | 'ascii' | 'halftone' | 'scanlines'
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<{ bitmap: ImageBitmap; effect: PixelEffect }>) => void) | null
  postMessage: (result: { blob?: Blob; error?: string }) => void
}

scope.onmessage = (event): void => {
  void render(event.data.bitmap, event.data.effect).then(
    (blob) => scope.postMessage({ blob }),
    (error: unknown) =>
      scope.postMessage({
        error: error instanceof Error ? error.message : 'Image processing failed'
      })
  )
}

async function render(bitmap: ImageBitmap, effect: PixelEffect): Promise<Blob> {
  try {
    const ratio = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * ratio))
    const height = Math.max(1, Math.round(bitmap.height * ratio))
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Image effects are unavailable')
    context.drawImage(bitmap, 0, 0, width, height)
    const pixels = context.getImageData(0, 0, width, height)
    const brightness = (x: number, y: number): number => {
      const index = (Math.min(height - 1, y) * width + Math.min(width - 1, x)) * 4
      return (
        0.2126 * pixels.data[index] +
        0.7152 * pixels.data[index + 1] +
        0.0722 * pixels.data[index + 2]
      )
    }
    if (effect === 'scanlines') {
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const index = (y * width + x) * 4
          const factor = y % 4 < 2 ? 0.45 : 1
          for (let channel = 0; channel < 3; channel++) pixels.data[index + channel] *= factor
        }
      context.putImageData(pixels, 0, 0)
    } else if (effect === 'dither') {
      const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const index = (y * width + x) * 4
          const value =
            brightness(x, y) / 255 > (bayer[(y % 4) * 4 + (x % 4)] + 0.5) / 16 ? 230 : 22
          pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value
        }
      context.putImageData(pixels, 0, 0)
    } else {
      // These colors belong to the generated artwork, not to component styling.
      context.fillStyle = 'rgb(18, 18, 18)'
      context.fillRect(0, 0, width, height)
      context.fillStyle = 'rgb(230, 230, 230)'
      const step = effect === 'ascii' ? 10 : 8
      context.font = '10px monospace'
      context.textBaseline = 'top'
      const characters = ' .:-=+*#%@'
      for (let y = 0; y < height; y += step)
        for (let x = 0; x < width; x += step) {
          const value = brightness(x, y) / 255
          if (effect === 'ascii')
            context.fillText(
              characters[Math.min(characters.length - 1, Math.floor(value * characters.length))],
              x,
              y
            )
          else {
            context.beginPath()
            context.arc(x + step / 2, y + step / 2, (value * step) / 2, 0, Math.PI * 2)
            context.fill()
          }
        }
    }
    return canvas.convertToBlob({ type: 'image/png' })
  } finally {
    bitmap.close()
  }
}
