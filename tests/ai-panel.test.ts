import { describe, it, expect, beforeEach, vi } from 'vitest'
// Side-effect import: this is what upgrades <writemd-ai-panel>.
import '../src/renderer/src/components/AiPanel'
import { AiPanel, type AiMessage } from '../src/renderer/src/components/AiPanel'
import type { ThoughtLine as WriteMdThoughtLine } from '../src/renderer/src/components/ThoughtLine'
import type { AttachedFile } from '../src/shared/electron-api'

/**
 * The AI panel under jsdom.
 *
 * jsdom has no layout, so nothing here asserts on geometry. What is asserted is
 * behaviour: what the composer emits, what it shows, and how the streamed reveal
 * wraps and reveals words.
 */

function panel(
  config: {
    messages?: AiMessage[]
    loading?: boolean
    model?: string
    models?: string[]
    attachments?: AttachedFile[]
    configured?: boolean
  } = {}
): AiPanel {
  const el = document.createElement('writemd-ai-panel') as AiPanel
  el.configured = config.configured ?? true
  el.messages = config.messages ?? []
  el.loading = config.loading ?? false
  el.model = config.model ?? 'test-model'
  el.models = config.models ?? []
  el.attachments = config.attachments ?? []
  document.body.appendChild(el)
  return el
}

async function flush(el: AiPanel): Promise<void> {
  await el.updateComplete
}

function input(el: AiPanel): HTMLTextAreaElement {
  return el.shadowRoot?.querySelector('textarea.ai-input') as HTMLTextAreaElement
}

function sendButton(el: AiPanel): HTMLButtonElement {
  return el.shadowRoot?.querySelector('button.ai-send') as HTMLButtonElement
}

/** The send pill is "armed" rather than enabled: it stays clickable while busy. */
function armed(el: AiPanel): boolean {
  return sendButton(el).hasAttribute('data-armed')
}

/** The model chip, which names the target of a send. */
function modelChip(el: AiPanel): HTMLElement {
  return el.shadowRoot?.querySelector('.ai-chip-pick') as HTMLElement
}

