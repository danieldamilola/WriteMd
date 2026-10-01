import { describe, it, expect, vi, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * `showConfirm` used to keep a single module-level resolver. A second
 * overlapping prompt overwrote it, so the first promise never settled and
 * whoever awaited it hung forever. `closeTab`, `newFile` and `openFile` all
 * await it, so two quick tab closes wedged the tab array mid-update.
 *
 * This ran for a while against a hand-rolled `document` with three methods and
 * a mock of `lit` that stubbed LitElement out entirely, so nothing rendered and
 * the fake had no addEventListener, no CustomEvent, and no lifecycle. It runs
 * against jsdom and the real Lit element now.
 */

vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'writemd-confirm-test') },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => s }
}))

import { WriteMdConfirm } from '../src/renderer/src/components/ConfirmDialog'
import { showConfirm } from '../src/renderer/src/services/confirm'

/** The singleton dialog element showConfirm appends to document.body. */
function dialog(): WriteMdConfirm {
  const el = document.querySelector('writemd-confirm')
  if (!el) throw new Error('confirm dialog was never created')
  return el as WriteMdConfirm
}

/**
 * Wait for the dialog element to exist and for Lit to flush the property set
 * and render the buttons. `showConfirm` now awaits a dynamic import of the
 * component before it creates the element, and the first call in a file pays
 * for that module transform, so poll with a deadline rather than a fixed tick.
 */
async function settle(): Promise<void> {
  const deadline = Date.now() + 2000
  while (!document.querySelector('writemd-confirm') && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5))
  }
  await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

async function clickButton(label: 'Cancel' | 'OK'): Promise<void> {
  await settle()
  const buttons = Array.from(dialog().shadowRoot?.querySelectorAll('button') ?? [])
  const btn = buttons.find((b) => b.textContent?.trim() === label)
  if (!btn) throw new Error(`no ${label} button; got ${buttons.map((b) => b.textContent)}`)
  btn.click()
}

describe('showConfirm settles every caller', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('resolves true when confirmed', async () => {
    const promise = showConfirm('ok?')
    await clickButton('OK')
    await expect(promise).resolves.toBe(true)
  })

  it('resolves false when cancelled', async () => {
    const promise = showConfirm('ok?')
    await clickButton('Cancel')
    await expect(promise).resolves.toBe(false)
  })

  it('resolves false on Escape', async () => {
    const promise = showConfirm('ok?')
    await settle()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await expect(promise).resolves.toBe(false)
  })

  // The regression: this first promise used to never settle at all.
  it('settles the earlier prompt when a second one is requested', async () => {
    const first = showConfirm('first?')
    const second = showConfirm('second?')
    await expect(first).resolves.toBe(false)
    await clickButton('OK')
    await expect(second).resolves.toBe(true)
  })

  it('does not strand promises across three overlapping prompts', async () => {
    const a = showConfirm('a?')
    const b = showConfirm('b?')
    const c = showConfirm('c?')
    await expect(a).resolves.toBe(false)
    await expect(b).resolves.toBe(false)
    await clickButton('OK')
    await expect(c).resolves.toBe(true)
  })

  it('creates exactly one element no matter how many prompts', async () => {
    const first = showConfirm('one')
    const second = showConfirm('two')
    await expect(first).resolves.toBe(false)
    await clickButton('OK')
    await expect(second).resolves.toBe(true)
    expect(document.querySelectorAll('writemd-confirm')).toHaveLength(1)
  })

  it('applies the requested title and message to a fresh dialog', async () => {
    const promise = showConfirm('Delete this file?', 'Confirm delete')
    await settle()
    expect(dialog().message).toBe('Delete this file?')
    expect(dialog().titleText).toBe('Confirm delete')
    await clickButton('Cancel')
    await promise
  })

  it('a second prompt supersedes the copy already on screen', async () => {
    const first = showConfirm('first')
    await settle()
    expect(dialog().message).toBe('first')
    const second = showConfirm('second')
    await settle()
    // The visible dialog still shows the first message; the first caller has
    // been settled and the click answers the newest caller.
    expect(dialog().message).toBe('first')
    await expect(first).resolves.toBe(false)
    await clickButton('OK')
    await expect(second).resolves.toBe(true)
  })

  it('is a labelled modal dialog and is not rendered when closed', async () => {
    const promise = showConfirm('ok?', 'Confirm delete')
    await settle()
    const role = dialog().shadowRoot?.querySelector('[role="dialog"]')
    expect(role?.getAttribute('aria-modal')).toBe('true')
    expect(role?.getAttribute('aria-label')).toBe('Confirm delete')
    await clickButton('Cancel')
    await promise
    await settle()
    // Closed dialogs used to stay in the DOM with opacity 0, keeping their
    // buttons permanently in the tab order.
    expect(dialog().shadowRoot?.querySelector('[role="dialog"]')).toBeNull()
  })

  it('focuses the safe default and restores focus on close', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const promise = showConfirm('ok?')
    await settle()
    expect(dialog().shadowRoot?.activeElement?.textContent?.trim()).toBe('Cancel')

    await clickButton('Cancel')
    await promise
    await settle()
    expect(document.activeElement).toBe(opener)
  })
})
