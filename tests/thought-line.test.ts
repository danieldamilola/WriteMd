import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { html, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
// Side-effect import: registers <writemd-thought-line>.
import '../src/renderer/src/components/ThoughtLine'
import { ThoughtLine } from '../src/renderer/src/components/ThoughtLine'

/**
 * The settle event, which is what puts an elapsed time into the transcript.
 *
 * It fired on mount as well as on a real transition. A line restored from a
 * saved transcript mounts with `working` already false, so every restored line
 * reported a settle, the owner appended another entry, that entry rendered
 * another line, and the session save looped until the renderer died. These
 * tests pin the distinction between "mounted settled" and "just finished".
 */
@customElement('test-thought-host')
class TestThoughtHost extends LitElement {
  @property({ type: Boolean }) working = true
  @property({ type: Number }) elapsed = 0

  render(): unknown {
    return html`
      <writemd-thought-line
        .working=${this.working}
        .elapsed=${this.elapsed}
      ></writemd-thought-line>
    `
  }
}

function host(): TestThoughtHost {
  const el = document.createElement('test-thought-host') as TestThoughtHost
  document.body.appendChild(el)
  return el
}

async function flush(el: TestThoughtHost): Promise<void> {
  await el.updateComplete
  const line = el.shadowRoot?.querySelector('writemd-thought-line') as ThoughtLine
  if (line) await line.updateComplete
}

function line(el: TestThoughtHost): ThoughtLine {
  return el.shadowRoot?.querySelector('writemd-thought-line') as ThoughtLine
}

function settleEvents(el: TestThoughtHost): number[] {
  const seen: number[] = []
  el.addEventListener('thought-settle', (e) =>
    seen.push((e as CustomEvent<{ tenths: number }>).detail.tenths)
  )
  return seen
}

describe('writemd-thought-line settle', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('reports when work actually finishes', async () => {
    const el = host()
    const seen = settleEvents(el)
    await flush(el)

    // Working is still true: nothing to report yet.
    expect(seen).toEqual([])

    el.working = false
    await flush(el)
    expect(seen.length).toBe(1)
    expect(typeof seen[0]).toBe('number')
  })

  it('stays silent when mounted already settled', async () => {
    // The regression: a restored transcript entry mounts with working false.
    // Reporting here fed the owner its own line back and looped the save.
    const el = host()
    const seen = settleEvents(el)
    el.working = false
    await flush(el)
    expect(seen).toEqual([])
  })

  it('stays silent across re-renders of a settled line', async () => {
    const el = host()
    el.working = false
    await flush(el)
    const seen = settleEvents(el)

    // Other properties changing must not be mistaken for a transition.
    for (let i = 1; i <= 5; i++) {
      el.elapsed = i
      await flush(el)
    }
    expect(seen).toEqual([])
  })

  it('reports again on a second working cycle', async () => {
    const el = host()
    await flush(el)
    const seen = settleEvents(el)

    el.working = false
    await flush(el)
    el.working = true
    await flush(el)
    el.working = false
    await flush(el)

    // Two completions, not three: the middle flip back to working is not a settle.
    expect(seen.length).toBe(2)
  })

  it('shows the elapsed time it was given rather than counting', async () => {
    const el = host()
    el.working = false
    el.elapsed = 303
    await flush(el)
    const css = line(el).shadowRoot?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    expect(css).toContain('Thought for')
    expect(css).toContain('30.3s')
  })

  it('uses no literal colours in its stylesheet', () => {
    const css = (ThoughtLine as unknown as { styles: { cssText: string } }).styles.cssText
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
  })
})

describe('writemd-thought-line clock', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts up while working and freezes on settle', async () => {
    const el = host()
    await flush(el)

    await vi.advanceTimersByTimeAsync(1500)
    el.working = false
    await flush(el)

    const frozen = (line(el).shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
    expect(frozen).toContain('1.5s')

    // The clock is stopped, so time passing does not move the number.
    await vi.advanceTimersByTimeAsync(5000)
    const later = (line(el).shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
    expect(later).toContain('1.5s')
  })
})

declare global {
  interface HTMLElementTagNameMap {
    'test-thought-host': TestThoughtHost
  }
}