describe('writemd-ai-panel composer', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders a textarea and a send control, not a bare input', async () => {
    const el = panel()
    await flush(el)
    expect(input(el)).toBeTruthy()
    expect(input(el).getAttribute('placeholder')).toBe('Ask anything')
    expect(sendButton(el)).toBeTruthy()
    expect(el.shadowRoot?.querySelector('input[type="text"]')).toBeNull()
  })

  it('emits ai-submit with the typed text on Enter and clears the box', async () => {
    const el = panel()
    await flush(el)
    const seen: string[] = []
    el.addEventListener('ai-submit', (e) =>
      seen.push((e as CustomEvent<{ text: string }>).detail.text)
    )

    const box = input(el)
    box.value = 'hello there'
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(seen).toEqual(['hello there'])
    expect(box.value).toBe('')
  })

  it('does not send on Shift+Enter, which is a newline', async () => {
    const el = panel()
    await flush(el)
    const seen: string[] = []
    el.addEventListener('ai-submit', (e) =>
      seen.push((e as CustomEvent<{ text: string }>).detail.text)
    )

    const box = input(el)
    box.value = 'line'
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    expect(seen).toEqual([])
    expect(box.value).toBe('line')
  })

  it('does not send while an IME candidate is open', async () => {
    const el = panel()
    await flush(el)
    const seen: string[] = []
    el.addEventListener('ai-submit', (e) =>
      seen.push((e as CustomEvent<{ text: string }>).detail.text)
    )

    const box = input(el)
    box.value = '你好'
    // Enter confirms the candidate here; sending would submit half-typed pinyin.
    box.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })
    )
    expect(seen).toEqual([])
  })

  it('ignores other keys', async () => {
    const el = panel()
    await flush(el)
    const seen: string[] = []
    el.addEventListener('ai-submit', (e) =>
      seen.push((e as CustomEvent<{ text: string }>).detail.text)
    )
    const box = input(el)
    box.value = 'abc'
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    expect(seen).toEqual([])
  })

  it('ignores a whitespace-only send', async () => {
    const el = panel()
    await flush(el)
    const seen: string[] = []
    el.addEventListener('ai-submit', (e) =>
      seen.push((e as CustomEvent<{ text: string }>).detail.text)
    )
    const box = input(el)
    box.value = '   \n  '
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(seen).toEqual([])
  })

  it('follows the draft: the send control is unarmed until there is text', async () => {
    // Armed, not `disabled`: the pill morphs into a stop control while a reply
    // is arriving, so it cannot be a button that goes dead at that moment.
    const el = panel()
    await flush(el)
    expect(armed(el)).toBe(false)

    const box = input(el)
    box.value = 'a'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await flush(el)
    expect(armed(el)).toBe(true)

    box.value = '   '
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await flush(el)
    expect(armed(el)).toBe(false)
  })

  it('sends on a click of the send control too', async () => {
    const el = panel()
    await flush(el)
    const seen: string[] = []
    el.addEventListener('ai-submit', (e) =>
      seen.push((e as CustomEvent<{ text: string }>).detail.text)
    )

    const box = input(el)
    box.value = 'clicked'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await flush(el)
    sendButton(el).click()
    expect(seen).toEqual(['clicked'])
    expect(box.value).toBe('')
  })

  it('locks the composer while a reply is in flight, and offers a stop', async () => {
    const el = panel({ loading: true })
    await flush(el)
    expect(input(el).disabled).toBe(true)
    // Busy is its own state rather than "unarmed": the control stays filled and
    // clickable, because clicking it now means stop.
    expect(sendButton(el).hasAttribute('data-busy')).toBe(true)
    expect(sendButton(el).disabled).toBe(false)
    expect(sendButton(el).getAttribute('aria-label')).toBe('Stop')
    // A second send during a request would interleave two transcripts.
    const seen: string[] = []
    el.addEventListener('ai-submit', (e) =>
      seen.push((e as CustomEvent<{ text: string }>).detail.text)
    )
    const box = input(el)
    box.value = 'second'
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(seen).toEqual([])
  })

  it('names the model on the chip so the target of a send is visible', async () => {
    const el = panel({ model: 'gpt-4o-mini' })
    await flush(el)
    expect(modelChip(el).textContent?.trim()).toBe('gpt-4o-mini')
  })

  it('says so when no model is selected rather than showing nothing', async () => {
    const el = panel({ model: '' })
    await flush(el)
    expect(modelChip(el).textContent?.trim()).toBe('No model selected')
  })

  it('does not grow the transcript when a settled entry mounts', async () => {
    // A restored transcript entry renders a settled thought line. If that line
    // reported a settle on mount, the owner would append another entry, render
    // another line, and the transcript would grow without bound.
    const el = panel({
      messages: [{ role: 'thinking', content: 'Thinking', elapsed: 120 }]
    })
    await flush(el)
    const count = (): number =>
      el.shadowRoot
        ?.querySelector('.chat-log')
        ?.querySelectorAll('writemd-thought-line:not([hidden])').length ?? 0
    const settles: number[] = []
    el.addEventListener('thought-settle', (e) =>
      settles.push((e as CustomEvent<{ tenths: number }>).detail.tenths)
    )
    for (let i = 0; i < 5; i++) {
      input(el).dispatchEvent(new Event('input', { bubbles: true }))
      await flush(el)
    }
    expect(count()).toBe(1)
    expect(settles).toEqual([])
  })

  it('shows the unconfigured state with the settings action, and no composer', async () => {
    const el = panel({ configured: false })
    await flush(el)
    expect(el.shadowRoot?.querySelector('textarea.ai-input')).toBeNull()
    expect(el.shadowRoot?.querySelector('.ai-empty-action')).toBeTruthy()
  })
})

