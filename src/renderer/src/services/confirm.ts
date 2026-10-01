/**
 * Queue for yes/no prompts.
 *
 * This lives outside `components/` on purpose. `state/file-state.ts` needs to
 * ask the user before discarding unsaved work, and importing the component
 * directly made the state singleton transitively depend on Lit and on a custom
 * element being registered. The component is loaded on first use instead.
 */
const pending: Array<(value: boolean) => void> = []

let defined: Promise<void> | null = null

function ensureDialogDefined(): Promise<void> {
  defined ??= import('../components/ConfirmDialog').then(() => undefined)
  return defined
}

/**
 * Ask a yes/no question and resolve with the answer.
 *
 * A single module-level resolver cannot serve two overlapping prompts: the
 * second call overwrites the first and the first promise never settles, hanging
 * whoever awaited it. The FIFO queue keeps every caller paired with its own
 * answer, and a new prompt settles anything still queued behind it as
 * cancelled.
 */
export async function showConfirm(message: string, title = 'Confirm'): Promise<boolean> {
  await ensureDialogDefined()
  const dialog = ensureDialog()

  return new Promise<boolean>((resolve) => {
    if (dialog.open) {
      while (pending.length > 0) pending.shift()?.(false)
    } else {
      dialog.titleText = title
      dialog.message = message
      dialog.open = true
    }
    pending.push(resolve)
  })
}

interface ConfirmElement extends HTMLElement {
  open: boolean
  titleText: string
  message: string
}

function ensureDialog(): ConfirmElement {
  const existing = document.querySelector('writemd-confirm')
  if (existing) return existing as ConfirmElement
  const dialog = document.createElement('writemd-confirm') as ConfirmElement
  document.body.appendChild(dialog)
  return dialog
}

/** Called by the dialog component when the user answers. */
export function settleConfirm(value: boolean): void {
  const resolve = pending.shift()
  resolve?.(value)
}
