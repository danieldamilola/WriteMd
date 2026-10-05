# WriteMd Implementation Roadmap

Tracker for what shipped in v1.0.0 and what lands in v1.1.0. Each v1.1.0 item carries acceptance criteria; nothing counts as done until `pnpm typecheck` + `pnpm test` pass.

## v1.0.0 - Shipped

### Foundation

- [x] Electron + Vite + TypeScript setup, Main/Renderer IPC + typed preload bridge
- [x] Frameless window + custom unified top bar, tabs, split layout
- [x] Theme system (CSS variables; Dark, Graphite, Midnight, Light, Paper, Dracula, Nord)
- [x] Settings persistence store + Settings modal (General, Editor, Appearance, Shortcuts, Files)

### Editor

- [x] CodeMirror 6 + Lezer markdown parsing, syntax highlighting, Live Preview (WYSIWYG), Source mode, split panes
- [x] Tables (insert/edit/toolbar), math (KaTeX), Mermaid diagrams, frontmatter panel, footnotes, task lists
- [x] Slash commands, wiki-links with click-to-open, live decorations
- [x] Find/Replace overlay (`Ctrl+F` / `Ctrl+H`) with match counts and case/word/regex toggles
- [x] Command palette (`Ctrl+P`), shortcut registry with user rebind UI
- [x] Right-click text menu (formatting, headings, inserts, internal/external link insertion)

> Note: callouts. The text menu has a Callout item that inserts `> [!note]`
> (`TextMenu.ts:388`), but no extension parses or renders that syntax, so it
> displays as a plain blockquote. Insertion only.

### Files & links

- [x] Hybrid vault (`~/Documents/WriteMd Vault/`) + open-anywhere files saving back in place
- [x] Auto-save (debounced, atomic) + dirty tracking + external-change conflict dialog
- [x] Image paste/drop → sibling `_assets/` folder
- [x] Vault explorer, recent files, tabs with session restore
- [x] Cross-folder backlinks panel (wiki + markdown links, snippets, click-to-open)
- [x] Word/character counts in the document info pill

### AI, export, release

- [x] AI assistant panel (BYOK: OpenAI, Gemini, Anthropic, Ollama) with in-place document edits
- [x] PDF + standalone HTML export
- [x] File associations (`.md`, `.markdown`, `.mdown`, `.mkd`), Windows installer (`electron-builder` NSIS), auto-updater
- [x] Unit suite (vitest) + Playwright e2e specs
- [x] README, MIT LICENSE, PRIVACY.md

## v1.1.0 - Next (fix or add)

- [ ] Image resize handles
  - _Acceptance Criteria:_ Drag handles on rendered images set width/height attributes persisted in markdown.
- [ ] Wiki-link autocomplete (sibling files)
  - _Acceptance Criteria:_ Typing `[[` suggests vault/recent/open files across folders; Enter inserts the link.
- [ ] Frontmatter editing
  - _Acceptance Criteria:_ YAML properties editable in the Properties panel and written back to the file header.
- [ ] Reading time in info pill
  - _Acceptance Criteria:_ Pill shows words, characters, and reading time updating live as you type.
- [ ] Formatting keyboard shortcuts
  - _Acceptance Criteria:_ Bold, italic, strikethrough, inline code, and link have default bindings, rebindable in Settings.
- [ ] Vim mode toggle
  - _Acceptance Criteria:_ Settings switch enables Vim keybindings in the editor (`vimMode` key is already reserved in settings).
- [ ] Typewriter mode toggle
  - _Acceptance Criteria:_ Settings switch keeps the active line vertically centered (`typewriterMode` key reserved).
- [ ] Custom CSS injection
  - _Acceptance Criteria:_ CSS pasted in Settings applies to the renderer live (`customCSS` key reserved).
- [ ] Portable mode
  - _Acceptance Criteria:_ Config and vault resolve inside the app folder when enabled (`portableMode` key reserved).
- [ ] Code block language headers
  - _Acceptance Criteria:_ Fenced blocks show detected language with syntax highlighting and a header label.
- [ ] E2E coverage for links and backlinks
  - _Acceptance Criteria:_ `pnpm test:e2e` covers find/replace, the tab strip, links, and backlinks with screenshots. Find/replace and the tab strip are covered today; links and backlinks have no e2e spec.
- [ ] Callout rendering
  - _Acceptance Criteria:_ `> [!note]` and friends render as styled callouts in Live Preview and export. Insertion works; rendering does not exist.
- [ ] Code signing
  - _Acceptance Criteria:_ `electron-builder.yml` signs Windows and macOS builds and notarizes the macOS dmg. Until then `quitAndInstall` fails on macOS.
- [ ] Fix the auto-updater feed
  - _Acceptance Criteria:_ `package.json` has a `repository` field (or `electron-builder.yml` sets `owner`/`repo`), so electron-updater can resolve a release. Also surface check errors instead of rendering them as "up-to-date".
- [ ] Ui for the auto updater.
- [ ] fix the themeing in the settings
- [ ] fix the fonts in the settings
