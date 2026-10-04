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
})