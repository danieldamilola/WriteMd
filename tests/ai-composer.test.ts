import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../src/renderer/src/components/ai/Composer'
import {
  AiComposer,
  mentionStartAt,
  rankFiles,
  vaultFiles
} from '../src/renderer/src/components/ai/Composer'
import type { VaultTreeNode } from '../src/shared/electron-api'

/**
 * The composer's mention picker has one rule that matters more than the rest:
 * `@` only starts a mention when it starts a word.
 *
 * `email@example.com` is not a mention, and a picker that opens there turns a
 * perfectly ordinary sentence into a file browser mid-address. That is the case
 * the fourth test pins, because it is the one that made the feature unusable
 * the first time it was built.
 *
 * jsdom has no layout, so `scrollHeight` is 0 and the textarea never grows here.
 * Nothing below asserts a height.
 */

type Api = NonNullable<Window['electronAPI']>

const TREE: VaultTreeNode = {
  name: 'Vault',
  path: 'C:/vault',
  isDirectory: true,
  children: [
    {
      name: 'Notes',
      path: 'C:/vault/Notes',
      isDirectory: true,
      children: [
        { name: 'Alpha.md', path: 'C:/vault/Notes/Alpha.md', isDirectory: false },
        { name: 'Beta.md', path: 'C:/vault/Notes/Beta.md', isDirectory: false }
      ]
    },
    { name: 'Gamma.md', path: 'C:/vault/Gamma.md', isDirectory: false }
  ]
}

function installBridge(): void {
  ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
    vault: { getTree: async (): Promise<VaultTreeNode> => TREE }
  } as unknown as Api
}

function clearBridge(): void {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
}

/** The tree read is a promise; let it land before asserting on the picker. */
async function settle(el: AiComposer): Promise<void> {
  await el.updateComplete
  await new Promise((resolve) => setTimeout(resolve, 0))
  await el.updateComplete
}

async function mount(): Promise<AiComposer> {
  const el = document.createElement('writemd-ai-composer') as AiComposer
  document.body.appendChild(el)
  await settle(el)
  return el
}

function input(el: AiComposer): HTMLTextAreaElement {
  return el.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement
}

function type(el: AiComposer, value: string): void {
  const el_ = input(el)
  el_.value = value
  // jsdom leaves the caret at 0 unless it is placed, and the mention scan runs
  // from the caret.
  el_.setSelectionRange(value.length, value.length)
  el_.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }))
}

function press(el: AiComposer, key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  input(el).dispatchEvent(event)
  return event
}

function options(el: AiComposer): HTMLElement[] {
  return Array.from(el.shadowRoot?.querySelectorAll('[role="option"]') ?? [])
}

describe('writemd-ai-composer', () => {
  beforeEach(() => {
    installBridge()
  })

  afterEach(() => {
    clearBridge()
  })

  it('sends on Enter and clears the box', async () => {
    const el = await mount()
    type(el, 'summarise this note')
    const sent = new Promise<CustomEvent<{ text: string }>>((resolve) =>
      el.addEventListener('composer-send', ((e: Event) =>
        resolve(e as CustomEvent<{ text: string }>)) as EventListener)
    )
    press(el, 'Enter')
    const event = await sent
    expect(event.detail.text).toBe('summarise this note')
    await settle(el)
    expect(input(el).value).toBe('')
  })

  it('keeps Shift+Enter as a newline', async () => {
    const el = await mount()
    let fired = false
    el.addEventListener('composer-send', () => (fired = true))
    type(el, 'first line')
    press(el, 'Enter', true)
    expect(fired).toBe(false)
  })

  it('opens the picker on a leading @ and filters as you type', async () => {
    const el = await mount()
    type(el, '@')
    await settle(el)
    expect(options(el)).toHaveLength(3)
    expect(input(el).getAttribute('aria-expanded')).toBe('true')

    type(el, '@bet')
    await settle(el)
    const filtered = options(el)
    expect(filtered).toHaveLength(1)
    expect(filtered[0].textContent).toContain('Beta.md')
  })

  it('does not open the picker for an @ inside a word', async () => {
    const el = await mount()
    type(el, 'email@example.com')
    await settle(el)
    expect(options(el)).toHaveLength(0)
    expect(el.shadowRoot?.querySelector('[role="listbox"]')).toBeNull()
  })

  it('inserts the relative path when an option is chosen', async () => {
    const el = await mount()
    type(el, '@Al')
    await settle(el)
    const option = options(el)[0]
    option?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await settle(el)
    expect(input(el).value).toBe('@Notes/Alpha.md ')
    expect(el.shadowRoot?.querySelector('[role="listbox"]')).toBeNull()
  })

  it('navigates the picker with the arrow keys and closes it with Escape', async () => {
    const el = await mount()
    type(el, '@')
    await settle(el)
    press(el, 'ArrowDown')
    await settle(el)
    const selected = options(el).findIndex((o) => o.getAttribute('aria-selected') === 'true')
    expect(selected).toBe(1)

    press(el, 'Enter')
    await settle(el)
    expect(input(el).value).toBe('@Notes/Beta.md ')

    type(el, '@Gam')
    await settle(el)
    press(el, 'Escape')
    await settle(el)
    expect(el.shadowRoot?.querySelector('[role="listbox"]')).toBeNull()
  })

  it('does not send while the picker is open and Enter is choosing', async () => {
    const el = await mount()
    type(el, '@')
    await settle(el)
    let fired = false
    el.addEventListener('composer-send', () => (fired = true))
    press(el, 'Enter')
    await settle(el)
    expect(fired).toBe(false)
    expect(input(el).value).toContain('@')
  })

  it('offers the quick actions only when there is a selection and nothing typed', async () => {
    const el = await mount()
    el.hasSelection = true
    await settle(el)
    expect(el.shadowRoot?.querySelectorAll('.quick-btn')).toHaveLength(4)

    el.hasSelection = false
    await settle(el)
    expect(el.shadowRoot?.querySelectorAll('.quick-btn')).toHaveLength(0)

    // Typed text hides them too: they are one-click, and a box with a half
    // written prompt in it should not be replaced by someone else's.
    el.hasSelection = true
    type(el, 'half a thought')
    await settle(el)
    expect(el.shadowRoot?.querySelectorAll('.quick-btn')).toHaveLength(0)
  })
})

describe('mentionStartAt', () => {
  it('opens at the start of the value and after whitespace', () => {
    expect(mentionStartAt('@Al', 3)).toEqual({ start: 0, query: 'Al' })
    expect(mentionStartAt('compare @Al', 11)).toEqual({ start: 8, query: 'Al' })
  })

  it('refuses a mid-word @ and one already followed by a space', () => {
    expect(mentionStartAt('email@example.com', 17)).toBeNull()
    expect(mentionStartAt('see @Al then', 10)).toBeNull()
  })
})

describe('vaultFiles', () => {
  it('flattens to vault-relative, forward-slash paths', () => {
    const files = vaultFiles(TREE)
    expect(files.map((f) => f.relative)).toEqual(['Notes/Alpha.md', 'Notes/Beta.md', 'Gamma.md'])
  })
})

describe('rankFiles', () => {
  it('puts a stem match above a path substring', () => {
    const files = vaultFiles(TREE)
    expect(rankFiles(files, 'beta')[0]?.relative).toBe('Notes/Beta.md')
    expect(rankFiles(files, 'notes')[0]?.relative).toBe('Notes/Alpha.md')
  })
})
