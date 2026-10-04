import { describe, it, expect, afterEach } from 'vitest'
import {
  applyMotionPreference,
  reducedMotionNow,
  watchSystemMotionPreference,
  type MotionPreference
} from '../src/renderer/src/utils/motion'

/**
 * The media query is the input; the setting is the decision. jsdom has no
 * opinion about reduced motion, so each case states what the "OS" asks for.
 */
function osAsksForLess(asks: boolean): () => void {
  const original = window.matchMedia
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion') ? asks : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false
    }) as unknown as MediaQueryList) as typeof window.matchMedia
  return () => {
    window.matchMedia = original
  }
}

describe('motion preference', () => {
  let restore: () => void

  afterEach(() => {
    restore?.()
    restore = () => {}
    applyMotionPreference('system')
  })

  it('follows the OS by default', () => {
    restore = osAsksForLess(true)
    applyMotionPreference()
    expect(reducedMotionNow()).toBe(true)
    expect(document.documentElement.dataset.motion).toBe('reduced')
  })

  it('animates when the OS allows motion', () => {
    restore = osAsksForLess(false)
    applyMotionPreference()
    expect(reducedMotionNow()).toBe(false)
    expect(document.documentElement.dataset.motion).toBe('full')
  })

  it('animates anyway when the preference is full', () => {
    restore = osAsksForLess(true)
    applyMotionPreference('full')
    expect(reducedMotionNow()).toBe(false)
    expect(document.documentElement.dataset.motion).toBe('full')
  })

  it('never animates when the preference is reduced, whatever the OS says', () => {
    restore = osAsksForLess(false)
    applyMotionPreference('reduced')
    expect(reducedMotionNow()).toBe(true)
    expect(document.documentElement.dataset.motion).toBe('reduced')
  })

  it('re-decides when the setting changes while running', () => {
    restore = osAsksForLess(false)
    applyMotionPreference('reduced')
    expect(reducedMotionNow()).toBe(true)
    applyMotionPreference('full')
    expect(reducedMotionNow()).toBe(false)
    expect(document.documentElement.dataset.motion).toBe('full')
  })

  it('tracks the OS changing mid-session, but only in system mode', () => {
    const listeners: Array<() => void> = []
    const original = window.matchMedia
    let asks = false
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? asks : false,
      media: query,
      onchange: null,
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: () => {},
      addListener: (fn: () => void) => listeners.push(fn),
      removeListener: () => {},
      dispatchEvent: () => false
    })) as unknown as typeof window.matchMedia
    restore = () => {
      window.matchMedia = original
    }

    applyMotionPreference('system')
    watchSystemMotionPreference()
    asks = true
    for (const fn of listeners) fn()
    expect(reducedMotionNow()).toBe(true)

    // An explicit choice is not second-guessed by the OS.
    applyMotionPreference('full')
    asks = false
    for (const fn of listeners) fn()
    expect(reducedMotionNow()).toBe(false)
  })

  it('keeps working when matchMedia is missing entirely', () => {
    const original = window.matchMedia
    // @ts-expect-error deliberately removing the API
    delete window.matchMedia
    restore = () => {
      window.matchMedia = original
    }
    const preference: MotionPreference = 'full'
    applyMotionPreference(preference)
    expect(reducedMotionNow()).toBe(false)
    expect(() => watchSystemMotionPreference()).not.toThrow()
  })
})