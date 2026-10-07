# WriteMd Implementation Roadmap

Tracker for what shipped in v1.0.0 and what lands in v1.1.0. Each v1.1.0 item carries acceptance criteria; nothing counts as done until `pnpm typecheck` + `pnpm test` pass.

## Current work — workspace UI repair

This section tracks the workspace UI changes prepared for v1.4.0. Historical release sections below retain their original scope. Release notes are in [RELEASE_NOTES_v1.4.0.md](release-notes/RELEASE_NOTES_v1.4.0.md).

- [x] Shared workspace shell.
  - Acceptance: home, settings, and documents use the shared full-height sidebar and workspace chrome; vertical tabs are the default and existing profiles migrate once; existing themes and shared chrome icons work through reusable Lit primitives; settings open as an application page; documents, split resizing, drag ordering, backgrounds, keyboard focus, and persistence remain functional. Preserve MIT attribution for adapted source and verify in Electron with screenshots.

- [x] Settings sidebar search and navigation.
  - Acceptance: search belongs to the settings sidebar and remains clickable in both tab layouts; Writing, Workspace, and Application group clearly named categories with shared WriteMd icons and spacing; filtering, match navigation, search focus, and Back to editor work; dark/light and compact-window screenshots verify the layout.

- [x] Settings and workspace visual consistency.
  - Acceptance: all settings categories fit compact and wide windows across seven themes; cards, descriptions, switches, and custom dropdowns remain readable; minimal bundled fonts replace serif choices and existing preferences migrate; the obsolete beta card is removed; file paths and floating mode/count controls remain visible; three-dot resize handles retain pointer/keyboard behavior; caption controls blend with the editor surface. Verify dropdown reopening, keyboard selection, persistence, contrast, and screenshots in Electron.

- [x] Document header alignment and menu bounds.
  - Acceptance: actual toolbar/editor screenshot pixels match at full and reduced surface opacity; the title and its rename field center on the full header in both orientations; document menu labels fit without clipping and short windows allow scrolling; Escape restores focus and menu keyboard navigation works. Verify compact/wide windows and screenshots in Electron.

- [x] Pane actions, pinned separation, and vertical update flow.
  - Acceptance: the secondary document has its own menu and reading toggle; mode, rename, move, export, and find target the chosen pane; shared-file renames preserve both save targets; document and text menus dismiss one another, stay within the viewport, and support keyboard submenu focus; a short thin line separates pinned/grouped and unpinned documents; update availability, download progress, and restart appear above AI Assistant in vertical mode, while horizontal mode retains the toolbar control. Verify in Electron with screenshots and typed updater bridge calls.

- [x] Welcome screen consistency.
  - Acceptance: home uses the shared shell with vertical mode by default; captions, sidebar, settings, and command search match the editor; the old inner frame is removed; recent-note and new/open/vault actions work through the typed bridge; all themes and compact windows fit; workspace artwork uses empty-view strength and scope; opening and closing notes preserves the shell. Verify keyboard actions, settings navigation, screenshot bounds, and Electron screenshots.

- [x] Shared tab dragging and stable identity transactions.
  - Acceptance: horizontal/vertical dragging, pin changes, insertion order, Escape/pointer cancellation, outside drops, stationary edge scrolling, and keyboard ordering work in Electron. Tab appearance stays intact.
- [x] Resizable workspace and rail.
  - Acceptance: pointer/keyboard resizing persists preferences, constraints preserve both pane minimums, narrow windows switch surfaces without overflow, rail allocation animates continuously, and rapid toggles/reduced motion finish correctly.
- [x] Shared modal/menu behavior.
  - Acceptance: native dialog focus makes the background inert; menu placement and keyboard navigation work through Shadow DOM; closing restores focus; nested confirmation Escape dismisses only the top dialog.
- [x] Settings notifications and write recovery.
  - Acceptance: reset reapplies all subscribed settings; compound changes write one snapshot; queued writes preserve the latest value; save failure exposes retry and subsequent main-process writes recover.
- [x] Local image backgrounds and optional glass.
  - Acceptance: import copies to owned storage, all six effects render, settings/image survive restart, removal preserves the source file, supported materials apply, unsupported platforms expose a fallback, and fonts load without a network stylesheet.
- [x] Architecture boundaries and regression coverage.
  - Acceptance: one drag controller serves both orientations; workspace geometry and AI session ownership are separate from CodeMirror; shell subscriptions exclude content-only notifications; typecheck, unit tests, relevant Electron specs, and screenshots validate the change.
- [x] Flat workspace and settings page.
  - Acceptance: panes meet the window edges without rounded frames; three-dot resize handles remain usable; settings use the shared shell with responsive content and sidebar search; pane-local wallpaper visibility works independently of surface opacity and its scope/preview matches the workspace. Verify horizontal/vertical layouts, focus, search, and screenshots in Electron.

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
- [x] Fix settings theme contrast and control consistency.
- [x] Replace settings serif fonts with bundled minimal font choices.
