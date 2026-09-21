import { describe, it, expect } from 'vitest'
import { isOwnEcho, type TabDoc } from '../src/renderer/src/state/file-state'

function makeTab(overrides: Partial<TabDoc> = {}): TabDoc {
  return {
    path: 'C:/docs/note.md',
    content: 'hello',
    originalContent: 'original',
    mtime: 1,
    dirty: false,
    isVaultFile: true,
    lastWritten: null,
    pendingWrite: null,
    ...overrides
  }
}

describe('isOwnEcho', () => {
  it('treats disk content equal to originalContent as our own echo', () => {
    expect(isOwnEcho(makeTab(), 'original')).toBe(true)
  })

  it('treats disk content equal to lastWritten as our own echo', () => {
    expect(isOwnEcho(makeTab({ lastWritten: 'saved-v1' }), 'saved-v1')).toBe(true)
  })

  it('treats disk content equal to pendingWrite as our own echo', () => {
    expect(isOwnEcho(makeTab({ pendingWrite: 'saving-now' }), 'saving-now')).toBe(true)
  })

  it('ignores CRLF differences', () => {
    expect(isOwnEcho(makeTab({ lastWritten: 'line1\nline2' }), 'line1\r\nline2')).toBe(true)
  })

  it('flags foreign content as a real external change', () => {
    expect(isOwnEcho(makeTab(), 'someone else edited this')).toBe(false)
  })
})
