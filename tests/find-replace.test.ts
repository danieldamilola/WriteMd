import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { SearchQuery } from '@codemirror/search'
import { COMMANDS, effectiveBinding, parseBinding } from '../src/renderer/src/state/shortcuts'

function countMatches(doc: string, search: string): { total: number; valid: boolean } {
  const query = new SearchQuery({ search })
  const state = EditorState.create({ doc })
  let total = 0
  const cursor = query.getCursor(state, 0)
  let next = cursor.next()
  while (!next.done) {
    total += 1
    next = cursor.next()
  }
  return { total, valid: query.valid }
}

describe('find/replace wiring', () => {
  it('registers rebindable find/replace commands', () => {
    const find = COMMANDS.find((c) => c.id === 'find')
    const replace = COMMANDS.find((c) => c.id === 'replace')
    expect(find?.defaultBinding).toBe('Ctrl+F')
    expect(replace?.defaultBinding).toBe('Ctrl+H')
    expect(effectiveBinding('find', {}).key).toBe('f')
    expect(parseBinding('Ctrl+H')?.key).toBe('h')
  })

  it('counts every match (no early break)', () => {
    expect(countMatches('foo foo foo', 'foo').total).toBe(3)
    expect(countMatches('aaa', 'aa').total).toBe(1)
    expect(countMatches('hello', 'zzz').total).toBe(0)
  })

  it('flags invalid regex as invalid', () => {
    const query = new SearchQuery({ search: '(', regexp: true })
    expect(query.valid).toBe(false)
  })
})
