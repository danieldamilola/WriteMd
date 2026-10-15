import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '../src/renderer/src/components/ai/Composer'
import {
  AiComposer,
  type ComposerSendDetail,
  mentionStartAt,
  rankFiles,
  vaultFiles
} from '../src/renderer/src/components/ai/Composer'
import type { VaultTreeNode } from '../src/shared/electron-api'
import { on } from '../src/renderer/src/events/bus'
import { SettingsStore } from '../src/renderer/src/state/settings'
import type { AiSkillsView } from '../src/shared/ai/skills'
import { ChatgptState } from '../src/renderer/src/state/chatgpt'
import type { ChatgptAuthView } from '../src/shared/ai/chatgpt'

const CONNECTED: ChatgptAuthView = {
  connected: true,
  pending: false,
  activeId: 'client-1',
  accounts: [{ id: 'client-1', label: 'ChatGPT account' }],
  error: null,
  sessionOnly: false,
  needsWelcome: false
}

/**
 * The composer's mention picker has one rule that matters more than the rest:
 * `@` only starts a mention when it starts a word.
 *
 * `email@example.com` is not a mention, and a picker that opens there turns a
 * perfectly ordinary sentence into a file browser mid-address. That is the case
 * the fourth test pins, because it is the one that made the feature unusable
 * the first time it was built.
 *
 * jsdom has no layout. The resize regression supplies line and scroll
 * measurements; Electron tests check the rendered composer height.
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

  it('hides the ChatGPT plan notice once the conversation has started', async () => {
    const settings = SettingsStore.getInstance()
    const chatgpt = ChatgptState.getInstance()
    const previousProvider = settings.get<string>('ai.providerId', '')
    settings.set('ai.providerId', 'chatgpt')
    try {
      const el = await mount()
      // Signed out: nothing to say, and the sign-in prompt takes the empty state.
      expect(el.shadowRoot?.querySelector('.plan-status')).toBeNull()

      // The real apply, because it is what notifies the composer. Replacing it
      // would leave the card unrendered and the test would prove nothing.
      chatgpt.apply(CONNECTED)
      await settle(el)
      const notice = el.shadowRoot?.querySelector('.plan-status')
      expect(notice?.textContent).toContain('Using ChatGPT plan')

      // First message sent. The notice is empty-state chrome and now stacks a
      // third card on the transcript.
      el.started = true
      await settle(el)
      expect(el.shadowRoot?.querySelector('.plan-status')).toBeNull()
    } finally {
      chatgpt.apply({
        connected: false,
        pending: false,
        activeId: null,
        accounts: [],
        error: null,
        sessionOnly: false,
        needsWelcome: false
      })
      settings.set('ai.providerId', previousProvider)
    }
  })

  it('grows a multiline draft, caps its height, and returns to its compact height on reset', async () => {
    const el = await mount()
    const textarea = input(el)
    textarea.style.lineHeight = '20px'
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => Math.max(40, textarea.value.split('\n').length * 20)
    })
    type(el, 'First line\nSecond line\nThird line')
    await settle(el)
    expect(textarea.style.height).toBe('60px')
    type(el, Array.from({ length: 20 }, (_, index) => `Line ${index}`).join('\n'))
    await settle(el)
    expect(textarea.style.height).toBe('160px')
    expect(el.text).toContain('Line 19')
    el.resetDraft()
    await settle(el)
    expect(textarea.style.height).toBe('40px')
    expect(textarea.value).toBe('')
  })

  it('shows guidance inside the prompt and changes it for selected text', async () => {
    const el = await mount()
    expect(input(el).placeholder).toBe('Ask WriteMd…')
    expect(input(el).title).toContain('@ for notes')
    expect(el.shadowRoot!.querySelector('.hint')).toBeNull()
    expect(el.shadowRoot!.textContent).not.toContain('Shift+Enter for a new line')
    el.hasSelection = true
    await settle(el)
    expect(input(el).placeholder).toBe('Ask about your selection…')
  })

  it('opens the AI settings section through the app navigation bus', async () => {
    const settings = SettingsStore.getInstance()
    const previousEnabled = settings.get('ai.enabled', false)
    const previousKeySet = settings.get('ai.apiKeySet', false)
    const previousProvider = settings.get('ai.providerId', 'openai')
    const opened = vi.fn()
    const unsubscribe = on('settings:open', opened)
    Object.assign(window.electronAPI!, { ai: {} })
    settings.setMany(
      { 'ai.enabled': true, 'ai.providerId': 'openai', 'ai.apiKeySet': false },
      false
    )
    try {
      const el = await mount()
      expect(el.shadowRoot!.querySelector('.setup')?.textContent).toContain('Add your API key')
      el.shadowRoot!.querySelector<HTMLButtonElement>('.setup button')!.click()
      expect(opened).toHaveBeenCalledExactlyOnceWith({ tab: 'ai' })
    } finally {
      unsubscribe()
      settings.setMany(
        {
          'ai.enabled': previousEnabled,
          'ai.providerId': previousProvider,
          'ai.apiKeySet': previousKeySet
        },
        false
      )
    }
  })

  it('shows the model picker in the panel and leaves it out of the floating bar', async () => {
    const panel = await mount()
    expect(panel.shadowRoot!.querySelector('writemd-ai-model-picker')).not.toBeNull()

    const bar = await mount()
    bar.compact = true
    bar.modelPicker = false
    await settle(bar)
    expect(bar.shadowRoot!.querySelector('writemd-ai-model-picker')).toBeNull()
    // Attach and send survive: they are the bar's whole control set.
    expect(bar.shadowRoot!.querySelector('button[aria-label="Attach a file"]')).not.toBeNull()
    expect(bar.shadowRoot!.querySelector('button[aria-label="Send message"]')).not.toBeNull()
  })

  it('opens one line tall, not at the textarea default height', async () => {
    const el = await mount()
    // `rows` is taller than one line of prompt, so an unmeasured textarea opens
    // the bar as a two-line box with its controls pushed to the bottom corner.
    const rows = input(el).getAttribute('rows')
    expect(rows).toBe('1')
  })

  it('does not consume IME Enter while a file suggestion is open', async () => {
    const el = await mount()
    type(el, '@Al')
    await settle(el)
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      bubbles: true,
      cancelable: true
    })
    input(el).dispatchEvent(event)
    await settle(el)
    expect(event.defaultPrevented).toBe(false)
    expect(input(el).value).toBe('@Al')
  })

  it('keeps a draft while busy and exposes an accessible stop action', async () => {
    const el = await mount()
    el.busy = true
    type(el, 'next thought')
    await settle(el)
    press(el, 'Enter')
    expect(input(el).value).toBe('next thought')
    let stopped = false
    el.addEventListener('composer-stop', () => {
      stopped = true
    })
    el.shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="Stop response"]')!.click()
    expect(stopped).toBe(true)
  })

  it('sets a suggested prompt without sending it', async () => {
    const el = await mount()
    el.setPrompt('Summarize this note')
    await settle(el)
    expect(input(el).value).toBe('Summarize this note')
    expect(el.shadowRoot!.activeElement).toBe(input(el))
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

  it('preserves a long file reference when its visible label is truncated', async () => {
    const name = `Draft ${'long filename '.repeat(12)}.md`
    const relative = `Notes/${name}`
    const bridge = window.electronAPI!
    vi.spyOn(bridge.vault, 'getTree').mockResolvedValue({
      name: 'Vault',
      path: 'C:/vault',
      isDirectory: true,
      children: [{ name, path: `C:/vault/${relative}`, isDirectory: false }]
    })
    const el = await mount()
    type(el, '@Draft')
    await settle(el)
    const option = options(el)[0]
    expect(option.title).toBe(relative)
    expect(option.querySelector('.mention-name')?.textContent).toBe(name)
    press(el, 'Enter')
    await settle(el)
    expect(input(el).value).toBe(`@"${relative}" `)
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

  it('sends a literal slash prompt when no file matches it', async () => {
    const el = await mount()
    type(el, '/unknown-command')
    await settle(el)
    const sent = vi.fn()
    el.addEventListener('composer-send', sent)
    press(el, 'Enter')
    await settle(el)
    expect(sent).toHaveBeenCalledTimes(1)
    expect((sent.mock.calls[0][0] as CustomEvent<ComposerSendDetail>).detail.text).toBe(
      '/unknown-command'
    )
  })

  it('closes file suggestions when a suggested prompt replaces the draft', async () => {
    const el = await mount()
    type(el, '@')
    await settle(el)
    expect(options(el)).toHaveLength(3)
    el.setPrompt('Summarize this note')
    await settle(el)
    expect(options(el)).toHaveLength(0)
    expect(input(el).value).toBe('Summarize this note')
  })

  it('discards an attachment read when its conversation draft is reset', async () => {
    const el = await mount()
    let reader: FileReader | undefined
    const readFile = vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (
      this: FileReader
    ) {
      reader = this as FileReader
    })
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', {
      value: { files: [new File(['old note'], 'old.md', { type: 'text/plain' })] }
    })
    el.shadowRoot!.querySelector('.composer')!.dispatchEvent(drop)
    await settle(el)
    expect(el.shadowRoot!.textContent).toContain('Reading attachments')
    el.resetDraft()
    Object.defineProperty(reader!, 'result', { value: 'old note' })
    reader!.dispatchEvent(new Event('load'))
    await settle(el)
    expect(el.shadowRoot!.querySelector('.chip')).toBeNull()
    expect(el.shadowRoot!.textContent).not.toContain('Reading attachments')
    readFile.mockRestore()
  })
})

describe('AI skill autocomplete', () => {
  const listSkills = vi.fn<() => Promise<AiSkillsView>>()
  const getTree = vi.fn<() => Promise<VaultTreeNode>>()
  const settings = SettingsStore.getInstance()
  let previous: Record<string, unknown>

  beforeEach(() => {
    installBridge()
    getTree.mockReset().mockResolvedValue(TREE)
    listSkills.mockReset().mockResolvedValue({
      folder: 'C:/vault/.writemd/skills',
      skills: [
        { name: 'alpha', description: 'Polish the selected writing.' },
        { name: 'outline', description: 'Plan a note before writing.' }
      ],
      warnings: []
    })
    Object.assign(window.electronAPI!, { ai: { listSkills }, vault: { getTree } })
    previous = {
      'ai.enabled': settings.get('ai.enabled', false),
      'ai.providerId': settings.get('ai.providerId', 'openai'),
      'ai.model': settings.get('ai.model', '')
    }
    settings.setMany({ 'ai.enabled': true, 'ai.providerId': 'lmstudio', 'ai.model': 'test' }, false)
  })

  afterEach(() => {
    settings.setMany(previous, false)
    clearBridge()
  })

  it('opens a leading slash skill menu and inserts a chosen skill without replacing it with a file', async () => {
    const el = await mount()
    expect(input(el).title).toContain('/ for skills')
    type(el, '/')
    await settle(el)
    expect(el.shadowRoot!.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe(
      'Skills'
    )
    expect(options(el).map((option) => option.querySelector('.mention-name')?.textContent)).toEqual(
      ['/alpha', '/outline']
    )
    expect(options(el)[0].querySelector('.mention-path')?.textContent).toBe(
      'Polish the selected writing.'
    )
    type(el, '/alpha')
    await settle(el)
    expect(listSkills).toHaveBeenCalledOnce()
    press(el, 'Enter')
    await settle(el)
    expect(input(el).value).toBe('/alpha ')
    expect(options(el)).toHaveLength(0)
    type(el, '/alpha Improve this sentence')
    await settle(el)
    const sent = vi.fn()
    el.addEventListener('composer-send', sent)
    press(el, 'Enter')
    expect((sent.mock.calls[0][0] as CustomEvent<ComposerSendDetail>).detail.text).toBe(
      '/alpha Improve this sentence'
    )
  })

  it('refreshes the skill list when slash suggestions reopen', async () => {
    const el = await mount()
    type(el, '/')
    await settle(el)
    press(el, 'Escape')
    await settle(el)
    listSkills.mockResolvedValueOnce({
      folder: 'C:/vault/.writemd/skills',
      skills: [{ name: 'new-skill', description: 'New instructions.' }],
      warnings: []
    })
    type(el, '/')
    await settle(el)
    expect(listSkills).toHaveBeenCalledTimes(2)
    expect(options(el)[0].querySelector('.mention-name')?.textContent).toBe('/new-skill')
  })

  it('ignores a late skill fetch after the draft changes to an @ note reference', async () => {
    let resolve!: (view: AiSkillsView) => void
    listSkills.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const el = await mount()
    type(el, '/')
    await settle(el)
    type(el, '@Al')
    await settle(el)
    expect(options(el)[0].textContent).toContain('Alpha.md')
    resolve({
      folder: 'C:/vault/.writemd/skills',
      skills: [{ name: 'late', description: 'A late result.' }],
      warnings: []
    })
    await settle(el)
    expect(options(el)[0].textContent).toContain('Alpha.md')
    expect(el.shadowRoot!.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe(
      'Files'
    )
  })

  it('keeps slash paths as ordinary text and reserves file references for @', async () => {
    const el = await mount()
    type(el, '/Notes/Al')
    await settle(el)
    expect(options(el)).toHaveLength(0)
    expect(getTree).not.toHaveBeenCalled()
    type(el, '@Notes/Al')
    await settle(el)
    expect(options(el)[0].textContent).toContain('Alpha.md')
    press(el, 'Enter')
    await settle(el)
    expect(input(el).value).toBe('@Notes/Alpha.md ')
    type(el, '/missing-skill Explain this note')
    await settle(el)
    expect(options(el)).toHaveLength(0)
    expect(input(el).value).toBe('/missing-skill Explain this note')
  })

  it.each([' /', '\n\t/'])('loads only skills after leading whitespace %j', async (prefix) => {
    const el = await mount()
    type(el, prefix)
    await settle(el)
    expect(el.shadowRoot!.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe(
      'Skills'
    )
    expect(options(el).map((option) => option.querySelector('.mention-name')?.textContent)).toEqual(
      ['/alpha', '/outline']
    )
    expect(getTree).not.toHaveBeenCalled()
    press(el, 'Tab')
    await settle(el)
    expect(input(el).value).toBe(`${prefix}alpha `)
  })

  it('keeps missing discovery in the skill menu instead of loading files', async () => {
    Reflect.deleteProperty(window.electronAPI!.ai, 'listSkills')
    const el = await mount()
    type(el, '/')
    await settle(el)
    expect(options(el)).toHaveLength(0)
    expect(el.shadowRoot!.querySelector('.mention-status')?.textContent).toContain(
      'Restart WriteMd'
    )
    expect(getTree).not.toHaveBeenCalled()
    type(el, '@Al')
    await settle(el)
    expect(options(el)[0].textContent).toContain('Alpha.md')
    expect(el.shadowRoot!.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe(
      'Files'
    )
    expect(el.shadowRoot!.querySelector('.mention-status')).toBeNull()
  })

  it('distinguishes an empty skill list from a query with no matching skill', async () => {
    listSkills.mockResolvedValueOnce({ folder: 'C:/vault/Skills', skills: [], warnings: [] })
    const el = await mount()
    type(el, '/')
    await settle(el)
    expect(options(el)).toHaveLength(0)
    expect(el.shadowRoot!.querySelector('.mention-status')?.textContent).toContain(
      'No personal skills found'
    )
    press(el, 'Escape')
    type(el, '/missing')
    await settle(el)
    expect(el.shadowRoot!.querySelector('.mention-status')?.textContent).toContain(
      'No matching skills'
    )
    expect(options(el)).toHaveLength(0)
    expect(getTree).not.toHaveBeenCalled()
  })

  it('keeps discovery errors out of the file picker and retries when reopened', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    listSkills.mockRejectedValueOnce(new Error('Skill discovery unavailable'))
    const el = await mount()
    type(el, '/')
    await settle(el)
    expect(options(el)).toHaveLength(0)
    expect(el.shadowRoot!.querySelector('.mention-status')?.textContent).toContain(
      'Could not load skills'
    )
    expect(getTree).not.toHaveBeenCalled()
    press(el, 'Escape')
    type(el, '/')
    await settle(el)
    expect(options(el)).toHaveLength(2)
    expect(listSkills).toHaveBeenCalledTimes(2)
  })

  it('ignores a late file search after switching to skills', async () => {
    let resolve!: (tree: VaultTreeNode) => void
    getTree.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const el = await mount()
    type(el, '@')
    await settle(el)
    type(el, '/')
    await settle(el)
    resolve(TREE)
    await settle(el)
    expect(el.shadowRoot!.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe(
      'Skills'
    )
    expect(options(el).map((option) => option.querySelector('.mention-name')?.textContent)).toEqual(
      ['/alpha', '/outline']
    )
  })

  it.each(['review /', 'compare /Al', '/"Notes', '//', '/Notes/Al'])(
    'never uses a non-command slash %j for file suggestions',
    async (value) => {
      const el = await mount()
      type(el, value)
      await settle(el)
      expect(options(el)).toHaveLength(0)
      expect(getTree).not.toHaveBeenCalled()
      expect(listSkills).not.toHaveBeenCalled()
    }
  )
})

describe('mentionStartAt', () => {
  it('opens at the start of the value and after whitespace', () => {
    expect(mentionStartAt('@Al', 3)).toEqual({ start: 0, query: 'Al', trigger: '@' })
    expect(mentionStartAt('compare @Al', 11)).toEqual({ start: 8, query: 'Al', trigger: '@' })
  })

  it('refuses a mid-word @ and one already followed by a space', () => {
    expect(mentionStartAt('email@example.com', 17)).toBeNull()
    expect(mentionStartAt('see @Al then', 10)).toBeNull()
  })

  it('supports / trigger', () => {
    // The string '/notes/idea' has length 11, caret at 11 means full string
    expect(mentionStartAt('/notes/idea', 11)).toEqual({
      start: 0,
      query: 'notes/idea',
      trigger: '/'
    })
    // 'see /notes/idea then' - the / is at position 4, caret at end of 'idea' = 4 + 11 = 15
    expect(mentionStartAt('see /notes/idea then', 15)).toEqual({
      start: 4,
      query: 'notes/idea',
      trigger: '/'
    })
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
