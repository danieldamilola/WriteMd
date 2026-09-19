import { WidgetType, EditorView } from '@codemirror/view'

// Asset cache for resolved image data URIs
export const assetDataCache = new Map<string, string>()

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly docPath: string | null
  ) {
    super()
  }

  eq(other: ImageWidget): boolean {
    return (
      other.src === this.src &&
      other.alt === this.alt &&
      other.docPath === this.docPath
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-live-image-wrap'
    wrap.style.display = 'inline-block'
    wrap.style.maxWidth = '100%'

    const img = document.createElement('img')
    img.alt = this.alt
    img.className = 'cm-live-image'
    img.style.maxWidth = '100%'
    img.style.maxHeight = '500px'
    img.style.borderRadius = '6px'
    img.style.display = 'block'
    img.style.margin = '4px 0'

    const src = this.src
    const isRemote = /^https?:\/\//i.test(src) || src.startsWith('data:')

    if (isRemote) {
      img.src = src
    } else if (this.docPath) {
      const cacheKey = `${this.docPath}:${src}`
      const cached = assetDataCache.get(cacheKey)
      if (cached) {
        img.src = cached
      } else {
        img.alt = `Loading ${this.alt}...`
        if (typeof window !== 'undefined' && window.electronAPI?.file?.resolveAsset) {
          window.electronAPI.file
            .resolveAsset(this.docPath, src)
            .then((dataUri: string | null) => {
              if (dataUri) {
                assetDataCache.set(cacheKey, dataUri)
                img.src = dataUri
                img.alt = this.alt
                // Trigger view measure so editor lines reposition correctly
                view.requestMeasure()
              } else {
                img.alt = `[Image not found: ${this.alt || src}]`
              }
            })
            .catch(() => {
              img.alt = `[Failed to load: ${this.alt || src}]`
            })
        }
      }
    } else {
      img.src = src
    }

    wrap.appendChild(img)
    return wrap
  }

  ignoreEvent(): boolean {
    return false
  }
}
