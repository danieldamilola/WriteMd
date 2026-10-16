import { describe, expect, it } from 'vitest'
import { html, render } from 'lit'
import { readFileSync } from 'fs'
import { join } from 'path'
import { aiThinkingLabel, chromeIcon } from '../src/renderer/src/design/icons'

function container(): HTMLElement {
  const element = document.createElement('div')
  document.body.append(element)
  return element
}

describe('WriteMd AI artwork', () => {
  it('uses the supplied silhouette and inherits the interface colour', () => {
    render(chromeIcon('ai'), container())
    const svg = document.querySelector('svg')!
    const artwork = readFileSync(
      join(process.cwd(), 'icons/ai/writemd-ai-icon-transparent.svg'),
      'utf-8'
    )
    const silhouette = artwork.match(/<path fill="#F2F2F2" d="([^"]+)"/)?.[1]
    expect(svg.getAttribute('viewBox')).toBe('260 220 740 840')
    expect(svg.querySelector('path[mask]')?.getAttribute('d')).toBe(silhouette)
    expect(svg.querySelector('path[mask]')?.getAttribute('fill')).toBe('currentColor')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.querySelector('metadata')).toBeNull()
  })

  it('keeps mask references separate when several icons share a DOM', () => {
    render(html`${chromeIcon('ai')}${chromeIcon('ai')}${chromeIcon('ai-thinking')}`, container())
    const masks = Array.from(document.querySelectorAll('mask')).map((mask) => mask.id)
    expect(new Set(masks).size).toBe(3)
    for (const svg of document.querySelectorAll('svg')) {
      expect(svg.querySelector('path[mask]')?.getAttribute('mask')).toBe(
        `url(#${svg.querySelector('mask')!.id})`
      )
    }
  })

  it('keeps static and thinking artwork at the same requested size', () => {
    render(html`${chromeIcon('ai', 16)}${chromeIcon('ai-thinking', 16)}`, container())
    for (const svg of document.querySelectorAll('svg')) {
      expect(svg.getAttribute('width')).toBe('16')
      expect(svg.getAttribute('height')).toBe('16')
      expect(svg.querySelectorAll('.writemd-ai-eyes rect')).toHaveLength(2)
    }
    expect(document.querySelector('[data-icon="ai-thinking"]')).not.toBeNull()
  })

  it('renders the supplied unified label without fixed light or dark colours', () => {
    render(aiThinkingLabel(), container())
    const svg = document.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('260 220 740 840')
    expect(svg.getAttribute('width')).toBe('18')
    expect(document.querySelector('.writemd-ai-thinking-text')?.textContent).toBe('Thinking...')
    expect(document.querySelectorAll('.writemd-ai-dot')).toHaveLength(3)
    expect(svg.querySelector('[fill^="#"]')).toBeNull()
  })
})