describe('writemd-ai-panel messages', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders markdown for an assistant message and plain text for a user one', async () => {
    const el = panel({
      messages: [
        { role: 'user', content: 'plain **not bold**' },
        { role: 'assistant', content: '**bold** answer' }
      ]
    })
    await flush(el)
    const log = el.shadowRoot?.querySelector('.chat-log') as HTMLElement
    expect(log.querySelector('strong')?.textContent).toBe('bold')
    // The user's own markdown must not be rendered as markdown.
    const user = Array.from(log.children).find((c) => c.textContent?.includes('plain'))
    expect(user?.querySelector('strong')).toBeNull()
  })

  it('wraps the streamed message in word spans and leaves a settled one alone', async () => {
    const el = panel({ messages: [{ role: 'assistant', content: 'one two', streaming: true }] })
    await flush(el)
    const log = el.shadowRoot?.querySelector('.chat-log') as HTMLElement
    const words = Array.from(log.querySelectorAll('.stream-w')).map((w) => w.textContent)
    expect(words).toEqual(['one', 'two'])
    // Whitespace is left between the spans so the text still wraps normally.
    // markdown-it adds the paragraph's own trailing newline, hence the trim.
    expect(log.querySelector('.stream')?.textContent?.trim()).toBe('one two')

    const settled = panel({ messages: [{ role: 'assistant', content: 'one two' }] })
    await flush(settled)
    const settledLog = settled.shadowRoot?.querySelector('.chat-log') as HTMLElement
    expect(settledLog.querySelector('.stream-w')).toBeNull()
  })

  it('mounts no live thought line when nothing is in flight', async () => {
    // The live line exists to be held briefly past the end of work so its
    // settle event can fire. Mounted with nothing in flight it has no job, and
    // a settled one reporting itself fed the transcript its own entries.
    const el = panel()
    await flush(el)
    expect(el.shadowRoot?.querySelectorAll('writemd-thought-line').length).toBe(0)
    expect((el as unknown as { settling: boolean }).settling).toBe(false)
  })

  it('holds the live thought line past the end of work, then removes it', async () => {
    vi.useFakeTimers()
    try {
      const el = panel({ loading: true })
      await flush(el)
      expect(el.shadowRoot?.querySelectorAll('writemd-thought-line').length).toBe(1)

      el.loading = false
      await flush(el)
      // Still mounted: unmounting in this cycle is what stops the settle event.
      expect(el.shadowRoot?.querySelectorAll('writemd-thought-line').length).toBe(1)

      await vi.advanceTimersByTimeAsync(500)
      await flush(el)
      expect(el.shadowRoot?.querySelectorAll('writemd-thought-line').length).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not nest word spans when the panel re-renders the same content', async () => {
    // `updated` runs on every render, and wrapWords used to run from it
    // unconditionally, so each pass wrapped the previous pass's spans again. The
    // count doubled per render until the renderer hung. Re-rendering here is
    // driven by an unrelated property, which is the case that triggered it.
    const el = panel({
      messages: [{ role: 'assistant', content: 'one two three', streaming: true }]
    })
    await flush(el)
    const log = el.shadowRoot?.querySelector('.chat-log') as HTMLElement
    const count = (): number => log.querySelectorAll('.stream-w').length
    expect(count()).toBe(3)

    for (let i = 0; i < 10; i++) {
      // Typing in the composer re-renders the panel without touching the log.
      input(el).value = `draft ${i}`
      input(el).dispatchEvent(new Event('input', { bubbles: true }))
      await flush(el)
    }
    expect(count()).toBe(3)
    // No span is nested inside another.
    expect(log.querySelectorAll('.stream-w .stream-w').length).toBe(0)
  })

  it('reveals streamed words over time and leaves them revealed', async () => {
    vi.useFakeTimers()
    try {
      const el = panel({
        messages: [{ role: 'assistant', content: 'one two three', streaming: true }]
      })
      await flush(el)
      const log = el.shadowRoot?.querySelector('.chat-log') as HTMLElement
      const hidden = (): number => log.querySelectorAll('.stream-w:not(.is-in)').length

      expect(hidden()).toBe(3)
      await vi.advanceTimersByTimeAsync(70)
      expect(hidden()).toBe(2)
      await vi.advanceTimersByTimeAsync(70)
      expect(hidden()).toBe(1)
      await vi.advanceTimersByTimeAsync(70)
      expect(hidden()).toBe(0)

      // Content grows again mid-reveal; the words already shown stay shown.
      el.messages = [{ role: 'assistant', content: 'one two three four', streaming: true }]
      await flush(el)
      expect(hidden()).toBe(1)
      await vi.advanceTimersByTimeAsync(70)
      expect(hidden()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('drains a backlog instead of revealing one word at a time forever', async () => {
    vi.useFakeTimers()
    try {
      const long = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ')
      const el = panel({ messages: [{ role: 'assistant', content: long, streaming: true }] })
      await flush(el)
      const log = el.shadowRoot?.querySelector('.chat-log') as HTMLElement
      await vi.advanceTimersByTimeAsync(2000)
      const hidden = log.querySelectorAll('.stream-w:not(.is-in)').length
      // 400 words at a flat 60ms would need 24s; a couple of seconds clears most.
      expect(hidden).toBeLessThan(400)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not wrap the words of the greeting', async () => {
    const el = panel({ messages: [{ role: 'assistant', content: 'hi', streaming: true }] })
    await flush(el)
    const log = el.shadowRoot?.querySelector('.chat-log') as HTMLElement
    expect(log.querySelectorAll('.stream-w').length).toBe(1)
  })

  it('renders a settled thought line with its elapsed time', async () => {
    const el = panel({ messages: [{ role: 'thinking', content: 'Thinking', elapsed: 303 }] })
    await flush(el)
    const line = el.shadowRoot?.querySelector('writemd-thought-line') as WriteMdThoughtLine
    expect(line).toBeTruthy()
    expect(line.elapsed).toBe(303)
    // Settled, not counting: a persisted entry must not start a fresh clock.
    expect(line.working).toBe(false)
  })

  it('keeps the live thought line mounted after loading ends, but hidden', async () => {
    // Unmounting it in the same cycle that `working` flips means it never
    // re-renders, so its settle event never fires and the elapsed time is lost.
    const el = panel({ loading: true })
    await flush(el)
    el.loading = false
    await flush(el)
    const wrapper = el.shadowRoot?.querySelector('.chat-log > div[hidden]')
    expect(wrapper).toBeTruthy()
  })

  it('takes the hidden settle line out of layout, not just out of view', () => {
    // The UA's `[hidden] { display: none }` is a specificity tie with nothing,
    // and a class selector on the row beats it. The held line therefore kept a
    // row of blank space under the transcript after every reply.
    const css = (AiPanel as unknown as { styles: { cssText: string } }).styles.cssText
    const rule = /\.row\[hidden\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toContain('display: none')
  })

  it('uses no literal colours in its stylesheet', async () => {
    const css = (AiPanel as unknown as { styles: { cssText: string } }).styles.cssText
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
  })

  it('renders an answer with no surface of its own', () => {
    // An answer is reading material, not a control. It sits directly on the
    // panel instead of inside a second rectangle.
    const css = (AiPanel as unknown as { styles: { cssText: string } }).styles.cssText
    const rule = /\.bubble\.assistant\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toContain('background: none')
    expect(rule).not.toContain('var(--bg-card)')
  })

  it('styles the markdown an answer can contain', async () => {
    // Every block markdown-it emits has to be reachable from this shadow root:
    // without rules, a list or a fence in a reply arrived in browser defaults.
    const el = panel({ messages: [{ role: 'assistant', content: '- a\n- b' }] })
    await flush(el)
    const log = el.shadowRoot?.querySelector('.chat-log') as HTMLElement
    expect(log.querySelector('.prose ul')).toBeTruthy()
    const css = (AiPanel as unknown as { styles: { cssText: string } }).styles.cssText
    for (const tag of ['ul', 'ol', 'li', 'pre', 'blockquote', 'code', 'table', 'hr', 'a']) {
      expect(css).toContain(`.prose ${tag}`)
    }
  })

  it('makes the transcript selectable, since an answer has to be copyable', () => {
    // The body sets user-select: none app-wide, so a shadow root that does not
    // opt back in hands the user an answer they cannot quote.
    const css = (AiPanel as unknown as { styles: { cssText: string } }).styles.cssText
    const rule = /\.chat-log\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toContain('user-select: text')
  })

  it('renders a prompt as exactly the text that was sent', async () => {
    // The regression this pins: a user prompt is rendered with `pre-wrap` so
    // typed newlines survive, and Lit keeps the whitespace inside a template
    // literal as real text nodes. An indented template therefore rendered its
    // own indentation into the message, and one word came out as six blank
    // lines with eighteen leading spaces.
    const el = panel({ messages: [{ role: 'user', content: 'testing' }] })
    await flush(el)
    const bubble = el.shadowRoot?.querySelector('.bubble.user') as HTMLElement
    expect(bubble.textContent).toBe('testing')
  })

  it('keeps a prompt newlines as the only whitespace it renders', async () => {
    const el = panel({ messages: [{ role: 'user', content: 'one\ntwo' }] })
    await flush(el)
    const bubble = el.shadowRoot?.querySelector('.bubble.user') as HTMLElement
    expect(bubble.textContent).toBe('one\ntwo')
  })

  it('draws a one-line prompt as a pill and a wrapped one with softer corners', () => {
    // 999px is "as round as this box can be", which on a three-line prompt makes
    // each end a 40px semicircle and squeezes the text inward. The wrapped case
    // is marked by measurement, so the rule has to exist and be selectable.
    const css = (AiPanel as unknown as { styles: { cssText: string } }).styles.cssText
    const pill = /\.bubble\.user\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(pill).toContain('border-radius: 999px')
    expect(pill).not.toMatch(/border:/)
    const wrapped = /\.bubble\.user\[data-wrapped\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(wrapped).toContain('border-radius')
  })

  it('outlines nothing on the prompt bar, at rest or focused', () => {
    // A border here drew a second edge just inside the panel's own, and on focus
    // that edge took the accent colour -- a coloured rectangle wrapped around
    // the thing the user is typing in.
    const css = (AiPanel as unknown as { styles: { cssText: string } }).styles.cssText
    const rule = /\.ai-composer\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/border:\s*none/)
    expect(rule).not.toMatch(/border:\s*1px/)
  })

  it('lists the files a sent prompt carried', async () => {
    // The transcript keeps the names so a restored session shows what was sent.
    const el = panel({
      messages: [
        {
          role: 'user',
          content: 'what is wrong here',
          attachments: [
            { name: 'diagram.png', kind: 'image', size: 2048 },
            { name: 'notes.md', kind: 'text', size: 90 }
          ]
        }
      ]
    })
    await flush(el)
    const log = el.shadowRoot?.querySelector('.chat-log') as HTMLElement
    const sent = Array.from(log.querySelectorAll('.ai-sent-file')).map((c) => c.textContent?.trim())
    expect(sent).toEqual(['diagram.png', 'notes.md'])
  })
})

describe('writemd-ai-panel model chip', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('opens a list of the models the provider reports', async () => {
    const el = panel({ models: ['gpt-4o', 'gpt-4o-mini', 'o3'] })
    await flush(el)
    expect(el.shadowRoot?.querySelector('.ai-pop')).toBeNull()

    modelChip(el).click()
    await flush(el)
    const items = Array.from(el.shadowRoot?.querySelectorAll('.ai-pop-item') ?? []).map((i) =>
      i.textContent?.trim()
    )
    expect(items).toEqual(['gpt-4o', 'gpt-4o-mini', 'o3'])
  })

  it('marks the current model as selected', async () => {
    const el = panel({ model: 'o3', models: ['gpt-4o', 'o3'] })
    await flush(el)
    modelChip(el).click()
    await flush(el)
    const selected = el.shadowRoot?.querySelectorAll('.ai-pop-item[aria-selected="true"]')
    expect(selected).toHaveLength(1)
    expect(selected?.[0].textContent?.trim()).toBe('o3')
  })

  it('emits ai-model-change and closes when a model is picked', async () => {
    const el = panel({ models: ['gpt-4o', 'o3'] })
    await flush(el)
    const seen: string[] = []
    el.addEventListener('ai-model-change', (e) =>
      seen.push((e as CustomEvent<{ model: string }>).detail.model)
    )

    modelChip(el).click()
    await flush(el)
    const rows = el.shadowRoot?.querySelectorAll('.ai-pop-item') ?? []
    ;(rows[1] as HTMLElement).click()
    await flush(el)

    expect(seen).toEqual(['o3'])
    expect(el.shadowRoot?.querySelector('.ai-pop')).toBeNull()
  })

  it('says so when the provider reports no models, instead of an empty box', async () => {
    // Anthropic has no model-list endpoint, so an empty list is a real state
    // rather than a failure, and the user needs to be told where to go.
    const el = panel({ models: [] })
    await flush(el)
    modelChip(el).click()
    await flush(el)
    expect(el.shadowRoot?.querySelector('.ai-pop-item')).toBeNull()
    expect(el.shadowRoot?.querySelector('.ai-pop-note')?.textContent).toContain('Settings')
  })

  it('says so while the list is being fetched', async () => {
    const el = panel({ models: [] })
    el.modelsLoading = true
    await flush(el)
    modelChip(el).click()
    await flush(el)
    expect(el.shadowRoot?.querySelector('.ai-pop-note')?.textContent).toContain('Loading')
  })

  it('closes on Escape and on a click outside', async () => {
    const el = panel({ models: ['gpt-4o'] })
    await flush(el)

    modelChip(el).click()
    await flush(el)
    expect(el.shadowRoot?.querySelector('.ai-pop')).toBeTruthy()
    input(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flush(el)
    expect(el.shadowRoot?.querySelector('.ai-pop')).toBeNull()

    modelChip(el).click()
    await flush(el)
    expect(el.shadowRoot?.querySelector('.ai-pop')).toBeTruthy()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flush(el)
    expect(el.shadowRoot?.querySelector('.ai-pop')).toBeNull()
  })

  it('toggles closed when the chip is clicked again', async () => {
    const el = panel({ models: ['gpt-4o'] })
    await flush(el)
    modelChip(el).click()
    await flush(el)
    modelChip(el).click()
    await flush(el)
    expect(el.shadowRoot?.querySelector('.ai-pop')).toBeNull()
  })
})

describe('writemd-ai-panel attachments', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  const png: AttachedFile = {
    path: 'C:/tmp/diagram.png',
    name: 'diagram.png',
    kind: 'image',
    size: 2048,
    data: 'AAAA',
    mediaType: 'image/png'
  }

  it('raises the intent rather than reading anything itself', async () => {
    // The panel holds no filesystem access. The owner runs the dialog, so the
    // test is that the event fires and that no read is attempted here.
    const el = panel()
    await flush(el)
    const seen: number[] = []
    el.addEventListener('ai-attach-request', () => seen.push(1))
    const plus = el.shadowRoot?.querySelector('.ai-tool') as HTMLElement
    plus.click()
    expect(seen).toHaveLength(1)
  })

  it('shows a chip per attachment and asks the owner to remove one', async () => {
    const el = panel({ attachments: [png] })
    await flush(el)
    const chips = el.shadowRoot?.querySelectorAll('.ai-chip') ?? []
    expect(chips).toHaveLength(1)
    expect(chips[0].textContent).toContain('diagram.png')

    const removed: string[] = []
    el.addEventListener('ai-attach-remove', (e) =>
      removed.push((e as CustomEvent<{ path: string }>).detail.path)
    )
    ;(chips[0].querySelector('.ai-chip-drop') as HTMLElement).click()
    expect(removed).toEqual(['C:/tmp/diagram.png'])
  })

  it('arms the send pill for an attachment with no prompt text', async () => {
    // A screenshot with no words is the most common single-image question.
    const el = panel({ attachments: [png] })
    await flush(el)
    expect(armed(el)).toBe(true)
  })

  it('sends the attachment alongside the prompt', async () => {
    const el = panel({ attachments: [png] })
    await flush(el)
    const sends: Array<{ text: string; attachments: AttachedFile[] }> = []
    el.addEventListener('ai-submit', (e) => sends.push((e as CustomEvent).detail))

    const box = input(el)
    box.value = 'what is wrong'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await flush(el)
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(sends).toHaveLength(1)
    expect(sends[0].text).toBe('what is wrong')
    expect(sends[0].attachments).toEqual([png])
  })

  it('sends an attachment with no text at all', async () => {
    const el = panel({ attachments: [png] })
    await flush(el)
    const sends: Array<{ text: string }> = []
    el.addEventListener('ai-submit', (e) => sends.push((e as CustomEvent).detail))
    sendButton(el).click()
    expect(sends).toHaveLength(1)
    expect(sends[0].text).toBe('')
  })

  it('ignores an empty prompt with nothing attached', async () => {
    const el = panel()
    await flush(el)
    const sends: unknown[] = []
    el.addEventListener('ai-submit', () => sends.push(1))
    sendButton(el).click()
    expect(sends).toHaveLength(0)
  })

  it('does not clear the attachment list itself', async () => {
    // It is the owner's array; the owner clears it when it handles the submit,
    // which is the same moment it stops needing the files. Clearing it here
    // would race that.
    const el = panel({ attachments: [png] })
    await flush(el)
    sendButton(el).click()
    await flush(el)
    expect(el.attachments).toEqual([png])
  })

  it('asks the owner to cancel rather than re-sending while busy', async () => {
    const el = panel({ loading: true })
    await flush(el)
    const stops: number[] = []
    const sends: number[] = []
    el.addEventListener('ai-cancel', () => stops.push(1))
    el.addEventListener('ai-submit', () => sends.push(1))
    sendButton(el).click()
    expect(stops).toHaveLength(1)
    expect(sends).toHaveLength(0)
  })

  it('renders one glyph that morphs, rather than two icons it swaps between', async () => {
    const el = panel({ loading: true })
    await flush(el)
    const paths = el.shadowRoot?.querySelectorAll('.ai-send path') ?? []
    // A single outline. The morph writes to it per frame, so two path elements
    // would mean the busy state is a swap, not a transition.
    expect(paths).toHaveLength(1)
    expect(paths[0].getAttribute('d')).toBeTruthy()
    // The morphing class has to be on the path itself. It was on the <svg> once,
    // and `d` is not an attribute the renderer reads there, so the glyph simply
    // never changed shape.
    expect(paths[0].classList.contains('ai-send-glyph')).toBe(true)
    expect(el.shadowRoot?.querySelector('svg.ai-send-glyph')).toBeNull()
  })
})
