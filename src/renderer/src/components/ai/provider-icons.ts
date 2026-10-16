import { html, type TemplateResult } from 'lit'
import { chromeIcon } from '../../design/icons'

const assets = import.meta.glob<string>('../../assets/providers/*.svg', {
  eager: true,
  query: '?url',
  import: 'default'
})

/** Bundled provider marks, rendered as masks so they follow every theme. */
export function providerIcon(provider: string, size = 14): TemplateResult {
  const id = provider === 'chatgpt' ? 'openai' : provider
  const url = assets[`../../assets/providers/${id}.svg`]
  return url
    ? html`<span
        aria-hidden="true"
        data-provider-icon=${provider}
        style=${`display:inline-block;flex:0 0 ${size}px;width:${size}px;height:${size}px;background:currentColor;mask:url("${url}") center/contain no-repeat`}
      ></span>`
    : html`${chromeIcon('bot', size)}`
}
