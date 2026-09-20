import { describe, it, expect } from 'vitest'
import {
  parseBinding,
  normalizeBinding,
  bindingsEqual,
  bindingFromEvent,
  findConflict,
  fuzzyMatch,
  effectiveBinding,
  effectiveBindings
} from '../src/renderer/src/state/shortcuts'

describe('shortcut registry', () => {
  it('parses standard bindings', () => {
    expect(parseBinding('Ctrl+Shift+S')).toEqual({ mod: true, shift: true, alt: false, key: 's' })
    expect(parseBinding('Ctrl+,')).toEqual({ mod: true, shift: false, alt: false, key: ',' })
    expect(parseBinding('Ctrl+Alt+A')).toEqual({ mod: true, shift: false, alt: true, key: 'a' })
  })

  it('rejects modifier-only input', () => {
    expect(parseBinding('Ctrl+Shift')).toBeNull()
    expect(parseBinding('')).toBeNull()
  })

  it('round-trips through display form', () => {
    expect(normalizeBinding('ctrl+shift+s')).toBe('Ctrl+Shift+S')
    expect(normalizeBinding('Cmd+p')).toBe('Ctrl+P')
  })

  it('detects conflicts with other commands', () => {
    const binding = parseBinding('Ctrl+N')
    if (!binding) throw new Error('parse failed')
    expect(bindingsEqual(binding, binding)).toBe(true)
    expect(findConflict('command-palette', binding, {})).toBe('new-file')
    expect(findConflict('new-file', binding, {})).toBeNull()
  })

  it('respects user overrides', () => {
    const parsed = effectiveBinding('command-palette', { 'command-palette': 'Ctrl+K' })
    expect(parsed).toEqual({ mod: true, shift: false, alt: false, key: 'k' })
    expect(effectiveBinding('export-pdf', {})).toBeNull()
  })

  it('fuzzy-matches command titles', () => {
    expect(fuzzyMatch('cpal', 'Command Palette')).toBe(true)
    expect(fuzzyMatch('ex pdf', 'Export PDF')).toBe(true)
    expect(fuzzyMatch('xyz', 'Export PDF')).toBe(false)
    expect(fuzzyMatch('', 'Anything')).toBe(true)
  })

  it('parses the plus key in Ctrl++', () => {
    expect(parseBinding('Ctrl++')).toEqual({ mod: true, shift: false, alt: false, key: '+' })
    expect(parseBinding('Ctrl+Shift++')).toEqual({ mod: true, shift: true, alt: false, key: '+' })
    expect(normalizeBinding('Ctrl++')).toBe('Ctrl++')
  })

  it('matches zoom-in through its aliases', () => {
    const bindings = effectiveBindings('zoom-in', {})
    const keys = bindings.map((b) => b.key)
    expect(keys).toContain('=')
    expect(keys).toContain('+')
    const shiftPlus = parseBinding('Ctrl+Shift++')
    expect(shiftPlus && bindings.some((b) => bindingsEqual(shiftPlus, b))).toBe(true)
  })

  it('matches synthetic minus/equals keydown events to zoom commands', () => {
    const fake = (key: string, shift = false): KeyboardEvent =>
      ({ ctrlKey: true, metaKey: false, shiftKey: shift, altKey: false, key }) as KeyboardEvent
    const overrides: Record<string, string> = {}
    const match = (id: string, e: KeyboardEvent): boolean =>
      effectiveBindings(id, overrides).some((b) => bindingsEqual(bindingFromEvent(e), b))
    expect(match('zoom-out', fake('-'))).toBe(true)
    expect(match('zoom-in', fake('='))).toBe(true)
    expect(match('zoom-in', fake('+', true))).toBe(true)
    expect(match('zoom-reset', fake('0'))).toBe(true)
  })
})
