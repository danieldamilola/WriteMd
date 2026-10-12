import { css, html, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { BackgroundStore } from '../state/background'
import { SettingsStore } from '../state/settings'

// Haze composition adapted from MonoCode (MIT). See licenses/monocode.txt.
@customElement('writemd-background')
export class Background extends LitElement {
  static styles = css`
    :host {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
      border-radius: inherit;
    }
    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: opacity var(--motion-base) var(--motion-ease);
    }
    .haze {
      --haze-soft-blur: calc(var(--background-blur) * 7 / 12);
      --haze-strong-blur: calc(var(--background-blur) * 1.5);
      --haze-soft-mask: linear-gradient(
        to bottom,
        transparent 18%,
        var(--background-mask-solid) 60%
      );
      --haze-strong-mask: linear-gradient(
        to bottom,
        transparent 28%,
        var(--background-mask-solid) 76%
      );
      --haze-overlay: linear-gradient(
        to bottom,
        transparent 16%,
        color-mix(in srgb, var(--bg-elevated) 26%, transparent) 38%,
        color-mix(in srgb, var(--bg-elevated) 55%, transparent) 55%,
        color-mix(in srgb, var(--bg-elevated) 78%, transparent) 75%
      );
      position: absolute;
      inset: 0;
      overflow: hidden;
      mask-image: linear-gradient(
        to bottom,
        var(--background-mask-solid) 0 19%,
        color-mix(in srgb, var(--background-mask-solid) 94%, transparent) 30%,
        color-mix(in srgb, var(--background-mask-solid) 72%, transparent) 42%,
        color-mix(in srgb, var(--background-mask-solid) 42%, transparent) 54%,
        color-mix(in srgb, var(--background-mask-solid) 16%, transparent) 66%,
        color-mix(in srgb, var(--background-mask-solid) 4%, transparent) 78%,
        transparent 90%
      );
      transition: opacity var(--motion-base) var(--motion-ease);
    }
    .haze.content {
      --haze-soft-blur: calc(var(--background-blur) * 5 / 12);
      --haze-strong-blur: var(--background-blur);
      --haze-soft-mask: linear-gradient(
        to bottom,
        transparent 18%,
        var(--background-mask-solid) 70%
      );
      --haze-strong-mask: linear-gradient(
        to bottom,
        transparent 22%,
        var(--background-mask-solid) 76%
      );
      --haze-overlay: linear-gradient(
        to bottom,
        transparent 15%,
        color-mix(in srgb, var(--bg-elevated) 70%, transparent) 76%
      );
      mask-image: linear-gradient(to bottom, var(--background-mask-solid) 0 18%, transparent 76%);
    }
    .haze.preview {
      --haze-soft-blur: calc(var(--background-blur) / 6);
      --haze-strong-blur: calc(var(--background-blur) * 5 / 12);
    }
    .haze > span {
      position: absolute;
      inset: 0;
      background-image: var(--background-image);
      background-position: center;
      background-size: cover;
      background-repeat: no-repeat;
    }
    .haze-soft {
      filter: blur(var(--haze-soft-blur));
      mask-image: var(--haze-soft-mask);
    }
    .haze-strong {
      filter: blur(var(--haze-strong-blur));
      mask-image: var(--haze-strong-mask);
    }
    .haze::after {
      content: '';
      position: absolute;
      inset: 0;
      background-image:
        repeating-linear-gradient(
          to bottom,
          color-mix(in srgb, var(--bg-elevated) 36%, transparent) 0 1px,
          transparent 1px 3px
        ),
        var(--haze-overlay);
    }
    :host-context([data-motion='reduced']) img,
    :host-context([data-motion='reduced']) .haze {
      transition: none;
    }
  `
  @property({ type: String }) target: 'workspace' | 'preview' = 'workspace'
  @property({ type: Boolean }) empty = false
  private backgrounds = BackgroundStore.getInstance()
  private settings = SettingsStore.getInstance()
  private unsubscribes: (() => void)[] = []
  connectedCallback(): void {
    super.connectedCallback()
    this.unsubscribes = [
      this.backgrounds.subscribe(() => this.requestUpdate()),
      this.settings.subscribe('appearance', () => this.requestUpdate())
    ]
  }
  disconnectedCallback(): void {
    this.unsubscribes.forEach((unsubscribe) => unsubscribe())
    super.disconnectedCallback()
  }
  render(): unknown {
    const target = this.settings.get('appearance.backgroundTarget', 'workspace')
    const hidden =
      (this.target !== 'preview' && target !== this.target) ||
      (!this.empty && this.settings.get<string>('appearance.backgroundShowOn', 'all') === 'empty')
    const opacity =
      this.settings.get(
        this.empty ? 'appearance.backgroundEmptyOpacity' : 'appearance.backgroundContentOpacity',
        this.empty ? 31 : 19
      ) / 100
    if (!this.backgrounds.url) return ''
    const visibility = hidden ? 0 : opacity
    if (this.settings.get<string>('appearance.backgroundEffect', 'none') === 'haze') {
      return html`<div
        class=${`haze${this.empty ? '' : ' content'}${this.target === 'preview' ? ' preview' : ''}`}
        aria-hidden="true"
        style=${`opacity:${visibility};--background-image:url(${JSON.stringify(this.backgrounds.url)})`}
      >
        <img alt="" src=${this.backgrounds.url} />
        <span class="haze-soft"></span>
        <span class="haze-strong"></span>
      </div>`
    }
    return html`<img
      alt=""
      aria-hidden="true"
      src=${this.backgrounds.url}
      style=${`opacity:${visibility}`}
    />`
  }
}
