import { describe, it, expect } from 'vitest'
import { summarizeNotes, summarizeNotesForVersion } from '../src/renderer/src/services/whats-new'

// Shaped like the real notes files: title, a section heading, then one
// `- **Bold title**: prose...` bullet per feature.
const notes = `# Release Notes - v1.3.0

**Features**

- **A Draggable Table Toolbar**: The floating toolbar above a table is anchored
  by CodeMirror and could not be moved.
- **A Note in a New Vault**: On the first launch, WriteMd writes one
  \`Welcome.md\` into the vault.
- **OpenCode Provider (Console Login)**: OpenCode joins the provider list.
- **Nvidia Provider**: NIM's OpenAI-compatible endpoint.
- **Keyless Web Search**: A globe toggle in the composer.

**Bug Fixes**

- **Undo Crossed Files**: One view serves every tab.
`

describe('summarizeNotes', () => {
  it('lifts the bold lead-in out of each feature bullet', () => {
    expect(summarizeNotes(notes)).toEqual([
      'A Draggable Table Toolbar',
      'A Note in a New Vault',
      'OpenCode Provider (Console Login)'
    ])
  })

  it('drops the prose after the bold title', () => {
    for (const item of summarizeNotes(notes)) {
      expect(item).not.toContain('CodeMirror')
      expect(item).not.toContain('Welcome.md')
      expect(item).not.toContain('**')
      expect(item).not.toContain(':')
    }
  })

  it('never crosses into the Bug Fixes section', () => {
    expect(summarizeNotes(notes).join(' ')).not.toContain('Undo Crossed Files')
  })

  it('drops the title line', () => {
    expect(summarizeNotes(notes).join(' ')).not.toContain('Release Notes')
  })

  it('honours the item limit', () => {
    expect(summarizeNotes(notes, 5)).toHaveLength(5)
    expect(summarizeNotes(notes, 1)).toEqual(['A Draggable Table Toolbar'])
  })

  it('falls back to prose when there are no feature bullets', () => {
    const plain = `# Release Notes - v1.0.0

**Features**

- Export to Word: one-click docx.
`
    // A bullet with no bold lead-in is prose, not a titled feature.
    expect(summarizeNotes(plain, 3)).toEqual(['Export to Word: one-click docx.'])
  })

  it('returns nothing for empty input', () => {
    expect(summarizeNotes('')).toEqual([])
    expect(summarizeNotes('   \n\n  ')).toEqual([])
  })
})

describe('summarizeNotesForVersion', () => {
  it('finds the bundled notes for a shipped version', () => {
    const summary = summarizeNotesForVersion('1.3.0', 2)
    expect(summary.length).toBeGreaterThan(0)
    expect(summary.length).toBeLessThanOrEqual(2)
  })

  it('returns nothing for an unknown version', () => {
    expect(summarizeNotesForVersion('99.0.0')).toEqual([])
  })

  it('returns nothing for an empty version', () => {
    expect(summarizeNotesForVersion('')).toEqual([])
  })
})
