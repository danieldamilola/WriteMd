import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsStore } from '../src/renderer/src/state/settings'
import '../src/renderer/src/components/WelcomeScreen'
import type { WelcomeScreen } from '../src/renderer/src/components/WelcomeScreen'

const { listFiles } = vi.hoisted(() => ({ listFiles: vi.fn() }))
vi.mock('../src/renderer/src/api', () => ({ api: () => ({ vault: { listFiles } }) }))

describe('welcome screen data and actions', () => {
  let settings: SettingsStore
  beforeEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
    listFiles.mockReset().mockResolvedValue([])
    settings = new SettingsStore()
    vi.spyOn(SettingsStore, 'getInstance').mockReturnValue(settings)
  })
  function mount(): WelcomeScreen {
    const element = document.createElement('writemd-welcome-screen')
    document.body.appendChild(element)
    return element
  }

  it('opens the complete stored path and refreshes recent notes while mounted', async () => {
    settings.set('files.recentFiles', ['C:/vault/First.md'])
    const element = mount()
    await element.updateComplete
    const opened = vi.fn()
    element.addEventListener('open-recent', opened)
    element.shadowRoot!.querySelector<HTMLButtonElement>('.recent-item')!.click()
    expect(opened.mock.calls[0][0].detail).toEqual({ path: 'C:/vault/First.md' })
    settings.set('files.recentFiles', ['D:/external/Latest.md'])
    await element.updateComplete
    expect(element.shadowRoot!.querySelector('.file-name')!.textContent).toBe('Latest')
    expect(element.shadowRoot!.querySelector('.file-path')!.textContent).toBe('external/Latest.md')
  })

  it('does not replace new recent notes with an older vault response', async () => {
    let finish: ((files: Array<{ name: string; path: string }>) => void) | undefined
    listFiles.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const element = mount()
    settings.set('files.recentFiles', ['C:/vault/New.md'])
    await element.updateComplete
    finish!([{ name: 'Old.md', path: 'C:/vault/Old.md' }])
    await Promise.resolve()
    await element.updateComplete
    expect(element.shadowRoot!.querySelector('.file-name')!.textContent).toBe('New')
    expect(element.shadowRoot!.querySelector('h2')!.textContent).toBe('Recent notes')
  })

  it('updates shortcut hints and removes a hint when its action is unbound', async () => {
    const element = mount()
    await element.updateComplete
    settings.set('shortcuts.bindings', { 'new-file': 'Ctrl+Shift+N', 'open-file': '' })
    await element.updateComplete
    expect(element.shadowRoot!.querySelectorAll('kbd')).toHaveLength(1)
    expect(element.shadowRoot!.querySelector('kbd')!.textContent).toBe('Ctrl+Shift+N')
  })
})
