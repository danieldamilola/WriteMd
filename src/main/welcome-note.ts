import { existsSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { extname, join } from 'path'

export const WELCOME_NOTE_FILENAME = 'Welcome.md'

const MARKDOWN_EXTS = ['.md', '.markdown', '.mdown', '.mkd']

/**
 * The note written into a brand-new vault.
 *
 * It deliberately does not explain Markdown. Anyone opening a markdown editor
 * knows what a heading is, and a page that spends its first screen on `**bold**`
 * is a page about the wrong thing. What it does instead is show what *this*
 * editor does with markdown you already write — starting with tables, which are
 * the one thing here that is genuinely not plain text.
 *
 * Every claim here is something the editor does today. Callouts look like they
 * belong in a list like this, and they render as plain blockquotes, so they are
 * absent. Wiki-link autocomplete is on the roadmap, not shipped, so the link
 * syntax is described rather than demonstrated: a `[[link]]` to a note that does
 * not exist yet would read as a bug on the first launch.
 */
export const WELCOME_NOTE_MARKDOWN = `# Welcome to WriteMd

You already know Markdown, so this note skips the basics. It is here to show you
the things this editor does on its own — click the cells below.

Delete this file whenever you want. It is your vault.

## Tables, in place

Click any cell to edit it. The pipes are never shown, and you never have to leave
what you are reading to add a row.

| Feature | Live preview | Try it |
| ------- | ------------ | ------ |
| Tables  | yes          | click a cell in this one |
| Math    | yes          | see below |
| Diagrams | yes         | see below |
| Task lists | yes       | tick one below |
| Footnotes | yes        | see the bottom of this note |

Put the cursor anywhere in a table and a toolbar appears above it:

- **Col** and **Row** add a column or a row
- The three alignment buttons set that column's alignment in the table itself,
  so it stays aligned when you open the file somewhere else
- The grip at its left end moves the toolbar wherever you want it.
  Double-click the grip to snap it back.

To start one from nothing, type \`/tab\` and pick the suggestion.

## Math and diagrams

Inline math goes between single dollar signs, so this comes out as typeset math
rather than as text: $e^{i\\pi} + 1 = 0$. Put those same delimiters on lines of
their own, with nothing else on them, and you get a display block:

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

A fenced \`mermaid\` block renders as a diagram:

\`\`\`mermaid
graph LR
  A[Write] --> B[Preview]
  B --> C{Publish?}
  C -->|yes| D[Ship it]
  C -->|no| A
\`\`\`

## Small things worth knowing

- **Task lists** — \`- [ ]\` renders a checkbox you can click.
- **Footnotes** — \`[^1]\` anywhere, definition at the bottom.[^1]
- **Links between notes** — type \`[[\` then a note name. Click the link to open
  it. Autocomplete is not in yet; the file name is.
- **Code** — fenced blocks highlight themselves. Pick a language after the
  opening fence for the best result.
- **Images** — paste or drop one into a note and it is written to an \`_assets\`
  folder next to that note, with the link filled in for you.

## Where your files live

This is the part worth being explicit about, because it is unusual:

- A file you **open from anywhere** on this machine is edited where it is, and
  saves back to that same place. It is never copied into the vault.
- A file you **create** in WriteMd goes into your vault, which is
  \`Documents/WriteMd Vault/\`.

So you can point it at a folder of notes you already keep somewhere else and
carry on as you were.

## Finding your way around

Views flip with **Ctrl+E**, between reading and live. The command palette
(**Ctrl+P**) holds everything else, including every command below — search it
rather than memorising it.

| | |
| --- | --- |
| **Ctrl+P** | command palette — files, views, themes, AI |
| **Ctrl+E** | flip reading / live |
| **Ctrl+F** / **Ctrl+H** | find / replace |
| **Ctrl+Shift+E** | files in the split pane |
| **Ctrl+Shift+B** | backlinks in the split pane |
| **Ctrl+Alt+A** | AI assistant in the split pane |
| **Ctrl+,** | settings |

All of them are rebindable in Settings, so treat that table as the default rather
than the rule.

Backlinks are the one feature here worth trying on a folder you already write
in: **Ctrl+Shift+B** lists every note that mentions the open one, with the line it
mentions it on. It is how WriteMd replaces the folder tree you were about to
maintain by hand.

[^1]: Like this one. The definition lives at the bottom, and the number links both ways.
`

/**
 * Write the welcome note into `dir`, but only into a vault that is brand new.
 *
 * "Brand new" means the caller had to create the directory on this launch. An
 * existing vault is left alone no matter how empty it looks: someone who deleted
 * their own notes should not find them back the next morning, and a folder of
 * zero notes is far more likely to be a vault in progress than a first run.
 *
 * Returns the path written, or null when nothing was written.
 */
export function seedWelcomeNote(dir: string, fresh: boolean): string | null {
  if (!fresh) return null
  const target = join(dir, WELCOME_NOTE_FILENAME)
  // Belt and braces: the directory was just created, so a file in it means
  // something else wrote first. Never clobber a note.
  if (existsSync(target)) return null
  // Same for a note under any other name — a folder that already holds markdown
  // is not a first run whatever the directory's own history says.
  if (listNotes(dir).length > 0) return null

  // Temp plus atomic rename, like every other write in the app: a crash mid-write
  // must not leave a half-written Welcome.md that the user then finds and has to
  // work out what it is.
  const temp = `${target}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, WELCOME_NOTE_MARKDOWN, { encoding: 'utf-8', mode: 0o600 })
    renameSync(temp, target)
  } catch (err) {
    try {
      unlinkSync(temp)
    } catch {
      // Already gone, or never created.
    }
    // A read-only or full disk is not worth failing startup over. The editor is
    // perfectly usable without the note.
    console.error('Could not write the vault welcome note:', err)
    return null
  }
  return target
}

function listNotes(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) =>
          !entry.name.startsWith('.') && MARKDOWN_EXTS.includes(extname(entry.name).toLowerCase())
      )
      .map((entry) => entry.name)
  } catch {
    return []
  }
}
