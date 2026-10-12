import { describe, it, expect } from 'vitest'
import {
  COMMANDS,
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
  it('ships no two commands on the same default binding', () => {
    // Nothing surfaces a collision to the user until they press the key and one
    // of the two commands silently wins, so the registry itself has to hold.
    const seen = new Map<string, string>()
    const clashes: string[] = []
    for (const cmd of COMMANDS) {
      for (const binding of [cmd.defaultBinding, ...(cmd.aliases ?? [])]) {
        const parsed = parseBinding(binding)
        if (!parsed) {
          if (binding) clashes.push(`${cmd.id}: unparseable "${binding}"`)
          continue
        }
        const owner = seen.get(binding)
        if (owner) clashes.push(`${binding}: ${owner} and ${cmd.id}`)
        else seen.set(binding, cmd.id)
      }
    }
    expect(clashes).toEqual([])
  })

  it('gives all four split surfaces their own shortcut', () => {
    const surfaces = COMMANDS.filter((c) => c.id.startsWith('split-'))
    expect(surfaces.map((c) => c.id)).toEqual([
      'split-files',
      'split-backlinks',
      'split-document',
      'split-preview'
    ])
    for (const surface of surfaces) {
      expect(surface.defaultBinding).not.toBe('')
    }
  })

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

  it('opens the palette through Ctrl+K as well as Ctrl+P', () => {
    const bindings = effectiveBindings('command-palette', {})
    const keys = bindings.map((b) => b.key)
    expect(keys).toContain('p')
    expect(keys).toContain('k')
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
