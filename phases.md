# WriteMD Implementation Roadmap

This document serves as the implementation roadmap and tracker for WriteMD. It breaks the project down into manageable phases, with clear acceptance criteria for each task.

## Phase 1: Foundation (Completed)
- [x] Electron + Vite + TypeScript setup
- [x] Main/Renderer IPC + Preload bridge
- [x] Frameless window + custom unified top bar
- [x] Basic layout (AppShell, Editor pane, Split pane)
- [x] Theme system (CSS variables, Light/Dark support)
- [x] Settings persistence store

## Phase 2: Editor Core (Completed)
- [x] CodeMirror 6 integration
- [x] Markdown parser (Lezer) + syntax highlighting
- [x] Live Preview decorations (WYSIWYG rendering)
- [x] Mode toggle (WYSIWYG/Source/Split) via floating pill
- [x] Keyboard shortcuts registry and handler
- [x] Math rendering (KaTeX) plugin
- [x] Table rendering and editing plugins
- [x] Frontmatter plugin
- [x] Wiki links plugin
- [x] Slash command plugin

## Phase 3: File & State Management (Completed)
- [x] Hybrid Vault setup (`~/Documents/WriteMD/`)
- [x] Open/Save dialogs + drag-drop support
- [x] Auto-save (debounced) + dirty tracking
- [x] External file modification watcher and Conflict Dialog
- [x] Image paste/drop → save to sibling `_assets/`
- [x] Vault file explorer sidebar
- [x] Recent files tracking

## Phase 4: UI Polish & AI Assistant (Current Focus)
- [x] Settings Modal (tabs for General, Editor, Appearance, Shortcuts, Files)
- [x] Welcome/Empty state screen
- [x] Find/Replace overlay (`writemd-find-panel`)
  - *Acceptance Criteria:* `Mod-F` opens panel, input captures text without stealing focus, replaces text accurately.
- [x] AI Assistant Panel
  - *Acceptance Criteria:* Integrates via IPC, reads current document context, natively edits document via `writemd-replace` blocks without triggering file conflicts.
- [ ] Image resize handles
  - *Acceptance Criteria:* Click-and-drag handles on rendered images to set width/height attributes.
- [ ] Command palette (`Ctrl+P`)
  - *Acceptance Criteria:* Fuzzy-searchable list of all commands mapped in `shortcuts.ts`.

## Phase 5: Export & Final Polish
- [ ] PDF export
  - *Acceptance Criteria:* Generates styled PDF matching preview aesthetics.
- [ ] HTML export
  - *Acceptance Criteria:* Generates standalone HTML file with embedded styles.
- [ ] Word count / reading time display
  - *Acceptance Criteria:* Real-time stats shown in document info popover.
- [ ] Keyboard shortcut customization UI
  - *Acceptance Criteria:* Users can rebind keys in Settings.
- [ ] Mermaid diagram rendering
  - *Acceptance Criteria:* Fenced code blocks with `mermaid` tag render diagrams inline.

## Phase 6: Release Prep (Completed)
- [x] Auto-updater implementation
- [x] Code signing (Windows/macOS)
- [x] Installer build (`electron-builder`)
- [x] End-to-end testing (Playwright)
- [x] v1.0 Release