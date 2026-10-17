import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from '../src/renderer/src/components/SettingsModal'
import { SettingsStore } from '../src/renderer/src/state/settings'
import { FileState } from '../src/renderer/src/state/file-state'

vi.mock('@awesome.me/webawesome/dist/components/select/select.js', () => ({}))

const settings = SettingsStore.getInstance()
const restart = vi.fn().mockResolvedValue(undefined)
const save = vi.fn().mockResolvedValue(undefined)

async function settle(element: SettingsModal): Promise<void> {
  await element.updateComplete
  await new Promise((resolve) => setTimeout(resolve, 0))
  await element.updateComplete
}

async function mount(): Promise<SettingsModal> {
  const element = new SettingsModal()
  element.embedded = true
  element.initialTab = 'system'
  document.body.append(element)
  await settle(element)
  return element
}

function button(element: SettingsModal, label: string): HTMLButtonElement {
  const found = [...element.shadowRoot!.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label
  )
  if (!found) throw new Error('Missing button: ' + label)
  return found
}

describe('hardware acceleration in Settings', () => {
  beforeEach(() => {
    restart.mockClear()
    save.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        app: { getHardwareAccelerationSetting: async () => true, restart },
        settings: { set: save }
      }
    })
    settings.setMany({ 'advanced.hardwareAcceleration': true }, false)
  })

  afterEach(async () => {
    document.body.replaceChildren()
    await settings.whenSaved()
    Reflect.deleteProperty(window, 'electronAPI')
  })

  it('shows restart only while the saved choice differs from this launch', async () => {
    const element = await mount()
    const toggle = element.shadowRoot!.querySelector<HTMLButtonElement>(
      '[aria-label="Hardware acceleration"]'
    )!
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    toggle.click()
    await settle(element)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(button(element, 'Restart WriteMd')).toBeDefined()
    toggle.click()
    await settle(element)
    expect(element.shadowRoot!.textContent).not.toContain('Restart WriteMd to apply')
  })

  it('waits for the settings write before restarting', async () => {
    const element = await mount()
    let finish!: () => void
    save.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
    settings.set('advanced.hardwareAcceleration', false)
    await settle(element)
    button(element, 'Restart WriteMd').click()
    await settle(element)
    expect(restart).not.toHaveBeenCalled()
    finish()
    await settle(element)
    expect(restart).toHaveBeenCalledOnce()
  })

  it('keeps unsaved notes open when Restart is pressed', async () => {
    const element = await mount()
    settings.set('advanced.hardwareAcceleration', false)
    await settle(element)
    const files = FileState.getInstance()
    vi.spyOn(files, 'getState').mockReturnValue({ ...files.getState(), dirty: true })
    button(element, 'Restart WriteMd').click()
    await settle(element)
    expect(restart).not.toHaveBeenCalled()
    expect(element.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(
      'Save your notes before restarting'
    )
  })

  it('does not restart when saving the preference fails', async () => {
    const element = await mount()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    save.mockRejectedValueOnce(new Error('Disk is full'))
    settings.set('advanced.hardwareAcceleration', false)
    await settle(element)
    button(element, 'Restart WriteMd').click()
    await settle(element)
    expect(restart).not.toHaveBeenCalled()
    expect(element.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(
      'Settings could not be saved'
    )
  })
})
