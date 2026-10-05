import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// Side-effect import: registers <writemd-update-button>.
import '../src/renderer/src/components/UpdateButton'
import type { WriteMdUpdateButton } from '../src/renderer/src/components/UpdateButton'

/**
 * The update button's three live states and the hover card on each.
 *
 * The updater is faked at the bridge rather than driven for real: a real check
 * needs a published release, cannot force a mid-download frame, and cannot
 * assert on a hover. What is under test is the component's mapping of state to
 * badge and card text.
 */

type Status = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

const VERSION = '1.3.0'

type Listener = (info: { version?: string; percent?: number }) => void

const listeners: Record<string, Listener[]> = {
  available: [],
  notAvailable: [],
  progress: [],
  downloaded: [],
  error: []
}

function sub(key: string) {
  return (cb: Listener) => {
    listeners[key].push(cb)
    return () => {
      listeners[key] = listeners[key].filter((fn) => fn !== cb)
    }
  }
}

const updater = {
  getState: async (): Promise<{
    status: Status
    version: string
    percent: number
    error: string
  }> => ({
    status: 'idle',
    version: '',
    percent: 0,
    error: ''
  }),
  check: async () => ({ updateInfo: { version: VERSION } }),
  download: async () => [] as string[],
  install: () => undefined,
  onUpdateAvailable: sub('available'),
  onUpdateNotAvailable: sub('notAvailable'),
  onUpdateDownloaded: sub('downloaded'),
  onDownloadProgress: sub('progress'),
  onError: sub('error')
}

const stored: Record<string, unknown> = {}

function installBridge(): void {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.electronAPI = {
    updater,
    settings: {
      get: async () => ({ ...stored }),
      set: async (patch: Record<string, unknown>) => {
        Object.assign(stored, patch)
      }
    }
  }
}

function clearBridge(): void {
  delete (globalThis as unknown as { window?: Record<string, unknown> }).window?.electronAPI
  for (const key of Object.keys(listeners)) listeners[key] = []
  for (const key of Object.keys(stored)) delete stored[key]
}

/** Fires the event main would fire for this state, the way the component reads it. */
function emit(status: Status, percent = 0): void {
  const key = {
    idle: 'notAvailable',
    checking: 'notAvailable',
    available: 'available',
    downloading: 'progress',
    downloaded: 'downloaded',
    error: 'error'
  }[status]
  const info = status === 'downloading' ? { percent } : { version: VERSION }
  for (const fn of listeners[key]) fn(info)
}

async function mount(): Promise<WriteMdUpdateButton> {
  const el = document.createElement('writemd-update-button') as WriteMdUpdateButton
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function settle(el: WriteMdUpdateButton): Promise<void> {
  await el.updateComplete
  const inner = el.shadowRoot?.querySelector('writemd-icon-button')
  if (inner) await (inner as unknown as { updateComplete: Promise<unknown> }).updateComplete
}

function wrap(el: WriteMdUpdateButton): HTMLElement | null {
  return el.shadowRoot?.querySelector('.wrap') ?? null
}

function card(el: WriteMdUpdateButton): HTMLElement | null {
  return el.shadowRoot?.querySelector('.card') ?? null
}

/** Hover is what opens the card, so the tests open it the same way. */
function hover(el: WriteMdUpdateButton): void {
  wrap(el)?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
}

describe('writemd-update-button', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    installBridge()
  })

  afterEach(() => {
    clearBridge()
  })

  it('renders nothing while idle, so the toolbar stays quiet', async () => {
    const el = await mount()
    expect(wrap(el)).toBeNull()
  })

  it('shows the red dot for a waiting update', async () => {
    const el = await mount()
    emit('available')
    await settle(el)
    expect(el.shadowRoot?.querySelector('.dot')).not.toBeNull()
  })

  it('names the version and the click action on hover', async () => {
    const el = await mount()
    emit('available')
    await settle(el)

    expect(card(el)?.classList.contains('open')).toBe(false)
    hover(el)
    await settle(el)

    const text = card(el)?.textContent ?? ''
    expect(text).toContain(`Update v${VERSION} available`)
    expect(text).toContain('Click to download')
  })

  it('summarizes the incoming release from the bundled notes', async () => {
    const el = await mount()
    emit('available')
    await settle(el)
    hover(el)
    await settle(el)

    const items = [...(card(el)?.querySelectorAll('li') ?? [])]
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThanOrEqual(3)
    // Bold lead-ins only: no prose, no markdown left in the text.
    for (const li of items) {
      expect(li.textContent ?? '').not.toContain('**')
    }
  })

  it('closes the card on mouse out', async () => {
    const el = await mount()
    emit('available')
    await settle(el)
    hover(el)
    await settle(el)
    expect(card(el)?.classList.contains('open')).toBe(true)

    wrap(el)?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
    await settle(el)
    expect(card(el)?.classList.contains('open')).toBe(false)
  })

  it('shows the ring and no dot while downloading', async () => {
    const el = await mount()
    emit('downloading', 40)
    await settle(el)

    expect(el.shadowRoot?.querySelector('.ring')).not.toBeNull()
    expect(el.shadowRoot?.querySelector('.dot')).toBeNull()
  })

  it('reports the percentage on the downloading card', async () => {
    const el = await mount()
    emit('downloading', 40)
    await settle(el)
    hover(el)
    await settle(el)

    const text = card(el)?.textContent ?? ''
    expect(text).toContain('Downloading update')
    expect(text).toContain('40%')
  })

  it('swaps the dot for the green check once the download finishes', async () => {
    const el = await mount()
    emit('downloaded')
    await settle(el)

    expect(el.shadowRoot?.querySelector('.check-badge')).not.toBeNull()
    expect(el.shadowRoot?.querySelector('.dot')).toBeNull()
    expect(el.shadowRoot?.querySelector('.ring')).toBeNull()
  })

  it('says the finished update is ready to install', async () => {
    const el = await mount()
    emit('downloaded')
    await settle(el)
    hover(el)
    await settle(el)

    const text = card(el)?.textContent ?? ''
    expect(text).toContain('Update ready')
    expect(text).toContain(`Click to install v${VERSION} and restart`)
  })

  it('collapses again on error', async () => {
    const el = await mount()
    emit('error')
    await settle(el)
    expect(wrap(el)).toBeNull()
  })

  it('hides the button when a version is skipped, and records it', async () => {
    const el = await mount()
    emit('available')
    await settle(el)
    hover(el)
    await settle(el)

    const skip = el.shadowRoot?.querySelector('.skip') as HTMLButtonElement
    expect(skip).not.toBeNull()
    skip.click()
    await settle(el)

    expect(wrap(el)).toBeNull()
    // Stored, so the next launch does not offer this release again. Read after
    // a tick because the settings write is async.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect((stored.updates as { skippedVersion?: string } | undefined)?.skippedVersion).toBe(
      VERSION
    )
  })

  it('does not skip by dismissing the card', async () => {
    const el = await mount()
    emit('available')
    await settle(el)
    hover(el)
    await settle(el)

    wrap(el)?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
    await settle(el)

    // The button stays: moving the mouse away is not declining.
    expect(wrap(el)).not.toBeNull()
    expect(
      (stored.updates as { skippedVersion?: string } | undefined)?.skippedVersion
    ).toBeUndefined()
  })
})
