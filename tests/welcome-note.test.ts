import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  seedWelcomeNote,
  WELCOME_NOTE_FILENAME,
  WELCOME_NOTE_MARKDOWN
} from '../src/main/welcome-note'
import { COMMANDS, parseBinding } from '../src/renderer/src/state/shortcuts'

/**
 * The welcome note is the only thing WriteMd puts in the user's vault without
 * being asked. That makes the conditions under which it appears the whole
 * feature: a note that shows up in somebody's real vault, or fails to show up
 * on a first run, is the bug.
 *
 * The content is asserted too, because a promise the editor does not keep is
 * worse than no note. Every shortcut named in it has to exist in the registry,
 * and the syntax has to parse as the markdown the editor claims to render.
 */

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'writemd-welcome-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const notes = (): string[] => readdirSync(dir).filter((f) => f.endsWith('.md'))

describe('seedWelcomeNote', () => {
  it('writes the note into a vault this launch created', () => {
    expect(seedWelcomeNote(dir, true)).toBe(join(dir, WELCOME_NOTE_FILENAME))
    expect(notes()).toEqual([WELCOME_NOTE_FILENAME])
    expect(readFileSync(join(dir, WELCOME_NOTE_FILENAME), 'utf-8')).toBe(WELCOME_NOTE_MARKDOWN)
  })

  it('leaves an existing vault completely alone', () => {
    // The case that matters: an existing vault is somebody's real notes. Empty
    // or not, nothing is added.
    expect(seedWelcomeNote(dir, false)).toBeNull()
    expect(notes()).toEqual([])
  })

  it('never overwrites a note the user already has', () => {
    const target = join(dir, WELCOME_NOTE_FILENAME)
    writeFileSync(target, '# mine\n', 'utf-8')

    expect(seedWelcomeNote(dir, true)).toBeNull()
    expect(readFileSync(target, 'utf-8')).toBe('# mine\n')
  })

  /**
   * `created` and the folder contents are separate guards. A vault that already
   * held notes before this launch is not a first run, and the directory missing
   * is the only signal that can be trusted — so both are checked.
   */
  it('stands down when the fresh folder already holds notes', () => {
    writeFileSync(join(dir, 'PRD.md'), '# mine\n', 'utf-8')
    expect(seedWelcomeNote(dir, true)).toBeNull()
    expect(notes()).toEqual(['PRD.md'])
  })

  it('ignores non-markdown files when deciding the vault is empty', () => {
    // An images folder or a stray PDF is not a vault in use.
    writeFileSync(join(dir, 'notes.pdf'), '%PDF', 'utf-8')
    expect(seedWelcomeNote(dir, true)).toBe(join(dir, WELCOME_NOTE_FILENAME))
  })

  it('does not treat the _assets folder as notes', () => {
    mkdirSync(join(dir, '_assets'))
    writeFileSync(join(dir, '_assets', 'shot.png'), 'x', 'utf-8')
    expect(seedWelcomeNote(dir, true)).toBe(join(dir, WELCOME_NOTE_FILENAME))
  })

  it('leaves no temp file behind', () => {
    seedWelcomeNote(dir, true)
    expect(readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([])
  })

  it('writes something a person can read', () => {
    seedWelcomeNote(dir, true)
    const body = readFileSync(join(dir, WELCOME_NOTE_FILENAME), 'utf-8')
    // Windows checkouts of this repo are not the case, but a note that decodes
    // differently on another platform would be its own bug.
    expect(body).toContain('# Welcome to WriteMd')
    // The footnote the note teaches with is the last thing in it, and the
    // definition is really there — a reference with no definition renders as a
    // dangling link in the one document guaranteed to be read.
    expect(body.trimEnd().endsWith('the number links both ways.')).toBe(true)
    expect(body).toMatch(/Footnote/i)
  })
})

describe('welcome note content', () => {
  /**
   * The note teaches by demonstrating, so a feature it names has to exist. The
   * two it deliberately leaves out are the two that would be a lie today:
   * callouts render as plain blockquotes, and wiki-link autocomplete is not
   * built yet.
   */
  it('only mentions features the editor actually ships', () => {
    expect(WELCOME_NOTE_MARKDOWN).not.toMatch(/callout/i)
    expect(WELCOME_NOTE_MARKDOWN).toMatch(/\[\[/)
    // Described, not demonstrated: a link to a note that does not exist yet
    // would read as a broken link on the first launch.
    expect(WELCOME_NOTE_MARKDOWN).not.toMatch(/^\s*\[\[[^\]]+\]\]\s*$/m)
  })

  it('leads with tables', () => {
    const tables = WELCOME_NOTE_MARKDOWN.match(/^\|.*\|$/gm) ?? []
    // The feature table, the shortcut table, and the syntax table are all real
    // GFM: a header row, then a delimiter row of dashes and pipes.
    expect(tables.length).toBeGreaterThanOrEqual(9)
    expect(WELCOME_NOTE_MARKDOWN.indexOf('Tables, in place')).toBeLessThan(
      WELCOME_NOTE_MARKDOWN.indexOf('Math and diagrams')
    )
  })

  it('names only shortcuts that exist in the registry', () => {
    const named = [...WELCOME_NOTE_MARKDOWN.matchAll(/\*\*(Ctrl\+[^ *]+)\*\*/g)].map((m) => m[1])
    expect(named.length).toBeGreaterThanOrEqual(7)
    const defaults = new Set(COMMANDS.map((c) => c.defaultBinding))
    for (const binding of named) {
      // Parsed so "Ctrl+Shift+E" is compared as parts, not as a string that
      // could differ in case or spacing from the registry.
      expect(parseBinding(binding), `${binding} is not a parseable binding`).not.toBeNull()
      expect(defaults.has(binding), `${binding} is not a default binding`).toBe(true)
    }
  })

  it('does not explain markdown basics', () => {
    // The audience already knows what these are. Teaching them is the one
    // mistake this note cannot make.
    expect(WELCOME_NOTE_MARKDOWN).not.toMatch(/^#+ .*\b(bold|italic|heading|blockquote)\b/im)
    expect(WELCOME_NOTE_MARKDOWN).not.toMatch(/markdown basics/i)
  })
})
