import { describe, it, expect, beforeEach } from 'vitest'
import { html, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
// Side-effect import: the module runs @customElement('writemd-tab'), which is
// what upgrades the elements the host renders. A type-only import would be
// elided and every writemd-tab would stay an unupgraded HTMLElement.
import '../src/renderer/src/components/Tab'
import type { WriteMdTab } from '../src/renderer/src/components/Tab'

/**
 * Tab was one of only a handful of components importable at all, because the
 * suite ran under `environment: 'node'`. Under jsdom it renders, so the tab
 * semantics and the label truncation are finally assertable.
 */
@customElement('test-tab-host')
class TestTabHost extends LitElement {
  @property({ type: Array }) labels: string[] = []
  @property({ type: Number }) active = 0

  render(): unknown {
    return html`
      ${this.labels.map(
        (label, i) => html`
          <writemd-tab
            label=${label}
            ?active=${i === this.active}
            @select=${() => this.dispatchEvent(new CustomEvent('pick', { detail: i }))}
            @close=${() => this.dispatchEvent(new CustomEvent('drop', { detail: i }))}
          ></writemd-tab>
        `
      )}
    `
  }
}

function host(): TestTabHost {
  const el = document.createElement('test-tab-host') as TestTabHost
  document.body.appendChild(el)
  return el
}

async function flush(el: TestTabHost): Promise<void> {
  await el.updateComplete
  for (const tab of el.shadowRoot?.querySelectorAll('writemd-tab') ?? []) {
    await (tab as WriteMdTab).updateComplete
  }
}

describe('writemd-tab', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the label', async () => {
    const el = host()
    el.labels = ['PRD.md']
    await flush(el)
    const tab = el.shadowRoot?.querySelector('writemd-tab') as WriteMdTab
    expect(tab.shadowRoot?.querySelector('.label')?.textContent?.trim()).toBe('PRD.md')
  })

  it('exposes tablist semantics and marks exactly one tab selected', async () => {
    const el = host()
    el.labels = ['a.md', 'b.md', 'c.md']
    el.active = 1
    await flush(el)
    const tabs = Array.from(el.shadowRoot?.querySelectorAll('writemd-tab') ?? []) as WriteMdTab[]
    const selected = tabs.map((t) =>
      t.shadowRoot?.querySelector('.tab-btn')?.getAttribute('aria-selected')
    )
    expect(selected).toEqual(['false', 'true', 'false'])
    expect(tabs[1].hasAttribute('active')).toBe(true)
  })

  it('gives every tab a focusable target so the strip is keyboard reachable', async () => {
    const el = host()
    el.labels = ['a.md', 'b.md']
    await flush(el)
    for (const tab of Array.from(
      el.shadowRoot?.querySelectorAll('writemd-tab') ?? []
    ) as WriteMdTab[]) {
      expect(tab.shadowRoot?.querySelector('.tab-btn')?.getAttribute('tabindex')).toBe('0')
    }
  })

  it('always offers a close button, labelled for screen readers', async () => {
    // Previously the close button only rendered on the active tab, so inactive
    // tabs had no discoverable way to close.
    const el = host()
    el.labels = ['a.md', 'b.md']
    el.active = 0
    await flush(el)
    const tabs = Array.from(el.shadowRoot?.querySelectorAll('writemd-tab') ?? []) as WriteMdTab[]
    const closes = tabs.map((t) =>
      t.shadowRoot?.querySelector('.close-btn')?.getAttribute('aria-label')
    )
    expect(closes).toEqual(['Close a.md', 'Close b.md'])
  })

  it('emits select on click and on Enter, but not from the close button', async () => {
    const el = host()
    el.labels = ['a.md', 'b.md']
    el.active = 0
    await flush(el)
    const picks: number[] = []
    const drops: number[] = []
    el.addEventListener('pick', (e) => picks.push((e as unknown as CustomEvent<number>).detail))
    el.addEventListener('drop', (e) => drops.push((e as unknown as CustomEvent<number>).detail))

    const tabs = Array.from(el.shadowRoot?.querySelectorAll('writemd-tab') ?? []) as WriteMdTab[]
    const secondBtn = tabs[1].shadowRoot?.querySelector('.tab-btn') as HTMLElement
    secondBtn.click()
    secondBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(picks).toEqual([1, 1])

    // Enter on the close button must not also fire select.
    const close = tabs[0].shadowRoot?.querySelector('.close-btn') as HTMLElement
    close.click()
    expect(drops).toEqual([0])
    expect(picks).toEqual([1, 1])
  })

  it('moves focus along the strip with left and right arrows', async () => {
    const el = host()
    el.labels = ['a.md', 'b.md', 'c.md']
    el.active = 0
    await flush(el)
    const picks: number[] = []
    el.addEventListener('pick', (e) => picks.push((e as unknown as CustomEvent<number>).detail))

    const tabs = Array.from(el.shadowRoot?.querySelectorAll('writemd-tab') ?? []) as WriteMdTab[]
    tabs[0].focus()
    expect(tabs[0].shadowRoot?.activeElement).not.toBeNull()

    tabs[0].shadowRoot
      ?.querySelector('.tab-btn')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(tabs[1].shadowRoot?.activeElement).not.toBeNull()
    expect(picks).toContain(1)

    tabs[1].shadowRoot
      ?.querySelector('.tab-btn')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(tabs[0].shadowRoot?.activeElement).not.toBeNull()
  })

  it('wraps around at both ends of the strip', async () => {
    const el = host()
    el.labels = ['a.md', 'b.md']
    el.active = 0
    await flush(el)
    const tabs = Array.from(el.shadowRoot?.querySelectorAll('writemd-tab') ?? []) as WriteMdTab[]
    const btn = (t: WriteMdTab): HTMLElement | null =>
      t.shadowRoot?.querySelector('.tab-btn') ?? null

    btn(tabs[0])?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(tabs[1].shadowRoot?.activeElement).not.toBeNull()

    btn(tabs[1])?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(tabs[0].shadowRoot?.activeElement).not.toBeNull()
  })

  it('shows a dirty dot only for dirty documents', async () => {
    const el = host()
    el.labels = ['a.md']
    await flush(el)
    const tab = el.shadowRoot?.querySelector('writemd-tab') as WriteMdTab
    expect(tab.shadowRoot?.querySelector('.dirty-dot')).toBeNull()
    tab.dirty = true
    await tab.updateComplete
    expect(tab.shadowRoot?.querySelector('.dirty-dot')).not.toBeNull()
  })

  it('uses a theme variable for its colours, not a literal', async () => {
    // The project rule is CSS custom properties only. A hardcoded hex here is
    // what kept the light and paper themes unreadable on the tab strip.
    const el = host()
    el.labels = ['a.md']
    el.active = 0
    await flush(el)
    const tab = el.shadowRoot?.querySelector('writemd-tab') as WriteMdTab
    const css = tab.constructor as unknown as { styles: { cssText: string } }
    expect(css.styles.cssText).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
  })
})

declare global {
  interface HTMLElementTagNameMap {
    'test-tab-host': TestTabHost
  }
}
