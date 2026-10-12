import { describe, it, expect, vi, beforeEach } from 'vitest'
import { on, emit, resetBus } from '../src/renderer/src/events/bus'

/**
 * These two signals used to be untyped `window` CustomEvents. The failure modes
 * that motivated a bus: a typo in an event name was a silent runtime no-op, and
 * a subscriber could not be torn down without holding the exact listener
 * reference. Both are covered here.
 */
describe('app event bus', () => {
  beforeEach(() => {
    resetBus()
  })

  it('delivers a payload to a subscriber', () => {
    const seen: Array<{ mode: string }> = []
    on('find:open', (d) => seen.push(d))
    emit('find:open', { mode: 'replace' })
    expect(seen).toEqual([{ mode: 'replace' }])
  })

  it('delivers to every subscriber', () => {
    const a = vi.fn()
    const b = vi.fn()
    on('find:open', a)
    on('find:open', b)
    emit('find:open', { mode: 'find' })
    expect(a).toHaveBeenCalledOnce()
    expect(b).toHaveBeenCalledOnce()
  })

  it('stops delivering after unsubscribe', () => {
    const seen = vi.fn()
    const off = on('wiki:open', seen)
    emit('wiki:open', { name: 'a' })
    off()
    emit('wiki:open', { name: 'b' })
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen).toHaveBeenCalledWith({ name: 'a' })
  })

  it('is a no-op when nobody is listening', () => {
    expect(() => emit('find:open', { mode: 'find' })).not.toThrow()
  })

  it('keeps channels independent', () => {
    const find = vi.fn()
    const wiki = vi.fn()
    on('find:open', find)
    on('wiki:open', wiki)
    emit('wiki:open', { name: 'note' })
    expect(find).not.toHaveBeenCalled()
    expect(wiki).toHaveBeenCalledOnce()
  })

  it('one throwing handler does not stop the others', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const after = vi.fn()
    on('find:open', () => {
      throw new Error('boom')
    })
    on('find:open', after)
    emit('find:open', { mode: 'find' })
    expect(after).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('tolerates a subscriber unsubscribing during dispatch', () => {
    const second = vi.fn()
    const off = on('find:open', () => off())
    on('find:open', second)
    expect(() => emit('find:open', { mode: 'find' })).not.toThrow()
    expect(second).toHaveBeenCalledOnce()
  })

  it('drops every subscription on reset', () => {
    const seen = vi.fn()
    on('find:open', seen)
    resetBus()
    emit('find:open', { mode: 'find' })
    expect(seen).not.toHaveBeenCalled()
  })
})
