import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { initAutoHideScrollbars } from '../src/renderer/src/utils/auto-hide-scrollbars'

describe('auto-hide scrollbars', () => {
  let teardown: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    teardown = initAutoHideScrollbars()
  })

  afterEach(() => {
    teardown()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('marks the scroller while scrolling and clears it when idle', () => {
    const scroller = document.createElement('div')
    scroller.style.overflow = 'auto'
    document.body.appendChild(scroller)
    scroller.dispatchEvent(new Event('scroll', { bubbles: false, cancelable: false }))
    expect(scroller.classList.contains('is-scrolling')).toBe(true)
    vi.advanceTimersByTime(901)
    expect(scroller.classList.contains('is-scrolling')).toBe(false)
  })

  it('keeps the class while scrolling continues', () => {
    const scroller = document.createElement('div')
    document.body.appendChild(scroller)
    scroller.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(800)
    scroller.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(800)
    expect(scroller.classList.contains('is-scrolling')).toBe(true)
    vi.advanceTimersByTime(101)
    expect(scroller.classList.contains('is-scrolling')).toBe(false)
  })

  it('marks scrollers inside shadow roots mounted later', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const inner = document.createElement('div')
    inner.style.overflow = 'auto'
    shadow.appendChild(inner)
    inner.dispatchEvent(new Event('scroll', { bubbles: false, cancelable: false }))
    expect(inner.classList.contains('is-scrolling')).toBe(true)
  })

  it('marks scrollers in roots that already existed at startup', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const inner = document.createElement('div')
    host.attachShadow({ mode: 'open' }).appendChild(inner)
    teardown()
    teardown = initAutoHideScrollbars()
    inner.dispatchEvent(new Event('scroll'))
    expect(inner.classList.contains('is-scrolling')).toBe(true)
  })

  it('stops marking after teardown', () => {
    const scroller = document.createElement('div')
    document.body.appendChild(scroller)
    teardown()
    scroller.dispatchEvent(new Event('scroll'))
    expect(scroller.classList.contains('is-scrolling')).toBe(false)
  })

  it('re-attaches when initialised again after a teardown', () => {
    // Teardown has to clear the "already attached" bookkeeping, not just the
    // listeners. Root membership is kept in a WeakSet precisely because it does
    // not retain roots, and a WeakSet has no clear(), so the teardown walk is the
    // only place that can undo it. Miss that and a second init finds every root
    // still attached, installs nothing, and the scrollbars stay hidden for good.
    const scroller = document.createElement('div')
    document.body.appendChild(scroller)
    teardown()
    teardown = initAutoHideScrollbars()
    scroller.dispatchEvent(new Event('scroll'))
    expect(scroller.classList.contains('is-scrolling')).toBe(true)
  })

  it('covers a shadow root created after a re-init', () => {
    const teardownAgain = initAutoHideScrollbars()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const inner = document.createElement('div')
    host.attachShadow({ mode: 'open' }).appendChild(inner)
    inner.dispatchEvent(new Event('scroll'))
    expect(inner.classList.contains('is-scrolling')).toBe(true)
    teardownAgain()
  })
})
