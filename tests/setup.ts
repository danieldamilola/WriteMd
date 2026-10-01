/**
 * Vitest setup.
 *
 * The suite ran under `environment: 'node'` until now, which meant no DOM at
 * all. Two setup pieces the renderer depends on:
 *
 * 1. `window.matchMedia`, which the themes and some panels call to follow the
 *    OS colour scheme. jsdom does not implement it.
 * 2. `ResizeObserver`, which the tab strip and editor panes attach. jsdom has
 *    no layout engine, so nothing would ever resize, but the constructor still
 *    has to exist or the code throws on construction.
 *
 * The stubs are deliberately inert. They do not simulate layout, and no test
 * asserts on geometry, so a passing test cannot depend on these returning
 * realistic values.
 */
import { afterEach, vi } from 'vitest'

if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false
      }) as unknown as MediaQueryList
  }

  if (!('ResizeObserver' in window)) {
    class NoopResizeObserver {
      observe(): void {
        // Inert by design: jsdom has no layout, so nothing ever resizes, and no
        // test asserts on geometry.
      }
      unobserve(): void {
        // see observe()
      }
      disconnect(): void {
        // see observe()
      }
    }
    const ctor = NoopResizeObserver as unknown as new () => ResizeObserver
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ctor
    ;(window as unknown as { ResizeObserver?: unknown }).ResizeObserver = ctor
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})
