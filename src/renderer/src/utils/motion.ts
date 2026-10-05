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
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches === true
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

/*
 * The engine. One `animate()` for the whole app, so every scripted animation
 * gets the same timing, the same decision about reduced motion, and the same
 * promise shape. Durations match the CSS tokens in global.css: nothing scripted
 * runs longer than --motion-slower, and entrances and exits are asymmetric on
 * purpose - an exit that has to finish before a state change is allowed to be
 * shorter than an entrance that does not.
 */

/** Durations in ms, mirroring the `--motion-*` tokens. */
export const DURATION = {
  instant: 80,
  fast: 120,
  base: 160,
  slow: 220,
  slower: 320
} as const

export const EASING = {
  /** Default for anything entering or resizing. */
  out: 'cubic-bezier(0.22, 1, 0.36, 1)',
  /** For anything leaving. */
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  inOut: 'cubic-bezier(0.4, 0, 0.2, 1)'
} as const

export interface MotionOptions {
  duration?: number
  easing?: string
  delay?: number
  /** Keep the last frame applied once the animation finishes. */
  fill?: boolean | 'none' | 'forwards' | 'backwards' | 'both'
}

/**
 * Run a keyframe animation, or do nothing when motion is off.
 *
 * Returning a promise rather than the `Animation` keeps call sites in the shape
 * `await animate(...)` followed by the state change they actually wanted, which
 * is the whole reason exit animations are possible at all. Under reduced motion
 * the promise resolves on the next frame, so callers do not need their own
 * branch and there is still one paint between the decision and the change.
 */
export function animate(
  el: Element | null | undefined,
  keyframes: Keyframe[],
  options: MotionOptions = {}
): Promise<void> {
  if (!el) return Promise.resolve()
  const { duration = DURATION.base, easing = EASING.out, delay = 0, fill = false } = options
  if (reducedMotionNow()) {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()))
  }
  const animation = el.animate(keyframes, {
    duration,
    easing,
    delay,
    fill: fill === true ? 'forwards' : fill === false ? 'none' : fill
  })
  return animation.finished
    .then(() => {
      if (fill) animation.commitStyles?.()
      animation.cancel()
    })
    .catch(() => {
      /* cancelled: a newer animation for the same element took over */
    })
}

export type SlideAxis = 'x' | 'y'

/**
 * Slide an element out of the layout, the way a sidebar leaves: its own box
 * moves off the edge while the space it occupied closes behind it, so the
 * content beside it takes the space as it goes rather than after it.
 *
 * Returns when the element is safe to unmount.
 */
export function slideOut(
  el: HTMLElement | null | undefined,
  axis: SlideAxis = 'x',
  options: MotionOptions = {}
): Promise<void> {
  if (!el) return Promise.resolve()
  const rect = el.getBoundingClientRect()
  const distance = axis === 'x' ? rect.width : rect.height
  const shift = axis === 'x' ? { translateX: -distance } : { translateY: -distance }
  el.style.pointerEvents = 'none'
  return animate(
    el,
    [
      { opacity: 1, transform: 'translate(0, 0)' },
      { opacity: 0, transform: `translate(${shift.translateX ?? 0}px, ${shift.translateY ?? 0}px)` }
    ],
    { duration: DURATION.fast, easing: EASING.in, ...options }
  )
}

/** The inverse of `slideOut`, for an element that is already in the DOM. */
export function slideIn(
  el: HTMLElement | null | undefined,
  axis: SlideAxis = 'x',
  options: MotionOptions = {}
): Promise<void> {
  if (!el) return Promise.resolve()
  const rect = el.getBoundingClientRect()
  const distance = axis === 'x' ? rect.width : rect.height
  const from = axis === 'x' ? -distance : -distance
  const shift = axis === 'x' ? `translateX(${from}px)` : `translateY(${from}px)`
  el.style.pointerEvents = ''
  return animate(
    el,
    [
      { opacity: 0, transform: shift },
      { opacity: 1, transform: 'translate(0, 0)' }
    ],
    { duration: DURATION.base, easing: EASING.out, ...options }
  )
}

/**
 * Fade and lift a surface into place. One shape for every panel, popup and
 * dialog, so nothing arrives by a different route than anything else.
 */
export function reveal(el: HTMLElement | null | undefined): Promise<void> {
  return animate(
    el,
    [
      { opacity: 0, transform: 'translateY(6px) scale(0.99)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' }
    ],
    { duration: DURATION.fast, easing: EASING.out }
  )
}

/** The inverse of `reveal`, for a surface that has to disappear before unmount. */
export function conceal(el: HTMLElement | null | undefined): Promise<void> {
  return animate(
    el,
    [
      { opacity: 1, transform: 'translateY(0) scale(1)' },
      { opacity: 0, transform: 'translateY(4px) scale(0.99)' }
    ],
    { duration: DURATION.instant, easing: EASING.in }
  )
}

/**
 * A press is a scale, not a colour. Applied on pointer-down and released on the
 * next frame so a held button stays pressed and a click never leaves it stuck.
 */
export function press(el: HTMLElement | null | undefined): void {
  if (!el || reducedMotionNow()) return
  el.animate([{ transform: 'scale(1)' }, { transform: `scale(${PRESS_SCALE})` }], {
    duration: DURATION.instant,
    easing: EASING.out,
    fill: 'forwards'
  })
}

export const PRESS_SCALE = 0.985
