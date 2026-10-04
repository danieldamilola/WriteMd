/**
 * One decision about motion, made once, for the whole app.
 *
 * Every animated thing in WriteMd used to ask the media query directly:
 * `@media (prefers-reduced-motion: reduce)` in component CSS, and
 * `matchMedia(...)` in the JS-driven effects. That is right in principle and it
 * is what made the app silent on this machine: Windows reports
 * `SPI_GETCLIENTAREAANIMATION = 0` when "Animation effects" is off, Chromium
 * turns that into `prefers-reduced-motion: reduce`, and then every animation,
 * transition and staged text reveal in the app is switched off with nothing on
 * screen to say why.
 *
 * The preference now lives in settings - system, full or reduced - and this
 * module resolves it into a single attribute on `<html>`:
 *
 *   system  -> follow the OS
 *   full    -> animate regardless of what the OS asked for
 *   reduced -> never animate
 *
 * Component styles test `:host-context([data-motion='reduced'])` instead of the
 * media query, so the override is the only thing that decides. The JS effects
 * ask `prefersReducedMotion()`.
 */

export type MotionPreference = 'system' | 'full' | 'reduced'

export const MOTION_PREFERENCES: readonly MotionPreference[] = ['system', 'full', 'reduced']

export const MOTION_LABELS: Record<MotionPreference, string> = {
  system: 'Match system',
  full: 'Always animate',
  reduced: 'Never animate'
}

const QUERY = '(prefers-reduced-motion: reduce)'

let preference: MotionPreference = 'system'

function systemWantsLess(): boolean {
  return (
    typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches === true
  )
}

/** What the preference resolves to right now. */
export function reducedMotionNow(): boolean {
  if (preference === 'full') return false
  if (preference === 'reduced') return true
  return systemWantsLess()
}

function effective(): 'full' | 'reduced' {
  return reducedMotionNow() ? 'reduced' : 'full'
}

/**
 * Write the resolved value onto `<html>`. Cheap and idempotent; called at
 * startup and whenever the setting changes, including when the OS flips the
 * preference while the app is open.
 */
export function applyMotionPreference(next?: MotionPreference): void {
  if (next !== undefined) preference = next
  const root = typeof document === 'undefined' ? null : document.documentElement
  if (!root) return
  const value = effective()
  if (root.dataset.motion !== value) root.dataset.motion = value
}

/** Keep the attribute honest if the OS preference changes mid-session. */
export function watchSystemMotionPreference(): void {
  if (typeof window.matchMedia !== 'function') return
  const query = window.matchMedia(QUERY)
  const onChange = (): void => {
    if (preference === 'system') applyMotionPreference()
  }
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange)
  } else if (typeof query.addListener === 'function') {
    query.addListener(onChange)
  }
}