import { css, html, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { BackgroundStore } from '../state/background'
import { SettingsStore } from '../state/settings'

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
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: opacity var(--motion-base) var(--motion-ease);
    }
    .haze {
      transform: scale(1.06);
      filter: blur(var(--background-blur));
      mask-image: linear-gradient(to bottom, var(--background-mask-solid) 15%, transparent 100%);
    }
    :host-context([data-motion='reduced']) img {
      transition: none;
    }
  `
  @property({ type: String }) target: 'workspace' | 'ai' | 'preview' = 'workspace'
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
    return this.backgrounds.url
      ? html`<img
          alt=""
          aria-hidden="true"
          src=${this.backgrounds.url}
          class=${this.settings.get<string>('appearance.backgroundEffect', 'none') === 'haze' ? 'haze' : ''}
          style=${`opacity:${hidden ? 0 : opacity}`}
        />`
      : ''
  }
}
