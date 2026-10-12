import { describe, it, expect } from 'vitest'
import {
  changelogSection,
  summarizeNotes,
  summarizeNotesForVersion
} from '../src/renderer/src/services/whats-new'

// Shaped like a version block out of the real changelog: a `## [x.y.z]` heading,
// `###` sections, then one `- **Bold title**. prose...` bullet per change.
const changelog = `# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- **A Brand New Thing**: Something nobody has shipped yet.

## [1.3.0] - 2026-10-05

### Added

- **A Draggable Table Toolbar**: The floating toolbar above a table is anchored
  by CodeMirror and could not be moved.
- **A Note in a New Vault**: On the first launch, WriteMd writes one
  \`Welcome.md\` into the vault.
- **OpenCode Provider (Console Login)**: OpenCode joins the provider list.
- **Nvidia Provider**: NIM's OpenAI-compatible endpoint.
- **Keyless Web Search**: A globe toggle in the composer.

### Fixed

- **Undo Crossed Files**: One view serves every tab.

## [1.2.0] - 2026-10-02

### Added

- **The AI Assistant Panel**: Chat tab, streaming replies.
`

describe('changelogSection', () => {
  it('returns one version block without its heading', () => {
    const section = changelogSection(changelog, '1.3.0')
    expect(section).toContain('A Draggable Table Toolbar')
    expect(section).not.toContain('## [1.3.0]')
  })

  it('stops at the next version', () => {
    const section = changelogSection(changelog, '1.3.0')
    expect(section).toContain('Undo Crossed Files')
    expect(section).not.toContain('The AI Assistant Panel')
    expect(section).not.toContain('## [1.2.0]')
  })

  it('runs to the end of the file for the newest version', () => {
    expect(changelogSection(changelog, 'Unreleased')).toContain('A Brand New Thing')
  })

  it('never returns the preamble above the first version', () => {
    for (const version of ['1.3.0', '1.2.0', 'Unreleased']) {
      expect(changelogSection(changelog, version)).not.toContain('Keep a Changelog')
    }
  })

  it('returns null for an unknown version', () => {
    expect(changelogSection(changelog, '99.0.0')).toBeNull()
  })

  it('does not match a version as a prefix of another', () => {
    expect(changelogSection(changelog, '1.3')).toBeNull()
  })
})

describe('summarizeNotes', () => {
  const section = changelogSection(changelog, '1.3.0')!

  it('lifts the bold lead-in out of each bullet', () => {
    expect(summarizeNotes(section)).toEqual([
      'A Draggable Table Toolbar',
      'A Note in a New Vault',
      'OpenCode Provider (Console Login)'
    ])
  })

  it('drops the prose after the bold title', () => {
    for (const item of summarizeNotes(section)) {
      expect(item).not.toContain('CodeMirror')
      expect(item).not.toContain('Welcome.md')
      expect(item).not.toContain('**')
    }
  })

  it('honours the item limit', () => {
    expect(summarizeNotes(section, 5)).toHaveLength(5)
    expect(summarizeNotes(section, 1)).toEqual(['A Draggable Table Toolbar'])
  })

  it('takes the added section before the fixed one', () => {
    expect(summarizeNotes(section, 5).join(' ')).not.toContain('Undo Crossed Files')
  })

  it('falls back to prose when there are no bold lead-ins', () => {
    const plain = `### Added

- Export to Word: one-click docx.
`
    // A bullet with no bold lead-in is prose, not a titled change.
    expect(summarizeNotes(plain, 3)).toEqual(['Export to Word: one-click docx.'])
  })

  it('skips section headings in the prose fallback', () => {
    expect(summarizeNotes('### Fixed\n\n### Added\n\n- Nothing yet.', 3)).toEqual(['Nothing yet.'])
  })

  it('returns nothing for empty input', () => {
    expect(summarizeNotes('')).toEqual([])
    expect(summarizeNotes('   \n\n  ')).toEqual([])
  })
})

describe('summarizeNotesForVersion', () => {
  it('finds the bundled notes for a shipped version', () => {
    const summary = summarizeNotesForVersion('1.3.0', 2)
    expect(summary).toHaveLength(2)
    expect(summary[0]).toBe('A Draggable Table Toolbar')
  })

  it('returns nothing for an unknown version', () => {
    expect(summarizeNotesForVersion('99.0.0')).toEqual([])
  })

  it('returns nothing for an empty version', () => {
    expect(summarizeNotesForVersion('')).toEqual([])
  })
})
